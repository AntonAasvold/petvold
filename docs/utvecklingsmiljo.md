# Utvecklingsmiljö

Från tom dator till körande tester. Beslutet finns i ADR 0013.

## Förutsättningar

| Verktyg | Varför | Installera |
| --- | --- | --- |
| Node 24 (LTS) | Versionen står i `.node-version`, samma i CI | `fnm install` i repot (eller nvm, mise, Volta) |
| `docker compose` | Postgres lokalt | OrbStack (`brew install orbstack`), Colima eller Docker Desktop |

Inget annat behövs. dbmate och Postgres-klienten installeras med `npm ci`.

**Licens för OrbStack:** OrbStack är gratis för privat bruk men kräver licens vid kommersiellt bruk. Den dag Petvold blir kommersiellt köper vi licens eller byter till Colima. Repot kräver bara `docker compose`, så bytet ändrar ingenting här.

## Första gången

```
fnm install            # Node enligt .node-version
npm ci
cp .env.example .env
npm run dev:up         # Postgres, roller, testdatabas och migreringar
npm test               # enhets-, egenskaps- och kontraktstester
npm run test:db        # databastester mot Postgres
npm run dev            # API:et på http://localhost:8787, startar om vid ändringar
```

`npm run dev` sparar ärenden, beslut, ledger, outbox och idempotensnycklar i Postgres (`petvold`) när `CLAIMS_DATABASE_URL` finns i `.env`. Data finns kvar mellan omstarter, och `npm run dev:reset` tömmer allt. Ta bort raden ur `.env` för att köra i minnet. Försäkringar och regler är fortfarande exempeldata i minnet (Bella) tills policy- och produktmodulerna finns.

Servern skriver ut vilken lagring den använder och loggar varje händelse som reläet publicerar.

## Testa API:et för hand

- **API-sidan:** http://localhost:8787/docs. Den genereras från `openapi.yaml` med Scalar. Token `dev-handler` är förifylld, och varje anrop har färdiga exempel (öroninflammation, korsbandsskada, behandling före försäkringens start).
- **Exempelanrop:** `examples/claims.http` i VS Code med tillägget REST Client (föreslås när du öppnar repot). Filen går igenom hela flödet: förhandsbesked, automatisk reglering, handläggarbeslut med `inputHash`, försäkringsbelopp, omprövning och felfall.

Exemplen finns i kontraktet (`components/examples`). Testerna kontrollerar att de följer schemat och ger det utfall som beskrivs.

## Kommandon

| Kommando | Gör |
| --- | --- |
| `npm run dev:up` | Startar Postgres och kör migreringar mot `petvold` och `petvold_test` |
| `npm run dev:down` | Stoppar Postgres men behåller datan |
| `npm run dev:reset` | Raderar all lokal data och startar om från tomt |
| `npm run db:migrate` | Kör nya migreringar mot båda databaserna |
| `npm run db:new <namn>` | Skapar en ny migreringsfil i `db/migrations/` |
| `npm run test:db` | Databastester mot `TEST_DATABASE_URL` |

Porten är 5432. Om den är upptagen: sätt `PETVOLD_PG_PORT` och ändra porten i `.env`.

## Databasen

- **Version:** samma Postgres-version och Debian-bas som CloudNativePG i drift (`compose.yaml`). Uppgradera båda samtidigt.
- **Databaser:** `petvold` för utveckling och `petvold_test` för tester.
- **Roller:** migreringar körs som ägaren `petvold`. Varje modul har en egen tjänsteroll (`claims_service`) med bara de rättigheter migreringarna ger den. Rollerna skapas av `db/init/` lokalt och av CloudNativePG (`spec.managed.roles`) i drift.
- **Migreringar:** dbmate med ren SQL i `db/migrations/`. Varje fil har `-- migrate:up` och `-- migrate:down`. En körd migration ändras aldrig. Gör en ny i stället.

## Felsökning

- **`dev:up` hänger:** `docker compose logs postgres`.
- **Ändrat i `db/init/`:** init-skripten körs bara när databasen skapas. Kör `npm run dev:reset`.
- **Fel Node-version:** `npm ci` varnar enligt `engines`. Kör `fnm use`.
