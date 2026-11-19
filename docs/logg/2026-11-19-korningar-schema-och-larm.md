# Schemaändringar med fyra ögon och larm för körningar (PR #100)

**Datum:** 2026-11-19 **ADR:** 0037 **Moduler:** scheduling, api, webhooks, apps/backoffice

## Vad
Steg 4 i ADR 0037:
- **Schemaändringar:** en körnings tid går att ändra, och körningen kan stängas av, med fyra ögon.
- **Händelsen `job.failed`** går till webhooks.
- **`/healthz`** larmar om körningar som misslyckats, är sena eller är pausade.

## Hur det fungerar
1. **Lagringen:** `scheduling.job_schedule_change` har förslagen och `scheduling.job_setting` det godkända schemat (migration 0041).
   - Ett godkännande gör förslaget till schema i samma transaktion och räknar upp versionen.
   - Databasen vägrar att den som föreslog godkänner (`check`) och tillåter bara en väntande ändring per körning (ett unikt index med `where status = 'pending'`).
2. **Schemaläggaren:** `effectiveSchedule` väljer det godkända schemat före förvalet. `tick` hoppar över en avstängd körning som den hoppar över en pausad. API:t visar schemat med `enabled` och `version`, där version 0 är förvalet.
3. **`onFailed`** i `SchedulerDeps` anropas efter varje misslyckad körning. Kompositionsroten lägger en `job.failed` i webhooks kö. Ett fel där loggas bara och stoppar inte schemaläggaren.
4. **`Scheduler.health`** räknar fram tre listor:
   - `failed`: den senaste körningen i en marknad misslyckades
   - `late`: mer än en timme efter tiden
   - `paused`: pausade körningar

   `server.ts` lägger dem i `/healthz` och sätter `degraded`.
5. **Back office:** kortet Schema på körningens sida visar tiden, en ändring som väntar och formuläret för att föreslå en ny. Den som föreslog ser "Någon annan måste godkänna din ändring" och kan dra tillbaka sin ändring. Spåret visar både pauser och schemaändringar.

## Val och avvägningar
- **`job.failed` utan outbox.** Modulen `scheduling` har ingen outbox, och händelsen är ett driftlarm, inte en affärshändelse. Den går direkt till webhooks kö. Går Petvold ner mellan fel och kö syns felet ändå i historiken och i `/healthz`.
- **Felet följer inte med i händelsen.** Ett fel kan nämna en kund. Mottagaren hämtar det ur historiken med `jobs:read`.
- **Sen efter en timme i hälsan, men efter fem minuter i back office.** Hälsan ska inte larma för en körning som bara väntar på minutens kontroll eller på en långsam körning före. Back office visar "Försenad" tidigare, för den som tittar.
- **En avstängd körning är inte ett larm.** Det har två personer beslutat. En pausad körning larmar, eftersom paus görs av en person utan fyra ögon.
- **Körningens id som ämne.** En körning har ingen policy eller skada att peka på, så webhook-katalogen fick `runId` som ämne.

## Att känna till
- **Två tokens för fyra ögon lokalt:** `dev-operations` och `dev-operations-2`.
- **Testerna jämför utan ordning** där två saker får samma tid när klockan står still.

## Filer
- `modules/scheduling/src/index.ts`, `src/postgres.ts`, `test-suites/scheduling-store.ts`, `test/scheduler.test.ts`, `test-db/scheduling-store.test.ts`
- `db/migrations/0041_scheduling_schedule.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/api/openapi.yaml`, `asyncapi.yaml`, `src/app.ts`, `src/composition.ts`, `src/server.ts`, `src/permissions.ts`, `src/dev-server.ts`, `test/jobs.test.ts`, `modules/webhooks/src/index.ts`
- `apps/backoffice/src/views/job-detail.ts`, `src/views/jobs-view.ts`, `src/jobs-logic.ts`, `src/views/labels.ts`, `src/auth.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `test/jobs-logic.test.ts`, `e2e/jobs.spec.ts`
- `docs/funktion/korningar.md`, `docs/funktion/behorighet.md`, `docs/funktion/webhooks.md`, `docs/teknik/drift.md`, `docs/teknik/arkitektur.md`
