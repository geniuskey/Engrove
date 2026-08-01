#!/usr/bin/env bash
set -euo pipefail
ENGROVE_TEST_COMPOSE_PROJECT=engrove-phase5-smoke \
ENGROVE_TEST_COMPOSE_LOG=docs/verification/phase-5-compose.log \
ENGROVE_TEST_PHASE3=1 \
ENGROVE_TEST_PHASE4=1 \
ENGROVE_TEST_PHASE5=1 \
bash scripts/phase-2-smoke.sh
