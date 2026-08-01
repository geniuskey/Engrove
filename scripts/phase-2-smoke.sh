#!/usr/bin/env bash
set -euo pipefail

project="${ENGROVE_TEST_COMPOSE_PROJECT:-engrove-phase2-smoke}"
log_file="${ENGROVE_TEST_COMPOSE_LOG:-docs/verification/phase-2-compose.log}"
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml)

cleanup() {
  "${compose[@]}" logs --no-color > "$log_file" 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --detach --build --wait
ENGROVE_TEST_COMPOSE_PROJECT="$project" node scripts/phase-2-api-smoke.mjs
