#!/bin/sh
# One role per module (ADR 0001), as db/init does locally, and demo_service
# for the demo service's own database, with the password
# from SERVICE_DB_PASSWORD. Creates only the roles that are missing, so it runs
# both when the database is created (initdb) and before every migration (the
# roles service in compose.yaml), which lets an update add a new module.
set -eu
for role in claims access decisioning catalog animals parties policies communications webhooks scheduling documents billing payments accounting demo; do
  psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v role="${role}_service" -v pw="$SERVICE_DB_PASSWORD" <<'SQL'
select format('create role %I login password %L', :'role', :'pw')
where not exists (select from pg_roles where rolname = :'role')
\gexec
SQL
done
