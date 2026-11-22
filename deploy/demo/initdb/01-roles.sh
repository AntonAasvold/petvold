#!/bin/sh
# One role per module (ADR 0001), as db/init does locally, with the password
# from SERVICE_DB_PASSWORD. Runs once, when the database is created.
set -eu
for role in claims access decisioning catalog animals parties policies communications webhooks scheduling documents billing payments; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "create role ${role}_service login password '${SERVICE_DB_PASSWORD}'"
done
