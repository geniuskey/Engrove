#!/usr/bin/env bash
set -euo pipefail
ENGROVE_TEST_COMPOSE_PROJECT=engrove-phase3-smoke \
ENGROVE_TEST_COMPOSE_LOG=docs/verification/phase-3-compose.log \
ENGROVE_TEST_PHASE3=1 \
bash scripts/phase-2-smoke.sh
