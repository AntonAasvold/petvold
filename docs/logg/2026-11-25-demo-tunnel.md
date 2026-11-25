# Demon bakom Cloudflare Tunnel (PR #174)

**Datum:** 2026-11-25 **ADR:** 0041 **Moduler:** inga, bara drift

## Vad
Demon kan nu nås genom Cloudflare Tunnel, på Cloudflares port 443, utan att någon port öppnas mot servern. Det behövs när besökarna sitter bakom en brandvägg som bara släpper igenom 443, och demon hemma bara kan få en annan port, som 8443.

## Hur det fungerar
- **`setup.sh`** tar `CLOUDFLARE_TUNNEL_TOKEN` och skriver `DEMO_TLS=tunnel`, `DEMO_SITE=http://<domänen>`, token och `COMPOSE_PROFILES=tunnel`. Den publika adressen är fortfarande `https://<domänen>`. Tunneln går inte att kombinera med `DEMO_PORT` eller `DUCKDNS_TOKEN`.
- **`compose.yaml`** har tjänsten `cloudflared` (2026.11.0) i profilen `tunnel`. Den startar bara när `.env` sätter profilen. Caddy får `DEMO_SITE`, som faller tillbaka på `DEMO_DOMAIN`.
- **`Caddyfile`** har sajten `{$DEMO_SITE}` och den tomma snippeten `tls-tunnel`. Med `http://` i adressen lyssnar Caddy bara på port 80 i det interna nätet och hämtar inget certifikat.
- **I Cloudflare** pekar tunnelns publika värdnamn på `http://caddy:80`. `cloudflared` skickar med det ursprungliga värdnamnet, så Caddys sajt matchar.

## Val och avvägningar
- **En tunnel som styrs från Cloudflare (token)** i stället för en konfigurationsfil i repot. Värdnamnet ställs in i Cloudflare, och servern behöver bara token.
- **En profil i compose** i stället för en egen compose-fil, så att `reset.sh` och uppdateringen ser likadana ut i alla lägen.
- **`read -r` i dokumentationen,** med synlig inmatning, eftersom `read -rs` gjorde det svårt att se om inklistringen gick fram.

## Att känna till
- **Cloudflare avslutar HTTPS** och ser trafiken. Det gör inget för demon, som bara har påhittad data.
- **`reset.sh`** kör `--profile seed` för testdatan. Flaggan gäller i stället för `COMPOSE_PROFILES`, och `seed` behöver inte tunneln.
- **Prövat:** Caddyfilen med `caddy adapt` i tunnelläget (bara `:80`, ingen TLS-app) och i vanliga läget (`:443`). `setup.sh` med för kort token, med `DEMO_PORT` och med rätt värden. `docker compose config` visar `cloudflared` bara med profilen, och en äldre `.env` utan `DEMO_SITE` fungerar som förut. Själva tunneln är inte prövad här.

## Filer
- `deploy/demo/compose.yaml`, `Caddyfile`, `setup.sh`
- `docs/teknik/demo.md`
