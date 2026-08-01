#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_RUNTIME_PASSWORD:?set POSTGRES_RUNTIME_PASSWORD}"
: "${POSTGRES_WORKER_PASSWORD:?set POSTGRES_WORKER_PASSWORD}"
: "${POSTGRES_BACKUP_PASSWORD:?set POSTGRES_BACKUP_PASSWORD}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=runtime_password="$POSTGRES_RUNTIME_PASSWORD" \
  --set=worker_password="$POSTGRES_WORKER_PASSWORD" \
  --set=backup_password="$POSTGRES_BACKUP_PASSWORD" <<'SQL'
create role engrove_runtime login password :'runtime_password' nosuperuser nocreatedb nocreaterole noinherit;
create role engrove_worker login password :'worker_password' nosuperuser nocreatedb nocreaterole noinherit;
create role engrove_backup login password :'backup_password' nosuperuser nocreatedb nocreaterole noinherit;
SQL
