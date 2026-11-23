# Caddy with the DuckDNS module (caddy-dns/duckdns, on libdns/duckdns, MIT), for certificates by
# the DNS challenge when ports 80 and 443 lead elsewhere (DEMO_TLS=duckdns).
# Without that setting the module is unused and Caddy behaves as the plain image.
ARG CADDY_VERSION=2.11.7

FROM caddy:${CADDY_VERSION}-builder-alpine AS build
# Pinned to a commit: the module has no release tags.
RUN xcaddy build --with github.com/caddy-dns/duckdns@86ea11d23d37c85f3900a8c3093405e2bcd68d2e

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
