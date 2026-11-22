#!/bin/sh
# Empties the demo and fills it again with test data (ADR 0041): stops
# Petvold, removes the database and the archive, runs the migrations and
# npm run demo:seed, and starts everything. Caddy's certificates are kept.
#
#   ./reset.sh            # with the images from the registry
#   ./reset.sh --build    # with images built here from the repository
set -eu
cd "$(dirname "$0")"
[ -e .env ] || { echo "No .env: run ./setup.sh first." >&2; exit 1; }
if [ "${1:-}" = "--build" ]; then
  docker compose build api web
else
  docker compose pull api web
fi
docker compose stop api caddy web
docker compose rm -sf api migrate postgres seaweedfs
docker volume rm -f petvold-demo_pgdata petvold-demo_s3data
# The test data is made with Petvold stopped: the seed drives the relay and the runs with its own clock.
docker compose --profile seed run --rm seed
docker compose up -d
echo "The demo is up. Sign in at https://$(sed -n 's/^DEMO_DOMAIN=//p' .env)/login"
