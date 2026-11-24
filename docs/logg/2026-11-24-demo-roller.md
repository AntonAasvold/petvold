# Demon kan uppdateras med datan kvar (PR #156)

**Datum:** 2026-11-24 **ADR:** 0041 **Moduler:** inga, bara drift

## Vad
En uppdatering av demon med datan kvar (`docker compose pull api web && docker compose up -d`) stoppade på migrering 0064. Den ger rättigheter till rollen `accounting_service`, och demons roller skapades bara när databasen skapades. Nu skapar tjänsten `roles` de roller som saknas före varje migrering.

## Hur det fungerar
- **`initdb/01-roles.sh`** skapar bara roller som saknas. Den gör ett `create role` per modul med `format(%I, %L)` och `\gexec` i psql, och hoppar över roller som redan finns i `pg_roles`.
- **Tjänsten `roles`** i `compose.yaml` kör samma skript med Postgres-avbildningen mot `postgres` (`PGHOST`, `PGPASSWORD`) och stannar sedan. `migrate` väntar på att den är klar.
- **När databasen skapas** körs skriptet av initdb som förut. Sedan körs det en gång till av `roles`, och gör då ingenting.

## Val och avvägningar
- **Samma skript på båda ställena,** så att listan över moduler bara finns på ett ställe.
- **Postgres-avbildningen i stället för `migrate`,** eftersom avbildningen för Petvold saknar psql. Rollerna skapas av ägarrollen, som också kör migreringarna.
- **Lösenordet för en befintlig roll ändras inte.** Skriptet skapar bara det som saknas.

## Att känna till
- **Lokalt** har `db/init` samma begränsning. Där skapas databasen om med `docker compose down -v` och `npm run dev:up` när en modul tillkommer.
- **Prövat** mot Postgres 16: en tom databas fick alla 14 roller. En andra körning gjorde ingenting. Efter att `accounting_service` tagits bort skapades den igen och kunde logga in. `docker compose config` visar att `migrate` väntar på `roles`.

## Filer
- `deploy/demo/initdb/01-roles.sh`, `compose.yaml`, `reset.sh`
- `docs/teknik/demo.md`
