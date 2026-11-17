# Skadeärendet enligt designsystemet (PR #88)

**Datum:** 2026-11-16 **ADR:** 0018, 0035 **Moduler:** claims-core, api, apps/backoffice

## Vad
Andra av tre PR:er som bygger om back office efter designsystemet.
- **Skadeärendet** har ett huvud och två spalter: underlaget till vänster, beslutet och historiken till höger.
- **Varför en handläggare:** bedömningen säger nu varför ärendet inte reglerades automatiskt. Det fanns inte i API:t, så kontraktet ändrades först.

## Hur det fungerar
1. **Kontraktet:** `GET /v1/claims/{claimId}/assessment` svarar med `AssessmentWithRouting`, alltså `Assessment` och `routing: { mode, reasons[] }`. Skälen är `Reason` med nyckel och värden, och API:t ger dem text som reglerna.
2. **Kärnan:** `routingOf(assessment, autoSettleMax)` i `claims-core/src/routing.ts` är ren. Regler med `review` eller `fail` blir ett skäl var. Ett avslag blir ett eget skäl bara om ingen regel förklarar det, och en ersättning över gränsen blir ett skäl med belopp och gräns.
3. **Tjänsten:** `assessWithRouting` gör samma bedömning som `assessClaim` och har reglerna till hands, så att gränsen kommer från samma regelversion som bedömningen.
4. **Vyn:** `claim-detail.ts` och `claim-actions.ts` tar in `pvComponents` och använder `pv-card`, `pv-dl`, `pv-badge` och `pv-choice` i stället för `wa-card` och `wa-radio`. Valkorten är vanliga `<input type="radio">` i en `<fieldset>` med `<legend>`.
5. **Huvudet** hämtar djuret och policyn efter ärendet, och sedan kunden från policyns version på behandlingsdagen. Ett fel där lämnar bara namnen tomma, eftersom de inte behövs för att besluta.

## Val och avvägningar
- **`routing` sparas inte.** Om fältet lades i `Assessment` och sparades med beslutet skulle `inputHash` och omräkningen av gamla beslut påverkas (ADR 0018). Därför räknas det fram när bedömningen läses och finns bara i svaret från `/assessment`.
- **Skälen pekar på regeln.** Designsystemet säger "När en regel skickar något till en person, säg vilken regel". Vyn sätter ihop skälet med regelns egen text, till exempel förbehållet som kan höra ihop med diagnosen.
- **Ett avslag kräver alltid en motivering i appen,** också när det följer förslaget. API:t kräver det bara vid avvikelse. Kunden får beslutet med skälet, så handläggaren ska skriva det.
- **Valkort med vanliga radioknappar.** `wa-radio` har ingen plats för en rad om följden. `pv-choice` i `design/components.css` är byggd för `<input>`, och `:has(input:checked)` ger den helfyllda ramen.
- **Belopp på svenska utan ören när beloppet är jämnt,** "12 165 kr", som designsystemet skriver. På engelska är det oförändrat, "SEK 12,165.00".
- **Historiken** är fortfarande tabellen över beslut, nyast först och smalare. `<pv-event-log>` ersätter den i PR 3.

## Att känna till
- **`required` på motiveringen** stoppade formuläret innan appens egna fel visades. Fältet kontrolleras därför bara av `decisionProblems`.
- **Ikonerna `copy` och `check`** är nya i `icons.json`. Testet för ikoner ser inte namn som sätts med ett uttryck, som `name=${...}`, så en saknad ikon där syns bara som en tom plats.
- **Bedömningen** som `claim-actions` får är nu av typen `AssessmentWithRouting`. Om vyn byts till en annan källa för bedömningen behövs `routing` där också.

## Filer
- `modules/api/openapi.yaml`, `modules/api/src/app.ts`, `src/messages.ts`, `test/api.test.ts`
- `modules/claims-core/src/routing.ts` (ny), `src/service.ts`, `src/index.ts`, `test/routing.test.ts` (ny)
- `apps/backoffice/src/views/claim-detail.ts`, `src/components/claim-actions.ts`, `src/decide.ts`, `src/format.ts`, `src/policy-logic.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `icons.json`
- `apps/backoffice/test/decide.test.ts`, `test/format.test.ts`, `test/policy-logic.test.ts`, `e2e/claims.spec.ts`, `e2e/decisions.spec.ts`
- `docs/funktion/backoffice.md`, `docs/funktion/skadereglering.md`, `docs/teknik/backoffice.md`, `docs/teknik/arkitektur.md`
