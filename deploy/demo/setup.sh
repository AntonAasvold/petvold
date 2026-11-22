#!/bin/sh
# Writes deploy/demo/.env with new random secrets and the demo's address and
# password (ADR 0041). Run once on the server; keep the file secret.
#
#   ./setup.sh demo.example.com 'a long password'
set -eu
cd "$(dirname "$0")"
domain=${1:?give the domain of the demo, e.g. demo.example.com}
password=${2:?give the shared password}
if [ -e .env ]; then
  echo ".env exists already. Remove it first to make new secrets (the data is then unreadable)." >&2
  exit 1
fi
rand() { openssl rand -base64 32 | tr -d '\n'; }
hex() { openssl rand -hex 24; }
hash=$(docker run --rm caddy:2.11.7-alpine caddy hash-password --plaintext "$password")
umask 077
cat > .env <<ENV
DEMO_DOMAIN=$domain
DEMO_USER=demo
DEMO_PASSWORD_HASH='$hash'
DEMO_GATE=$(hex)
PETVOLD_TAG=main
POSTGRES_PASSWORD=$(hex)
SERVICE_DB_PASSWORD=$(hex)
S3_SECRET_KEY=$(hex)
PETVOLD_WEBHOOK_KEY=$(rand)
PETVOLD_DOCUMENT_KEY=$(rand)
PETVOLD_FAKE_BANK_SECRET=whsec_$(rand)
ENV
echo "Wrote $(pwd)/.env for https://$domain. Next: ./reset.sh"
