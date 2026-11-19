# Körningar i API:t och back office (PR #99)

**Datum:** 2026-11-19 **ADR:** 0037 **Moduler:** scheduling, api, apps/backoffice

## Vad
Steg 3 i ADR 0037. Körningarna går att se och styra:
- **API:t** har anrop under `/v1/jobs` och `/v1/relay-dead-letters`.
- **Back office** har sidan Körningar: lista, historik, "Kör nu", paus och reläets döda poster.

## Hur det fungerar
1. **Lagringen:** `SchedulingStore` har `pause`, `resume`, `pauses` och `controls`. En paus och dess rad i spåret sparas i samma transaktion (migration 0040). `Scheduler.tick` hoppar över pausade körningar.
2. **Nästa körning:** `nextDailyRun` och `zonedTime` räknar fram den: dagens tid i marknadens tidszon om dagens körning inte gjorts, annars morgondagens. En tid som passerat betyder att körningen är försenad, och back office visar "Försenad" efter fem minuter.
3. **`jobs.ts`:** varje körning är en `JobRunner` med tre funktioner:
   - `execute`: hela resultatet
   - `summarize`: det som sparas i historiken
   - `join`: resultaten från flera marknader slås ihop till det svar de gamla anropen alltid gett

   `Scheduler.run` tar en egen funktion, så att API:t får hela resultatet medan historiken får sammanfattningen.
4. **Gamla anrop:** de kör en gång per marknad i anroparens omfång, med startsättet `api`. Ett domänfel från en marknad besvaras som förut.
5. **Döda poster:** "Skicka igen" går via reläet om det finns i installationen, annars direkt i lagringen. Reläet läser om de döda posterna var tionde sekund, så att en post som skickas igen via en annan server också försöks.
6. **Rättigheter:** `jobs:read` och `jobs:operate`. Den nya rollen `operations` har dem och `webhooks:read`.
7. **Back office:** `<pv-jobs>` och `<pv-job-detail>` med designsystemets kort och `<pv-event-log>` för spåret.

## Val och avvägningar
- **`{job}` och `{deadLetter}` som naturliga nycklar.** Konventionerna (ADR 0034) kräver att `{xId}` har ett prefix som `pol_`. En körnings namn och en död post (`källa:händelse`) är naturliga nycklar, som `{product}` och `{series}`. De står nu i `NATURAL_KEYS` och i `api-konventioner.md`.
- **De döda posterna är en egen samling,** `/v1/relay-dead-letters`. En adress direkt under en samling ska vara ett id, så `/v1/relay/dead-letters` gick inte.
- **"Kör nu" är synkront** och svarar när körningen är klar. Körningarna är korta för en installation per bolag. Blir de långa kan svaret bli `202` med en körning som pågår.
- **Paus gäller körningen i alla marknader,** inte en marknad i taget. Det är det enklaste att förstå, och "Kör nu" finns för en marknad.
- **Nästa körning visar den schemalagda tiden även när den passerat.** Först visade den klockan just nu, och det såg ut som att allt skulle köras nu.

## Att känna till
- **Utvecklingsservern** kör inte schemaläggaren som förval, så där är alla körningar "Försenad" tills någon trycker "Kör nu" eller startar med `PETVOLD_SCHEDULER=on`.
- **Efter inloggning** öppnar back office det första avsnitt användaren har rätt till. För `operations` är det Webhooks, eftersom rollen har `webhooks:read`.
- **Spåret i testet:** paus och återupptagande får samma tid när klockan står still i testet, så testet jämför utan ordning.

## Filer
- `modules/scheduling/src/index.ts`, `src/postgres.ts`, `test-suites/scheduling-store.ts`, `test/scheduler.test.ts`, `test-db/scheduling-store.test.ts`
- `db/migrations/0040_scheduling_control.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/api/openapi.yaml`, `src/app.ts`, `src/jobs.ts`, `src/relay.ts`, `src/composition.ts`, `src/conventions.ts`, `src/permissions.ts`, `src/dev-server.ts`, `test/jobs.test.ts` (ny)
- `apps/backoffice/src/views/jobs-view.ts` (ny), `src/views/job-detail.ts` (ny), `src/jobs-logic.ts` (ny), `src/views/labels.ts`, `src/components/app-shell.ts`, `src/permissions.ts`, `src/auth.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `test/jobs-logic.test.ts` (ny), `test/format.test.ts`, `e2e/jobs.spec.ts` (ny)
- `docs/funktion/korningar.md`, `docs/funktion/behorighet.md`, `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/teknik/arkitektur.md`, `docs/teknik/api-konventioner.md`
