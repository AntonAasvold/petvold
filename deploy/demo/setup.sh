#!/bin/sh
# Writes deploy/demo/.env with new random secrets and the demo's address and
# password (ADR 0041). Run once on the server; keep the file secret.
#
#   ./setup.sh demo.example.com 'a long password'
#
# When ports 80 and 443 lead to another machine, reach the demo on another
# port and let Caddy get its certificate through DuckDNS instead:
#
#   DEMO_PORT=8443 DUCKDNS_TOKEN=... ./setup.sh petvold.name.duckdns.org 'a long password'
#
# The router then forwards that port (8443) to port 443 on the server.
#
# Behind Cloudflare Tunnel no port is forwarded at all, and the demo is reached
# on Cloudflare's port 443. Create the tunnel in Cloudflare, point its public
# hostname to http://caddy:80, and give its token:
#
#   CLOUDFLARE_TUNNEL_TOKEN=... ./setup.sh demo.example.com 'a long password'
set -eu
cd "$(dirname "$0")"
domain=${1:?give the domain of the demo, e.g. demo.example.com}
password=${2:?give the shared password}
port=${DEMO_PORT:-443}
token=${DUCKDNS_TOKEN:-}
tunnel=${CLOUDFLARE_TUNNEL_TOKEN:-}
if [ -e .env ]; then
  echo ".env exists already. Remove it first to make new secrets (the data is then unreadable)." >&2
  exit 1
fi
case $port in
  ''|*[!0-9]*) echo "DEMO_PORT must be a port number, got: $port" >&2; exit 1 ;;
esac
site=$domain
profiles=
if [ -n "$tunnel" ]; then
  [ -z "$token" ] && [ "$port" = 443 ] || { echo "Behind Cloudflare Tunnel the demo is on port 443 and needs no DuckDNS: leave out DEMO_PORT and DUCKDNS_TOKEN." >&2; exit 1; }
  [ ${#tunnel} -ge 100 ] || { echo "CLOUDFLARE_TUNNEL_TOKEN looks too short: give the whole token from the tunnel's install command." >&2; exit 1; }
  tls=tunnel
  site="http://$domain"
  profiles=tunnel
elif [ -n "$token" ]; then
  [ ${#token} -eq 36 ] || { echo "DUCKDNS_TOKEN must be the 36 characters shown at duckdns.org." >&2; exit 1; }
  case $domain in
    *.duckdns.org) ;;
    *) echo "DUCKDNS_TOKEN only works for a domain under duckdns.org, got: $domain" >&2; exit 1 ;;
  esac
  tls=duckdns
elif [ "$port" != 443 ]; then
  echo "On port $port Let's Encrypt cannot check the domain over http. Give DUCKDNS_TOKEN as well." >&2
  exit 1
else
  tls=http
fi
if [ "$port" = 443 ]; then url="https://$domain"; else url="https://$domain:$port"; fi
rand() { openssl rand -base64 32 | tr -d '\n'; }
hex() { openssl rand -hex 24; }
hash=$(docker run --rm caddy:2.11.7-alpine caddy hash-password --plaintext "$password")
umask 077
cat > .env <<ENV
DEMO_DOMAIN=$domain
DEMO_PUBLIC_URL=$url
DEMO_SITE=$site
DEMO_TLS=$tls
DUCKDNS_TOKEN=$token
CLOUDFLARE_TUNNEL_TOKEN=$tunnel
COMPOSE_PROFILES=$profiles
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
echo "Wrote $(pwd)/.env for $url. Next: ./reset.sh"
