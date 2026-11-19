# Schemaläggaren och historiken för körningar (PR #97)

**Datum:** 2026-11-19 **ADR:** 0037 **Moduler:** scheduling (ny), api

## Vad
Steg 1 i ADR 0037. Petvold kör nu förnyelse, utgång av ansökningar och förslag, och gallring varje dag:
- per marknad, i marknadens tid
- en server i taget
- med historik över vad varje körning gjorde

Tidigare fanns de bara som anrop som något utanför Petvold måste starta.

## Hur det fungerar
1. **Modulen `scheduling`** vet inget om förnyelser. En körning är en `JobDefinition` med namn, schema och en funktion som tar marknad, dag, `dryRun` och vem. `modules/api/src/jobs.ts` registrerar de fyra och gör om resultaten till antal och id:n.
2. **`Scheduler.tick`** går igenom varje körning och marknad. `dailyDue` säger om tiden kommit i marknadens tidszon och om ingen schemalagd körning gjorts för den dagen. Varje körning sparar `scheduledFor`, så att en dag körs en gång också efter en omstart.
3. **Lånen:** `tryLease` tar eller förnyar lånet i en enda sats. Lånet förnyas var tredjedel av sin tid medan körningen pågår och släpps efteråt. En schemalagd körning som inte får lånet hoppar över utan att spara något. En körning för hand sparas som `skipped`, inför steg 3.
4. **Historiken:** `startRun` före och `finishRun` efter. Ett fel sparas med sitt meddelande, högst 2 000 tecken, och nästa marknad körs ändå. Historik äldre än 400 dagar tas bort en gång per dag.
5. **Marknaderna** är de som har en produkt eller en regel för gallring. De räknas fram vid varje omgång, så att en ny marknad kommer med utan omstart.
6. **Starten:** `server.ts` startar schemaläggaren med en kontroll i minuten. `dev-server.ts` gör det bara med `PETVOLD_SCHEDULER=on`.

## Val och avvägningar
- **Lån i en tabell, inte rådgivande lås** (ADR 0037). Lånet syns i databasen och kan visas i back office i steg 3.
- **Ingen fencing token.** Körningarna tål att köras två gånger.
- **Inte i dev-servern som förval.** Utan historik skulle den första omgången genast förnya och låta exempeldatan gå ut, och flödestesterna räknar med den som den är.
- **Resultatet byggs i `jobs.ts`,** inte i modulerna. `expireApplications` returnerar hela ansökningar med svar om hälsa, och de får inte hamna i historiken. Därför sparas bara id:n.
- **De befintliga anropen sparar ännu ingen historik.** De kör för flera marknader i ett svar. Det görs i steg 3, tillsammans med `/v1/jobs`.

## Att känna till
- **`pg` och datum:** andra moduler ställer om hur `pg` läser datum och tider, och det gäller globalt. `postgres.ts` läser därför tider och datum både som `Date` och som text.
- **En befintlig lokal databas** behöver rollen `scheduling_service` innan migration 0038. Init-skriptet körs bara när databasen skapas.
- **Testet för migreringar** i `db/test/claims-schema.test.ts` har fått 0038.

## Filer
- `modules/scheduling/` (ny): `src/index.ts`, `src/postgres.ts`, `test-suites/scheduling-store.ts`, `test/scheduler.test.ts`, `test/scheduling-store.test.ts`, `test-db/scheduling-store.test.ts`
- `modules/api/src/jobs.ts` (ny), `src/composition.ts`, `src/server.ts`, `src/dev-server.ts`, `test/composition.test.ts`, `package.json`
- `db/migrations/0038_scheduling.sql` (ny), `db/init/01-roles-and-databases.sql`, `db/test/claims-schema.test.ts`, `.env.example`, `package-lock.json`
- `docs/funktion/korningar.md` (ny), `docs/README.md`, `docs/teknik/arkitektur.md`, `docs/teknik/drift.md`, `docs/teknik/utvecklingsmiljo.md`
