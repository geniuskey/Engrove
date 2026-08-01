#!/usr/bin/env bash
set -euo pipefail

project=engrove-phase7-production
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml -f deploy/compose/compose.production.yaml)

cleanup() {
  "${compose[@]}" logs --no-color > docs/verification/phase-7-production-compose.log 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans || true
}
trap cleanup EXIT

export ENGROVE_PUBLIC_URL=https://engrove.example.test
export VITE_API_BASE_URL=https://engrove.example.test
export S3_PUBLIC_ENDPOINT=https://objects.example.test
export POSTGRES_MIGRATION_PASSWORD='migration-production-test-password'
export POSTGRES_RUNTIME_PASSWORD='runtime-production-test-password'
export POSTGRES_WORKER_PASSWORD='worker-production-test-password'
export POSTGRES_BACKUP_PASSWORD='backup-production-test-password'
export MINIO_ROOT_USER='engrove_root_test'
export MINIO_ROOT_PASSWORD='minio-root-production-test-password'
export S3_ACCESS_KEY_ID='engrove_app_test'
export S3_SECRET_ACCESS_KEY='minio-app-production-test-password'
export INTERNAL_SERVICE_SECRET='internal-production-test-password'
export ENGROVE_SETUP_TOKEN='production_setup_test_token_32_chars'
export BACKUP_RECIPIENT=''

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" config --quiet
"${compose[@]}" up --detach --build --wait
"${compose[@]}" exec -T api node -e \
  "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{if(!r.ok)throw new Error(await r.text())})"
"${compose[@]}" exec -T api node -e \
  "fetch('http://127.0.0.1:3000/metrics').then(r=>{if(!r.ok)process.exit(1)})"

for service in api worker-node worker-python web; do
  container="$("${compose[@]}" ps -q "$service")"
  test -n "$container"
  test "$(docker inspect "$container" --format '{{.Config.User}}')" != root
  test "$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
  docker inspect "$container" --format '{{json .HostConfig.CapDrop}}' | grep -q 'ALL'
  docker inspect "$container" --format '{{json .HostConfig.SecurityOpt}}' | grep -q 'no-new-privileges'
done

for service in postgres redis minio api web; do
  container="$("${compose[@]}" ps -q "$service")"
  test "$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')" = '{}'
done

runtime_tables="$("${compose[@]}" exec -T postgres psql -U engrove_migration -d engrove -Atc \
  "select count(*) from information_schema.role_table_grants where grantee='engrove_runtime' and privilege_type='INSERT'")"
backup_writes="$("${compose[@]}" exec -T postgres psql -U engrove_migration -d engrove -Atc \
  "select count(*) from information_schema.role_table_grants where grantee='engrove_backup' and privilege_type in ('INSERT','UPDATE','DELETE') and table_name<>'maintenance_state'")"
test "$runtime_tables" -gt 0
test "$backup_writes" = 0

for image in $("${compose[@]}" images -q | sort -u); do
  metadata="$(docker image inspect "$image" --format '{{json .Config.Env}} {{json .Config.Labels}}')"
  history="$(docker history --no-trunc "$image" --format '{{.CreatedBy}}')"
  if printf '%s\n%s\n' "$metadata" "$history" | grep -Eqi \
    'migration-production-test-password|runtime-production-test-password|worker-production-test-password|backup-production-test-password|minio-(root|app)-production-test-password|internal-production-test-password|production_setup_test_token'; then
    echo "secret material found in image metadata or history: $image" >&2
    exit 1
  fi
done

echo 'Phase 7 production overlay and image-secret smoke passed.'
