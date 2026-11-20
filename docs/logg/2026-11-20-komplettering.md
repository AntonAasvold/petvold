# Komplettering av skador (PR #106)

**Datum:** 2026-11-20 **ADR:** 0036 (steg 3), 0037 (steg 5) **Moduler:** claims-core, claims-store-memory, claims-store-postgres, decisioning, api, webhooks, apps/backoffice

## Vad
En handläggare kan begära underlag som saknas av kunden eller kliniken. Ärendet väntar tills begäran är besvarad, återkallad eller har gått ut. En daglig körning påminner och låter begäranden gå ut. Ärendet visar när underlaget blev komplett, för fristen på en månad i FAL 7 kap. 1 §.

## Hur det fungerar
1. **Anropet:** `POST /v1/claims/{id}/information-requests` går till `ClaimsService.requestInformation`. Den gör så här:
   - kontrollerar mottagare, koder och anteckning
   - kontrollerar att ärendet inte är stängt och inte har ett öppet förslag
   - hämtar skadereglerna för ärendets policy på behandlingsdagen
   - räknar fram svarsdatum och påminnelsedag med `informationDates` från dagen för begäran i marknadens tid

   Begäran sparas med `saveInformationRequest` och händelsen `claim.information_requested` i samma transaktion.
2. **Lagringen:**
   - **Postgres:** `claims.information_request` (migration 0042). Ett unikt index tillåter en öppen begäran per ärende och mottagare. En trigger vägrar en begäran på ett stängt ärende (`PVC01`, samma kod som för beslut), ändringar av det som begärdes, och steg bakåt i läget.
   - **Minnet:** samma regler i koden.
   - **Den gemensamma testsviten** provar båda.
3. **Svar och återkallelse** går genom `updateInformationRequest(next, from, events)`. Den ersätter raden bara om läget fortfarande är ett av `from`, och för en påminnelse bara om ingen påminnelse har satts. Annars kastar den `StoreConflictError('information_closed')`.
4. **Körningen:**
   - `claims.information-requests` är registrerad i `jobs.ts` och anropar `informationRequestRun` per marknad.
   - `informationRequestsDue` hämtar öppna begäranden som har nått påminnelsedagen eller passerat svarsdatumet.
   - `dueAction` avgör vad som ska göras med var och en.
   - En konflikt betyder att en annan server hann först, och begäran hoppas över.
   - `dryRun` räknar utan att ändra.
5. **Läget och fristen:**
   - `awaiting-information` kommer efter `awaiting-approval` i ordningen.
   - `basisCompleteAt` och `informationMissing` räknas fram i `claims-core/src/information.ts`.
   - Minnet och Postgres använder samma funktioner. Postgres hämtar begärandena för hela sidan i en fråga.
   - `getClaim` lägger till `daysSinceBasisComplete`.
6. **Beslut** vägras med `409` medan en begäran är öppen. Det kontrolleras i tjänsten, inte i databasen, så att en automatisk omprövning efter en policyändring fortfarande går igenom.
7. **Back office:**
   - `<pv-claim-information>` med kortet för öppna och utgångna begäranden och formuläret, som fälls ut med en knapp.
   - Fliken och kolumnen i kön.
   - Raden med dagar kvar att betala.
   - Händelserna i historiken.

## Val och avvägningar
- **Två händelser utöver ADR 0036:**
  - `claim.information_reminded`, så att meddelandemodulen i steg 6 kan skicka påminnelsen till kunden utan att läsa skademotorns tabeller.
  - `claim.information_cancelled`, eftersom en begäran som inte behövs, eller ett ärende som stängs, måste kunna stänga den.
- **Återkallelse av en begäran** finns inte i ADR 0036. Utan den skulle en begäran som gjorts av misstag låsa ärendet till svarsdatumet.
- **När underlaget blev komplett:**
  - **Utgången begäran:** tiden flyttas till utgången, eftersom handläggaren då beslutar på det som finns. Lagen räknar månaden från att utredningen lagts fram, så det här är en tolkning till bolagets fördel, och den syns i dokumentationen.
  - **Återkallad begäran:** tiden flyttas inte. Underlaget räknas som komplett redan före begäran, vilket är till kundens fördel.
- **Svarsdatumet är den sista dagen att svara.** Begäran går ut dagen efter, så att kunden har hela dagen på sig.
- **En begäran per mottagare** i stället för en per ärende, så att journalen från kliniken och kvittot från kunden kan begäras samtidigt.
- **Ett sent svar stänger en utgången begäran.** Underlaget kom ju in, och markeringen "underlag saknas" vore då fel.
- **Kön sorteras på `basisCompleteAt` bland de rader som är hämtade,** inte i API:t. En sortering i API:t behöver en markör som bygger på sorteringen och kommer när köerna behöver den.
- **Påminnelsen blir inget meddelande än.** Den syns som händelse och i kortet. Meddelandena till kunden kommer i steg 6.

## Att känna till
- **Svaret från back office** sätter `receivedAt` till när svaret registreras. API:t tar ett tidigare `receivedAt` för underlag som kom in tidigare.
- **Historiken** visar inte utgången när ett sent svar har stängt en utgången begäran, eftersom raden bara har en stängning. Händelserna i outboxen har båda.
- **E2E-testet för avvisning** var beroende av datumet. Från den 20 november föreslog bedömningen avslag, och beslutskortet fick ett fält till som heter "Reason". Testet söker nu fältet i kortet "Stäng utan beslut".
- **Rollinställningen:** en sparad inställning behöver `npm run roles:sync -- --apply` för att `handler` ska få `claims:request-information`.

## Filer
- `modules/claims-core/src/information.ts` (ny), `src/types.ts`, `src/ports.ts`, `src/service.ts`, `test/information.test.ts` (ny), `test-suites/claims-store.ts`
- `modules/claims-store-memory/src/index.ts`, `modules/claims-store-postgres/src/index.ts`, `test-db/*.test.ts`
- `db/migrations/0042_claims_information_request.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/decisioning/src/index.ts`: `informationRequest` i skadereglerna
- `modules/api/openapi.yaml`, `asyncapi.yaml`, `src/app.ts`, `src/jobs.ts`, `src/composition.ts`, `src/permissions.ts`, `src/wiring.ts`, `test/api.test.ts`, `test/jobs.test.ts`, `modules/webhooks/src/index.ts`
- `apps/backoffice/src/components/claim-information.ts` (ny), `src/information-logic.ts` (ny), `src/decide.ts`, `src/history.ts`, `src/views/claim-detail.ts`, `src/views/claims-queue.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `test/information-logic.test.ts` (ny), `e2e/register.spec.ts`
