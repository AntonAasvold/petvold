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

`npm run dev` sparar ärenden, beslut, ledger, outbox och idempotensnycklar i Postgres (`petvold`) när `CLAIMS_DATABASE_URL` finns i `.env`. Data finns kvar mellan omstarter, och `npm run dev:reset` tömmer allt. Ta bort raden ur `.env` för att köra i minnet. Rollinställningen sparas i Postgres när `ACCESS_DATABASE_URL` finns i `.env`, regeluppsättningarna när `DECISIONING_DATABASE_URL` finns och referensdatan när `CATALOG_DATABASE_URL` finns. Första gången publiceras exempelreglerna som `SE-HUND-VV@1`, exempeldata för arter, kön och raser läses in från `modules/catalog/seed/reference-data.json`, exempelprodukten `SE-HUND-VV-LIV@2026.2` (Bellas produkt) publiceras från `modules/catalog/seed/products.json`, och Bella registreras i djurregistret när `ANIMALS_DATABASE_URL` finns, annars i minnet. En Bella som registrerades före migration 0016 är stängd för uppslagning. Öppna henne med `PUT /v1/animals/ani_bella` och `"allowLookup": true`, eller kör `npm run dev:reset`. Parterna sparas i Postgres när `PARTIES_DATABASE_URL` finns, och Bellas ägare `pty_owner001` registreras första gången. En befintlig lokal databas behöver rollen `parties_service`: `create role parties_service login password 'parties_service'`, eller `npm run dev:reset`. En befintlig lokal databas behöver rollen `animals_service`: `create role animals_service login password 'animals_service'`, eller `npm run dev:reset`. En befintlig lokal databas behöver rollen `catalog_service`: kör `npm run dev:reset`, eller skapa rollen med `create role catalog_service login password 'catalog_service'`. Policyerna sparas i Postgres när `POLICIES_DATABASE_URL` finns, och Bellas policy `pol_bella` läggs in första gången. Skademotorn läser policyerna från modulen. En befintlig lokal databas behöver rollen `policies_service`: `create role policies_service login password 'policies_service'`, eller `npm run dev:reset`. Kör `npm run roles:sync -- --apply` för att få de nya rättigheterna i en sparad rollinställning. Körningarnas lån och historik sparas i Postgres när `SCHEDULING_DATABASE_URL` finns. En befintlig lokal databas behöver rollen `scheduling_service` innan `npm run db:migrate`, på samma sätt som `communications_service`. Dev-servern startar inte schemaläggaren, eftersom den första omgången annars genast skulle förnya och låta exempeldatan gå ut. Starta den med `PETVOLD_SCHEDULER=on npm run dev`. Prenumerationer och utskick av webhooks sparas i Postgres när `WEBHOOKS_DATABASE_URL` finns. En befintlig lokal databas behöver rollen `webhooks_service` innan `npm run db:migrate`, på samma sätt som `communications_service`. Dev-servern har en fast nyckel för hemligheterna och tillåter `http://localhost` som adress. Kundmeddelandena sparas i Postgres när `COMMUNICATIONS_DATABASE_URL` finns. En befintlig lokal databas behöver rollen `communications_service` innan `npm run db:migrate`: `docker compose exec postgres psql -U petvold -c "create role communications_service login password 'communications_service'"`, eller `npm run dev:reset`. Meddelanden skapas bara av händelser som reläet inte har publicerat än, så exempeldatans policyer får försäkringsbrev först efter `npm run dev:reset`. Exempelprodukten `SE-HUND-BAS@2026.1` får prisvillkor (`SE-HUND-TERMS`) bara i en ny databas, eftersom en publicerad produktversion aldrig ändras. Kör `npm run dev:reset` för att prova kampanjkoden `PUPPY2026` lokalt. Dokumenten sparas i Postgres när `DOCUMENTS_DATABASE_URL` finns, och filerna i SeaweedFS när `PETVOLD_DOCUMENTS_BUCKET` finns (ADR 0038). `npm run dev:up` startar SeaweedFS med S3 på port 8333 och skapar hinken `petvold-documents`, och nycklarna finns i `dev/seaweedfs/s3.json`. En befintlig lokal databas behöver rollen `documents_service` innan `npm run db:migrate`, på samma sätt som `communications_service`. Dev-servern har en fast nyckel för länkarna, så att en länk fungerar efter en omstart. Stannar dev-servern för att arkivet inte svarar, kör `npm run dev:up` och spara en fil så att `tsx watch` startar om. `npm run dev:up` startar också Gotenberg 9.1.0 på port 3100 (`PETVOLD_GOTENBERG_URL`), utan nätåtkomst för Chromium. Flödestesterna i back office körs utan Gotenberg. Betalarkonton och premieplaner sparas i Postgres när `BILLING_DATABASE_URL` finns (ADR 0040). En befintlig lokal databas behöver rollen `billing_service` innan `npm run db:migrate`, på samma sätt som `communications_service`. Planer görs bara av händelser som reläet inte har publicerat än, så exempeldatans policyer får planer först efter `npm run dev:reset`. Inbetalningarna sparas i Postgres när `PAYMENTS_DATABASE_URL` finns. En befintlig lokal databas behöver rollen `payments_service` innan `npm run db:migrate`, på samma sätt som `communications_service`. Dev-servern har låtsasbanken för `SE:SEK` med en fast hemlighet, se [Premier och betalningar](../funktion/premier.md#låtsasbanken-fake).

Servern skriver ut vilken lagring den använder och loggar varje händelse som reläet publicerar.

**Exempeldata** (`modules/api/src/seed.ts`), för att ett gränssnitt ska ha något att visa:

| Vad | Id | Visar |
| --- | --- | --- |
| Anna och Bella, labrador i Stockholm | `pty_owner001`, `ani_bella`, `pol_bella` | Policy med tillägg (`SE-HUND-VV-LIV`) |
| Bellas öroninflammation i juni | `clm_021877` | Automatiskt beslut (`decided`) |
| Bellas öra igen i september | `clm_033410` | Automatiskt beslut där kunden begärt prövning (`review-requested`) |
| Bellas korsbandsoperation | `clm_048213` | Väntar på handläggare (`awaiting-decision`) |
| Bellas främmande kropp | `clm_050977` | Förslag över handläggarens gräns som väntar på attest (`awaiting-approval`) |
| Erik och Doris, golden retriever i Göteborg | `pty_owner002`, `ani_doris` | Policy på `SE-HUND-BAS`, prissatt av tariffen |
| Sara, Max och Ludde i Malmö | `pty_owner003`, `ani_max`, `ani_ludde` | Två policyer i ett hushåll, Ludde med grupprabatt |
| Saras katt Smilla | `ani_smilla` | Ett djur utan försäkring |
| Lena och Kajsa i Uppsala | `pty_owner004`, `ani_kajsa` | Ansökan på `SE-HUND-PLUS`, godkänd med förbehåll för öroninflammation (`ORA-OTIT`) |
| Lenas Rocky | `ani_rocky` | Ansökan som väntar på manuell prövning (`GET /v1/applications?status=referred`). `dev-underwriter` kan besluta, efter `npm run roles:sync -- --apply` i en befintlig databas. |
| Lenas Sixten, 12 år | `ani_sixten` | Ansökan som avslagits med skälet `too-old` |
| Kundmeddelanden | `GET /v1/notices` | Försäkringsbrev för varje policy och avslaget för Sixten, som väntar på dokumentsystemet (token `dev-documents`) |

De nya policyerna tecknas med dagens datum första gången servern startar, så deras id skiljer sig mellan databaser. Hitta dem med `GET /v1/policies?policyholderPartyId=pty_owner003`, och ansökningarna med `GET /v1/applications?policyholderPartyId=pty_owner004`. Teckningsreglerna `SE-HUND-UW@1` läses från `modules/api/seed/underwriting-rules.json`, med frågorna på svenska och engelska. Hälsofrågorna för produkten finns på `GET /v1/application-questions?productVersion=SE-HUND-PLUS@2026.1&species=dog`. En befintlig lokal databas får de nya delarna vid nästa start, men Bellas skador och policyer bara om de saknas. Kör `npm run dev:reset` för att börja om.

**Back office:** `npm run dev` i en terminal och `npm run ui:dev` i en annan. Appen startar på http://localhost:5180, och man loggar in med en dev-token. Flödestesterna körs med `npm run ui:e2e`. Första gången behövs `npx playwright install chromium` i `apps/backoffice`. Se [Back office](backoffice.md).

**Gränssnitt i webbläsaren:** dev-servern tillåter anrop från `http://localhost:5180` (back office), `http://localhost:5173` (Vite) och `http://localhost:3000`. Ange andra adresser med `PETVOLD_CORS_ORIGINS`, kommaseparerat. `GET /v1/me` visar vad varje dev-token får göra.

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
| `npm run demo:seed` | Fyller en ny installation med sex månaders testdata genom API:t. Se [Demon](demo.md). |
| `npm start` | Startar servern för drift (`server.ts`). Kräver alla databasadresser, `PETVOLD_VERSION` och inloggning. Se [Drift](drift.md). |
| `npm run roles:sync` | Visar standardroller och standardrättigheter som saknas i den sparade rollinställningen. Med `-- --apply` sparas de som en ny version. |
| `npm run erasures:reapply` | Kör alla godkända anonymiseringar igen, efter en återställning från säkerhetskopia (ADR 0028) |
| `npm run site` | Bygger dokumentationssajten i `_site/`: all Markdown i `docs/` och README som HTML, och API-sidan från `openapi.yaml`. Stoppar vid trasiga länkar. |

Porten är 5432. Om den är upptagen: sätt `PETVOLD_PG_PORT` och ändra porten i `.env`.

## Databasen

- **Version:** samma Postgres-version och Debian-bas som CloudNativePG i drift (`compose.yaml`). Uppgradera båda samtidigt.
- **Databaser:** `petvold` för utveckling och `petvold_test` för tester.
- **Roller:** migreringar körs som ägaren `petvold`. Varje modul har en egen tjänsteroll (`claims_service`) med bara de rättigheter migreringarna ger den. Rollerna skapas av `db/init/` lokalt och av CloudNativePG (`spec.managed.roles`) i drift.
- **Migreringar:** dbmate med ren SQL i `db/migrations/`. Varje fil har `-- migrate:up` och `-- migrate:down`. En körd migration ändras aldrig. Gör en ny i stället.

## Felsökning

- **`dev:up` hänger:** `docker compose logs postgres`.
- **Ändrat i `db/init/`:** init-skripten körs bara när databasen skapas. Kör `npm run dev:reset`. För att behålla data kan du skapa en ny roll för hand i stället, till exempel `docker compose exec postgres psql -U petvold -c "create role access_service login password 'access_service'"`, och sedan köra `npm run db:migrate`.
- **Fel Node-version:** `npm ci` varnar enligt `engines`. Kör `fnm use`.
