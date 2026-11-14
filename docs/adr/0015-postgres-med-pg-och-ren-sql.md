# 0015. Databasåtkomst med node-postgres och ren SQL

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

Skademotorns lagring ska skrivas mot Postgres (ADR 0004). Schemat är skrivet för hand i SQL och lägger regler i databasen: exclusion constraints, uppskjutna triggers och rättigheter per roll. Lagringen ska klara samma testsvit som minneslagret (ADR 0012).

## Beslut

- **Drivrutin:** node-postgres (`pg`) med en pool per modul och tjänsteroll.
- **Ren SQL** i lagringsklassen. Ingen ORM och ingen frågebyggare.
- **Typtolkning** på ett ställe (`createPool`): `date` blir `'YYYY-MM-DD'`, `bigint` och `numeric` blir heltal (och fel om de inte ryms säkert), `timestamptz` blir ISO-sträng i UTC.
- **Fel översätts** från SQLSTATE och constraint-namn till portens fel (`StoreConflictError`). Andra fel släpps igenom.
- **Varje modul ansluter med sin egen roll**, i drift och i tester. Rollens rättigheter är en del av det som testas.
- **Tester för lagringen** ligger i `modules/<modul>/test-db/` och körs med `npm run test:db`.

## Konsekvenser

- SQL:en syns och granskas som den är. Den matchar migreringarna rad för rad.
- Inga genererade typer från schemat. Mappningen mellan rader och domänobjekt skrivs för hand, och sviten fångar fel i den.
- Byte till en annan drivrutin, till exempel `postgres` (porsager), påverkar bara `*-store-postgres`.

## Alternativ

- **Prisma eller Drizzle:** typade frågor och migreringar, men de vill äga schemat och migreringarna, och exclusion constraints, uppskjutna triggers och rättigheter blir sidospår.
- **Kysely (frågebyggare):** bra typning utan ORM, men ett lager till för en handfull frågor.
- **`postgres` (porsager):** snabb och bra API, men `pg` är mer spridd och har stöd för alla typer vi behöver.

## Källor

- node-postgres: node-postgres.com
- PostgreSQL, *Appendix A. PostgreSQL Error Codes*: postgresql.org/docs/current/errcodes-appendix.html
