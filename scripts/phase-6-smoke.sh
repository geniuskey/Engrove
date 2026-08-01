#!/usr/bin/env bash
set -euo pipefail
ENGROVE_TEST_COMPOSE_PROJECT=engrove-phase6-smoke \
ENGROVE_TEST_COMPOSE_LOG=docs/verification/phase-6-compose.log \
ENGROVE_TEST_PHASE3=1 \
ENGROVE_TEST_PHASE4=1 \
ENGROVE_TEST_PHASE5=1 \
ENGROVE_TEST_PHASE6=1 \
bash scripts/phase-2-smoke.sh
