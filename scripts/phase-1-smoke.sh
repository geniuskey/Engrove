#!/usr/bin/env bash
set -euo pipefail

project="engrove-phase1-smoke"
compose=(docker compose -p "$project" -f deploy/compose/compose.yaml)

cleanup() {
  "${compose[@]}" logs --no-color > docs/verification/phase-1-compose.log 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up --detach --build --wait
ENGROVE_TEST_COMPOSE_PROJECT="$project" node scripts/phase-1-api-smoke.mjs
