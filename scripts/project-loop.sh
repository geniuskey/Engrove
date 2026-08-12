#!/usr/bin/env bash

set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

expected_node=$(tr -d '[:space:]' < .node-version)
current_node=$(node --version 2>/dev/null | sed 's/^v//' || true)
pnpm_command=$(command -v pnpm || true)
runtime_path=''
build_log=''

cleanup() {
  [[ -z "$build_log" ]] || rm -f "$build_log"
  if [[ -n "$runtime_path" ]]; then
    rm -f "$runtime_path/node"
    rmdir "$runtime_path"
  fi
}
trap cleanup EXIT

if [[ -z "$pnpm_command" ]]; then
  echo "pnpm is required. Install the package manager declared in package.json."
  exit 1
fi

if [[ "$current_node" != "$expected_node" ]]; then
  if [[ $(head -n 1 "$pnpm_command") != *node* ]]; then
    echo "Node $expected_node is required; the current shell uses Node ${current_node:-unknown}."
    echo "Activate .node-version with your Node version manager and rerun this script."
    exit 1
  fi

  runtime_node=$(pnpm --silent dlx "node@$expected_node" -p 'process.execPath')
  runtime_path=$(mktemp -d "${TMPDIR:-/tmp}/engrove-node.XXXXXX")
  ln -s "$runtime_node" "$runtime_path/node"
  export PATH="$runtime_path:$PATH"
  current_node=$(node --version | sed 's/^v//')
fi

if [[ "$current_node" != "$expected_node" ]]; then
  echo "Could not activate Node $expected_node (resolved Node $current_node)."
  exit 1
fi

export TURBO_FORCE=true

echo "Engrove project loop: Node $expected_node"

pnpm format:check
pnpm units:check
pnpm lint
pnpm typecheck
pnpm test
pnpm production:preflight:test
pnpm audit --audit-level low
bash scripts/database-integration.sh
pnpm --filter @engrove/web test:e2e

build_log=$(mktemp "${TMPDIR:-/tmp}/engrove-build.XXXXXX")
pnpm build 2>&1 | tee "$build_log"

if grep -E "Unsupported engine|Some chunks are larger than" "$build_log" >/dev/null; then
  echo "The build completed with a runtime or bundle-size warning."
  exit 1
fi

pnpm bundle:check
pnpm verify:community
git diff --check

echo "Engrove project loop passed without engine, bundle-size, or quality-gate warnings."
