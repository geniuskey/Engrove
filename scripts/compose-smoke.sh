#!/usr/bin/env bash
set -euo pipefail

project="engrove-phase0-smoke"
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml)

cleanup() {
  "${compose[@]}" logs --no-color > docs/verification/phase-0-compose.log 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --detach --build --wait

curl --fail --silent http://localhost:3000/health/live >/dev/null
curl --fail --silent http://localhost:3000/health/ready >/dev/null
curl --fail --silent http://localhost:4173/health >/dev/null
"${compose[@]}" exec -T worker-python python -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)"
"${compose[@]}" exec -T worker-python python -c \
  "import urllib.request; r=urllib.request.Request('http://127.0.0.1:8000/internal/v1/capabilities', headers={'x-engrove-internal-secret':'engrove_internal_dev_only'}); urllib.request.urlopen(r, timeout=3)"
"${compose[@]}" exec -T redis sh -c \
  "test \"\$(redis-cli --scan --pattern 'engrove:worker-node:*:heartbeat' | wc -l)\" -ge 1"

heartbeat_key=$("${compose[@]}" exec -T redis redis-cli --raw --scan --pattern 'engrove:worker-node:*:heartbeat' | head -n 1 | tr -d '\r')
test -n "$heartbeat_key"
"${compose[@]}" stop --timeout 10 worker-node
heartbeat_exists=1
for _ in {1..20}; do
  heartbeat_exists=$("${compose[@]}" exec -T redis redis-cli exists "$heartbeat_key" | tr -d '\r')
  test "$heartbeat_exists" = "0" && break
  sleep 1
done
test "$heartbeat_exists" = "0"

"${compose[@]}" down --volumes
"${compose[@]}" up --detach --build --wait
curl --fail --silent http://localhost:3000/health/ready >/dev/null
echo "Phase 0 Compose smoke test passed twice from clean volumes."
