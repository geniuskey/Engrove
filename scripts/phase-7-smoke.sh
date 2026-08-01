#!/usr/bin/env bash
set -euo pipefail

project=engrove-phase7-smoke
log_file=docs/verification/phase-7-compose.log
backup_dir="$(mktemp -d)"
chmod 0777 "$backup_dir"
mkdir -p "$backup_dir/identities"
chmod 0777 "$backup_dir/identities"
export ENGROVE_BACKUP_DIR="$backup_dir"
export BACKUP_IDENTITY_DIR="$backup_dir/identities"
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml)
compose_oidc=(docker compose -p "$project" -f deploy/compose/compose.yaml -f deploy/compose/keycloak.yaml)

cleanup() {
  if [[ ! -s "$log_file" ]]; then
    "${compose[@]}" logs --no-color > "$log_file" 2>&1 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans || true
  rm -rf "$backup_dir"
}
trap cleanup EXIT

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --detach --build --wait
ENGROVE_TEST_COMPOSE_PROJECT="$project" \
ENGROVE_TEST_PHASE3=1 \
ENGROVE_TEST_PHASE4=1 \
ENGROVE_TEST_PHASE5=1 \
ENGROVE_TEST_PHASE6=1 \
ENGROVE_TEST_PHASE7=1 \
node scripts/phase-2-api-smoke.mjs

"${compose[@]}" build admin
"${compose[@]}" run --rm --no-deps --entrypoint age-keygen admin -o /backups/identities/phase7.txt
recipient="$("${compose[@]}" run --rm --no-deps --entrypoint age-keygen admin -y /identities/phase7.txt | tr -d '\r')"
test -n "$recipient"

if "${compose[@]}" run --rm -e NODE_ENV=production admin create /backups/plaintext.tar --development-plaintext; then
  echo 'production plaintext backup unexpectedly succeeded' >&2
  exit 1
fi

"${compose[@]}" run --rm -e BACKUP_RECIPIENT="$recipient" admin create /backups/phase7.tar.age
"${compose[@]}" run --rm -e BACKUP_IDENTITY=/identities/phase7.txt admin verify /backups/phase7.tar.age

sessions_before="$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from sessions where revoked_at is null")"
tokens_before="$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from security_tokens where used_at is null and revoked_at is null")"
test "$sessions_before" -gt 0
test "$tokens_before" -gt 0

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --detach postgres minio storage-init
"${compose[@]}" wait storage-init
"${compose[@]}" run --rm -e BACKUP_IDENTITY=/identities/phase7.txt admin restore /backups/phase7.tar.age

test "$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from sessions where revoked_at is null")" = 0
test "$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from security_tokens where used_at is null and revoked_at is null")" = 0
test "$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from installation_setup where setup_token_hash is not null")" = 0
test "$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from file_objects where status='available' and storage_version_id is null")" = 0
test "$("${compose[@]}" exec -T postgres psql -U engrove -d engrove -Atc "select count(*) from dataset_artifacts where storage_version_id is null")" = 0

"${compose[@]}" up --detach --wait redis migrate worker-python worker-node api web
node scripts/phase-7-restore-smoke.mjs
curl --fail --silent http://localhost:3000/health/ready >/dev/null
curl --fail --silent http://localhost:3000/metrics | grep -q '^engrove_http_requests_total'

"${compose[@]}" logs --no-color > "$log_file" 2>&1
"${compose[@]}" down --volumes --remove-orphans
"${compose_oidc[@]}" up --detach --build --wait
node scripts/phase-7-keycloak-smoke.mjs
"${compose_oidc[@]}" logs --no-color > docs/verification/phase-7-keycloak-compose.log 2>&1
"${compose_oidc[@]}" down --volumes --remove-orphans
bash scripts/phase-7-production-smoke.sh
echo 'Phase 7 deployment hardening, encrypted restore, and Keycloak smoke passed.'
