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
  docker compose build api web demo
else
  docker compose pull api web demo
fi
# Caddy with the DuckDNS module is built here; after the first time it comes from the cache.
docker compose build caddy
docker compose stop api caddy web demo
docker compose rm -sf api migrate roles postgres seaweedfs demo demo-migrate
docker volume rm -f petvold-demo_pgdata petvold-demo_s3data
# The test data is made with Petvold stopped: the seed drives the relay and the runs with its own clock.
# It subscribes the demo service first, so its events wait for it. When everything starts, the demo
# service takes a new secret and Petvold sends the history (docs/teknik/demotjanst.md).
docker compose --profile seed run --rm seed
docker compose up -d
url=$(sed -n 's/^DEMO_PUBLIC_URL=//p' .env)
[ -n "$url" ] || url="https://$(sed -n 's/^DEMO_DOMAIN=//p' .env)"
echo "The demo is up. Sign in at $url/login. The demo service is at $url/demo/"
