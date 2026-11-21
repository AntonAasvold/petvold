# Partens livscykel: sökning på namn, nummer som tas bort, begränsning och avslut (PR #120)

**Datum:** 2026-11-21 **ADR:** 0039 **Moduler:** parties, api, apps/backoffice

## Vad
Back office kan nu sköta en part genom hela livet:
- hitta den på namn eller e-post
- rätta ett nummer genom att ta bort det och lägga till det rätta
- begränsa behandlingen och häva begränsningen
- avsluta parten och öppna den igen

## Hur det fungerar
1. **Sökning:** `POST /v1/parties/searches` tar antingen ett nummer eller `{ text }`.
   - Lagret söker i senaste revisionens namn och e-post med `ilike`, där `%` och `_` behandlas som vanliga tecken.
   - Bara parter som inte är anonymiserade och som ligger på anroparens marknader kommer med, högst 50 och sorterade efter namn.
   - En begränsad part filtreras bort i API:t som förut.
2. **Nummer:**
   - `party_identifier` får ett id (`pid_`) och kolumner för borttagning (migration 0049).
   - Primärnyckeln är nu id:t, och ett unikt index gäller bara nummer som inte tagits bort.
   - Tjänsterollen får bara uppdatera kolumnerna för borttagning, och en trigger tillåter det en gång.
   - `removedIdentifiers` visar historiken, maskerad.
3. **Begränsning:** tabellen `parties.restriction` har händelserna `restrict` (med `until`) och `lift`.
   - `restrictedUntil` räknas fram ur den senaste händelsen, från tabellen eller från en avslagen radering (`restrictionFrom`).
4. **Avslut:** tabellen `parties.party_status` har händelserna `end` (med orsak och datum) och `reopen`, och `ended` räknas fram ur den senaste (`endingFrom`).
   - `marketOf` och `postalCodeOf` ger null för en avslutad part, så att inget nytt pekar på den.
   - Orsaken måste passa partens typ: `deceased` för en person och `dissolved` för en organisation.
5. **API:t** nekar ett avslut med `409` när parten är försäkringstagare på en policy som löper, och anger policyerna i svaret. Kontrollen ligger i API:t, eftersom `parties` aldrig läser policyernas tabeller.
6. **Anonymiseringen** tömmer också skälen i de nya tabellerna.
7. **Back office:**
   - **Parter:** sökning på namn eller e-post med en lista över träffarna.
   - **Partens sida:** "Ta bort" vid varje nummer och en lista över borttagna nummer, kortet "Avsluta parten" eller "Avslutad", och kortet "Begränsning".

## Val och avvägningar
- **Ingen sökning i adressen.** Namn är personuppgifter och ska inte hamna i loggar, så sökningen går i anropets innehåll, som sökningen på nummer.
- **Händelser i stället för en status som skrivs över.** Tabellerna har bara rätt att lägga till rader, och den senaste raden gäller. Historiken finns kvar utan att någon kolumn ändras.
- **Ingen kontroll av fyra ögon för begränsning.** Begränsning skyddar kunden. Att häva den loggas med vem och varför, och kontrollen kan läggas till senare.

## Att känna till
- **En policy som sagts upp löper till slutdatumet.** Fram till dess kan försäkringstagaren inte avslutas.
- **Ett avslut ändrar inte djurens ägarskap eller policyerna.** Andra moduler märker avslutet först när de ska peka på parten igen.
- **Sökningen gör en fullständig genomsökning** av senaste revisionen. Det räcker för back office, och ett index för trigram kan läggas till om antalet parter växer.

## Filer
- `docs/adr/0039-partens-livscykel.md` (ny), `db/migrations/0049_parties_lifecycle.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/parties/src/index.ts`, `src/postgres.ts`, `test/party-service.test.ts`, `test-suites/party-store.ts`
- `modules/api/src/app.ts`, `openapi.yaml`, `test/parties.test.ts`
- `apps/backoffice/src/views/parties-view.ts`, `src/views/party-detail.ts`, `src/party-logic.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `e2e/parties.spec.ts`, `e2e/erasures.spec.ts`
- `docs/funktion/parter.md`, `docs/funktion/backoffice.md`, `docs/end-to-end-scenario.md`, `docs/roadmap.md`
