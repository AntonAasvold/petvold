# Webhooks, steg 3: döda händelser och gallring (PR #78)

**Datum:** 2026-11-16 **ADR:** 0033 **Moduler:** webhooks, api

## Vad
En person kan se alla händelser som inte kom fram och skicka dem igen. En prenumeration där allt har misslyckats i fem dygn stängs av automatiskt. Innehållet i gamla händelser tas bort efter 30 dagar. Därmed är ADR 0033 byggd. Dessutom har API-sidan fått beskrivningar för varje tagg, efter en fråga om de två avsnitten för webhooks.

## Hur det fungerar
1. **Skicka igen:** `WebhookService.retry` kräver ett dött utskick vars innehåll finns kvar. Det blir `pending` med `attempts: 0` och `retriedAt`. `nextAttemptAt` räknar de tre dygnen från `retriedAt` i stället för `createdAt`. `retryAll` gör samma sak för alla döda utskick i en prenumeration.
2. **Avstängning:** efter varje försök anropar arbetaren `noteOutcome`.
   - Första misslyckandet sätter `failingSince` med `setFailingSince`, som inte ger en ny revision. Arbetaren krockar alltså inte med en person som ändrar prenumerationen.
   - En leverans tar bort `failingSince`.
   - Ett misslyckande mer än fem dygn efter `failingSince` stänger av prenumerationen.
3. **Gallring:** arbetaren kör `prune` högst en gång i timmen. Levererade och döda utskick vars senaste försök är äldre än 30 dagar får `event.data` tömt och `prunedAt` satt. Kuvertet, svaret och antalet försök finns kvar.
4. **API:** `GET /v1/webhook-deliveries` för alla prenumerationer, och två operationer för att skicka igen.
5. **API-sidan:** taggarna i `openapi.yaml` har en beskrivning. Taggen `webhooks` heter "webhook subscriptions" på sidan (`x-displayName`) och pekar på `asyncapi.yaml`. Sajtens meny har en länk till händelsernas kontrakt.

## Val och avvägningar
- **Antalet försök börjar om** när en person skickar igen. Senaste fel och svar finns kvar tills nästa försök. En logg per försök har vi inte behövt.
- **`failing_since` ligger utanför revisionen.** Revisionen gäller det en person ändrar. En person som aktiverar prenumerationen igen tar bort `failingSince`.
- **Gallringen tömmer `data` men behåller kuvertet.** Mottagaren kan fortfarande se vilken händelse det var, men innehållet går inte att skicka igen.
- **Två avsnitt för webhooks på API-sidan:** det gamla avsnittet `webhooks` i OpenAPI tas bort i #77. Här fick taggen ett tydligare namn och en hänvisning till AsyncAPI.

## Att känna till
- Gallringen körs av arbetaren, alltså i varje instans. Den är idempotent, så det spelar ingen roll om flera kör den.
- `sequence` som ADR:en nämner finns inte med. Mottagaren sorterar på `time`.

## Filer
- `modules/webhooks/src/index.ts`, `src/postgres.ts`, `test/webhook-service.test.ts`, `test-suites/webhook-store.ts`
- `db/migrations/0035_webhooks_retries.sql`, `db/test/claims-schema.test.ts`
- `modules/api/src/app.ts`, `openapi.yaml` (operationer och taggar), `test/webhooks.test.ts`
- `scripts/build-site.ts`
- `docs/funktion/webhooks.md`, `behorighet.md`, `docs/teknik/arkitektur.md`
