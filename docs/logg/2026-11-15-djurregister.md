# Djurregister: djur, id-nummer och ägarskap (PR #34)

**Datum:** 2026-11-15 **ADR:** 0024 (Föreslagen) **Moduler:** `animals` (ny), `api`

## Vad

Petvold har ett register över djuren: art, ras, kön, namn, födelse och död, med historik. Det har också id-nummer (chip, registreringsnummer, pass) som är unika, och ägare med giltighetstid. Djur går att hitta på chipnummer eller på ägare.

## Hur det fungerar

**Registrering** (`POST /v1/animals`):
1. `app.ts` validerar mot `RegisterAnimalRequest` och kontrollerar att marknaden ligger inom anroparens omfång. Roller bundna till klinik eller försäkringar får `403`.
2. `AnimalService.register` i `animals/src/index.ts`:
   - slår upp art, ras och kön via `ReferencePort` (koden måste finnas och vara aktiv, och rasen måste höra till arten)
   - normaliserar id-numren med `normalizeIdentifier`
   - kontrollerar part-id och att ägarskapet börjar efter födelsedatumet
3. `PostgresAnimalStore.register` skriver revision 1, id-numren och första ägarskapet i en transaktion. Ett nummer som redan finns stoppas av primärnyckeln `(type, value)` och blir `IdentifierTakenError` och sedan `409`. Då skrivs inget alls.

**Ägarbyte** (`POST /v1/animals/{id}/ownerships`):
1. `visibleAnimal` hämtar djuret och svarar `404` om det ligger utanför anroparens omfång, så att det inte syns att djuret finns.
2. `AnimalService.transfer` hittar det öppna ägarskapet och kontrollerar:
   - att det är en ny ägare
   - att den nya börjar efter den gamla
   - att djuret inte har dött före bytet
3. `PostgresAnimalStore.transfer` gör `update … set valid_to = $from where seq = $open and valid_to is null`. Påverkas ingen rad har någon annan hunnit före, och det blir `409`. Därefter görs `insert` av nästa ägarskap. Ordningen spelar roll: det unika indexet för öppna ägarskap tillåter inte två samtidigt, och triggern kräver att det förra har slutat på den nya startdagen.

**Rättelse** (`PUT /v1/animals/{id}`): hela uppsättningen uppgifter skickas med `basedOnRevision` och `reason` och sparas som en ny revision. `insert … where revision = max + 1` skyddar mot samtidiga ändringar.

## Val och avvägningar

- **Tre tabeller med olika regler** i stället för en tabell med JSON:
  - revisionerna läggs bara till
  - id-numren läggs bara till och är unika över alla djur
  - för ägarskapen får bara slutdatumet sättas

  Databasen kan upprätthålla varje regel med vanliga rättigheter, index och triggrar.
- **Ingen bitemporal historik för ägarskap.** Ett ägarbyte går inte att flytta bakåt i efterhand. Det räcker tills policymodulen finns, och ADR 0024 säger att en sådan rättelse blir en ny ADR.
- **`ReferencePort` i stället för ett beroende på `catalog`.** `ReferenceDataStore.get` har redan rätt form, så dev-servern skickar den direkt. API-lagret använder `CatalogService.getReference` när inget annat ges.
- **Bundna roller ser inga djur.** Det var enklast att bevisa att det är säkert, i stället för att gissa vilka djur som hör till en klinik. Kliniker är alltså utestängda tills ett eget beslut om dataminimering finns.
- **Marknad och art ändras aldrig.** Båda styr vem som ser djuret och vilka produkter som passar. En felregistrering rättas genom att djuret registreras om.
- **`PUT` utan `Idempotency-Key`** av samma skäl som för referensdata: `basedOnRevision` gör att en upprepning ger `409` och aldrig en dubbel ändring. Registrering, id-nummer och ägarbyte är `POST` och kräver nyckeln.

## Att känna till

- **Ny databasroll `animals_service`.** Lokalt behövs `create role animals_service …` eller `npm run dev:reset`.
- **Nya rättigheter i en sparad rollinställning:** `animals:read`, `animals:write` och `animal-registrar` läggs till via API:et. Lokalt är det gjort (version 4).
- **Dev-servern registrerar Bella** direkt via lagringen, med samma id som i exempelpolicyn (`ani_bella`).
- **Inte byggt än:**
  - kullar
  - händelser vid ägarbyte och dödsfall
  - kontroll av att parten finns
  - att skademotorn läser födelsedatum från registret i stället för från policyn

## Filer

- `modules/animals/src/index.ts`: typer, `AnimalService`, `normalizeIdentifier`, `ownerOn`, lagring i minnet
- `modules/animals/src/postgres.ts`: lagring i Postgres med transaktioner
- `db/migrations/0015_animals.sql`: tabeller, triggrar och rättigheter
- `modules/animals/test-suites/animal-store.ts`: gemensam testsvit för båda lagringarna
- `modules/animals/test/animal-service.test.ts`, `modules/animals/test-db/animal-store.test.ts`, `modules/api/test/animals.test.ts`
- `modules/api/src/app.ts`: sju operationer under `/v1/animals`
