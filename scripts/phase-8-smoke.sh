#!/usr/bin/env bash
set -euo pipefail

project=engrove-phase8-smoke
log_file=docs/verification/phase-8-compose.log
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml)

cleanup() {
  "${compose[@]}" logs --no-color > "$log_file" 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans || true
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
ENGROVE_TEST_PHASE8=1 \
node scripts/phase-2-api-smoke.mjs
echo 'Phase 8 Community golden-flow smoke passed.'
