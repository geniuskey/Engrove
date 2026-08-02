#!/usr/bin/env bash

set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

database_url=${DATABASE_TEST_URL:-}
container_name=''

cleanup() {
  if [[ -n "$container_name" ]]; then
    docker rm --force "$container_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "$database_url" ]]; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is required when DATABASE_TEST_URL is not supplied."
    exit 1
  fi

  container_name="engrove-postgres-test-$$-$RANDOM"
  docker run --detach --rm \
    --name "$container_name" \
    --env POSTGRES_DB=engrove_test \
    --env POSTGRES_USER=engrove_test \
    --env POSTGRES_PASSWORD=engrove_test \
    --publish 127.0.0.1::5432 \
    postgres:18.1-bookworm >/dev/null

  port=$(docker port "$container_name" 5432/tcp | sed 's/.*://')
  database_url="postgresql://engrove_test:engrove_test@127.0.0.1:${port}/engrove_test"

  ready=false
  for _ in {1..30}; do
    if docker exec "$container_name" pg_isready --username engrove_test --dbname engrove_test \
      >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "PostgreSQL integration container did not become ready."
    exit 1
  fi
fi

DATABASE_MIGRATION_URL="$database_url" pnpm --filter @engrove/database db:migrate
DATABASE_TEST_URL="$database_url" pnpm --filter @engrove/database test:integration
