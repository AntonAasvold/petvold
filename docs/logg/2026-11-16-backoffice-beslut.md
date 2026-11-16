# Back office, steg 2: beslut, attest och prövning (PR #81)

**Datum:** 2026-11-16 **ADR:** 0035, 0018, 0019 **Moduler:** apps/backoffice

## Vad
I ärendevyn kan man nu:
- besluta, och besluta mot förslaget med skälkod och motivering
- attestera eller skicka tillbaka någon annans förslag
- begära prövning av ett automatiskt beslut
- ompröva
- se förklaringen till varje beslut

## Hur det fungerar
1. **`claim-detail.ts`** hämtar också förslagen och begärandena om prövning. Status räknas med `claimStatus` i `decide.ts`, i samma ordning som API:ts köer.
2. **`<pv-claim-actions>`** visar bara de formulär som användaren får använda just nu:
   - `mayDecide`: `claims:decide`, och skadan väntar på beslut eller prövning
   - `mayApprove`: `claims:approve`, ett öppet förslag och fyra ögon
   - `mayRequestReview`: `claims:request-review`, det senaste beslutet är automatiskt och ingen begäran är öppen
   - `claims:reassess`
3. **Ett beslut:** `decisionProblems` stoppar ett beslut mot förslaget utan skälkod, motivering eller `claims:override` innan något skickas. Sedan skickas `POST .../decisions` med `expectedInputHash`. `201` är ett beslut, och `202` ett förslag över gränsen.
4. **Varje åtgärd** skickar `Idempotency-Key` från `IdempotencyKeys`. Samma nyckel används tills åtgärden har gått igenom, så att ett nytt försök inte ger ett andra beslut. `run` gör om svaret till ett besked: `409` erbjuder "Ladda om", och annat visar API:ts `detail`.
5. **Förklaringen:** "Varför?" i beslutstabellen öppnar `<pv-explanation-dialog>`, som hämtar `.../decisions/{seq}/explanation`.

## Val och avvägningar
- **Appens egna meddelanden i stället för webbläsarens validering.** Ett obligatoriskt fält i Web Awesome stoppar formuläret med webbläsarens meddelande, på webbläsarens språk. Beslutsformuläret visar i stället appens översatta meddelanden.
- **Status räknas i appen.** Ett enskilt ärende i API:t har ingen status, bara listan har det. Reglerna i `claimStatus` följer API:ts ordning och testas.
- **Testerna delar en server.** Bellas skador delar försäkringsbelopp, så ett beslut på en skada ändrar underlaget för en annan. Attesten körs därför först. Annars svarar API:t med rätta `409`, vilket syntes när testet kördes i fel ordning.
- **Ett test för översättningar** stoppar ett text-id utan svenska och en svensk text som inte används.

## Att känna till
- Den som har både `claims:decide` och `claims:approve` ser båda formulären. API:t hindrar att man attesterar sitt eget förslag.

## Filer
- `apps/backoffice/src/decide.ts`, `src/components/claim-actions.ts`, `src/components/explanation-dialog.ts` (nya)
- `apps/backoffice/src/views/claim-detail.ts`, `views/labels.ts`, `components/app-shell.ts`, `locales/sv.ts`
- `apps/backoffice/test/decide.test.ts`, `test/locales.test.ts`, `e2e/decisions.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`
