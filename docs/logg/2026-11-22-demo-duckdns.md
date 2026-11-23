# Demon på en annan port, med certifikat från DuckDNS (PR #144)

**Datum:** 2026-11-22 **ADR:** 0041 **Moduler:** inga, bara drift

## Vad
Demon kan nu köras där portarna 80 och 443 redan leder till en annan maskin. Den nås då på en annan port, till exempel `https://petvold.namn.duckdns.org:8443`, och Caddy får sitt certifikat med en TXT-post hos DuckDNS.

## Hur det fungerar
- **`setup.sh`** läser `DEMO_PORT` och `DUCKDNS_TOKEN` ur miljön. Med en token skriver den `DEMO_TLS=duckdns`, tokenen och `DEMO_PUBLIC_URL` med porten i `.env`. Utan token godtas bara port 443.
- **`Caddyfile`** har två snippets, `tls-http` (tom) och `tls-duckdns`, och sajten importerar `tls-{$DEMO_TLS:http}`. Miljövariabeln ersätts när filen läses, så valet görs vid start utan två Caddyfiler.
- **`caddy/Dockerfile`** bygger Caddy med `xcaddy` och modulen `caddy-dns/duckdns`, låst till en commit. Compose bygger den, och `reset.sh` kör `docker compose build caddy` varje gång. Efter första gången kommer den från cachen.
- **`compose.yaml`** sätter `PETVOLD_PUBLIC_URL` till `DEMO_PUBLIC_URL`, eller `https://${DEMO_DOMAIN}` om den saknas, så att en äldre `.env` fungerar som förut.
- **Caddy svarar på 443 i containern som förut.** Routern översätter den yttre porten, till exempel 8443, till 443.

## Val och avvägningar
- **DNS-01 i stället för en gemensam ingång.** En Caddy framför både demon och en Home Assistant hade gett adresser utan port, men flyttat ingången för något som inte hör till Petvold. DNS-01 rör inget annat.
- **HTTP/3 avstängt.** Compose publicerar bara TCP, och bakom en översatt port skulle Caddy annonsera UDP på fel port. Webbläsaren hade försökt i onödan och sedan fallit tillbaka.
- **Caddy byggs alltid,** också med `DEMO_TLS=http`. Det är en avbildning i stället för två vägar genom compose och skripten. Bygget tar någon minut första gången.
- **Ett eget certifikat (`tls internal`)** valdes bort: webbläsaren varnar, och det ser dåligt ut när demon visas.

## Att känna till
- **En TXT-post per DuckDNS-namn.** Om ett annat system förnyar sitt certifikat för samma namn i samma stund kan en av förnyelserna misslyckas, och Caddy försöker igen.
- **Modulen `caddy-dns/duckdns` har ingen licensfil** i sitt repo. Biblioteket den bygger på, `libdns/duckdns`, har MIT. Den används bara i demons Caddy, inte i Petvold.
- **Prövat:** Caddyfilen med `caddy adapt` för `http`, och utan `DEMO_TLS`. Med `duckdns` kommer den fram till modulen, som saknas i Caddy utan tillägg. `setup.sh` med fel port, kort token och rätt värden, och `docker compose config` med ny och gammal `.env`. Bygget av avbildningen är inte prövat här, eftersom miljön saknar Docker.

## Filer
- `deploy/demo/caddy/Dockerfile`
- `deploy/demo/Caddyfile`, `compose.yaml`, `setup.sh`, `reset.sh`
- `docs/teknik/demo.md`
