# Parter i back office (PR #101)

**Datum:** 2026-11-19 **ADR:** 0026, 0028, 0035 **Moduler:** apps/backoffice

## Vad
Första PR:en för policy, djur och parter i back office: avsnittet Parter. Kundservice kan hitta, registrera och ändra personer och organisationer, och begära radering. Inget ändras i API:t, eftersom anropen fanns.

## Hur det fungerar
1. **`src/party-logic.ts` är ren:**
   - `partyProblems` säger vad som saknas
   - `partyDetails` tar bort tomma fält och tar med adressen hel eller inte alls
   - `registerBody` och `changeBody` bygger anropen
   - `partyToForm` gör en sparad part till ett formulär
2. **En ändring ersätter alla uppgifter** (`PUT /v1/parties/{id}`). Formuläret börjar därför på de nuvarande uppgifterna och skickar alla, med revisionen som personen såg (`basedOnRevision`).
3. **Fälten** finns i `party-fields.ts`, en funktion och inte en komponent. Den ritar i vyns egen shadow DOM, så att vyns stilar gäller både vid registrering och vid ändring.
4. **Sökningen** skickar numret i innehållet (`POST /v1/parties/searches`) och öppnar den första träffen.
5. **Sökfältet i toppraden** öppnar nu en part för ett `pty_`-id. Tidigare sökte det bland policyerna. Policyerna finns nu på partens sida.

## Val och avvägningar
- **Policyerna visas bara för den som får läsa policyer.** Annars skulle registratorn se "Inga policyer" fast det finns en.
- **Begäran om radering** har alltid grunden `subject-request` från back office. En begäran med grunden `retention-expired` kommer från körningen för gallring.
- **Telefonnummer** skrivs med mellanslag och bindestreck, men skickas utan dem.

## Att känna till
- **Fältet för nummer** heter `identifier` i vyn. `id` krockar med `HTMLElement.id`, och Lit vägrar då klassens dekoratör.
- **Flödestestet för toppraden** väntade sig sökning bland policyer för `pty_owner001`. Det letar nu efter policyn på partens sida.
- **Kön för radering med fyra ögon** finns inte i back office än. Den står kvar i roadmapen.

## Filer
- `apps/backoffice/src/views/parties-view.ts` (ny), `party-register.ts` (ny), `party-detail.ts` (ny), `src/components/party-fields.ts` (ny), `src/party-logic.ts` (ny)
- `apps/backoffice/src/components/app-shell.ts`, `src/permissions.ts`, `src/policy-logic.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `icons.json`
- `apps/backoffice/test/party-logic.test.ts` (ny), `e2e/parties.spec.ts` (ny), `e2e/shell.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
