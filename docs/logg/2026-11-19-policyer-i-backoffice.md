# Teckna och ändra policyer i back office (PR #103)

**Datum:** 2026-11-19 **ADR:** 0029, 0031, 0032, 0035 **Moduler:** apps/backoffice

## Vad
Tredje PR:en för policy, djur och parter. Kundservice kan:
- **teckna en försäkring:** med prisindikation och kundens godkännande
- **ändra valen**
- **säga upp en policy och ångra uppsägningen**
- **förnya för hand**

Inget ändras i API:t.

## Hur det fungerar
1. **`src/policy-form.ts` är ren.**
   - **Kontroller:** `issueProblems` kräver djur, försäkringstagare, produkt, startdag, kanal och tid för godkännandet. Den kräver också premie för en produkt utan tariff och, för en produkt med dokument, att villkor och förköpsinformation visades.
   - **Anrop:** `issueBody` och `quoteBody` bygger anropen. Godkännandets tid kommer från `datetime-local` och görs om till UTC.
2. **Produktversionerna** hämtas för startdagen, marknaden och djurets art (`GET /v1/product-versions?onSale=`). Byts produkten fylls dess förval för belopp och självrisk i.
3. **En produkt med hälsofrågor** (`underwritingSeries`) går inte att teckna direkt. Appen säger det och låter knappen vara inaktiv.
4. **`<pv-policy-actions>`** på policyns sida läser termens produktversion för att veta valen och om det finns en tariff. Ångra visas bara när den senaste transaktionen är en uppsägning (`reversibleCancellation`), som API:t kräver.

## Val och avvägningar
- **Policyns sida behåller sin gamla layout.** Åtgärderna är kort enligt designsystemet. Att bygga om hela sidan blir en egen PR, så att den här inte växer.
- **Prisindikationen görs på begäran,** inte vid varje ändring i formuläret. Den kostar ett anrop mot tariffen, och priset ändras sällan medan någon fyller i.
- **Nya id:n för texter med ett annat innehåll.** `policy.change` ("Ändring") och `policy.premium` ("Premie") används redan som kolumnrubriker, så de nya texterna fick `policy.changeChoices` och `policy.premiumPerTerm`.

## Att känna till
- **Exempeldatans hundar:** Sixten har ingen försäkring efter avslaget, och flödestestet tecknar en åt honom på produkten utan tariff.
- **Tariffen** prissätter Sixten, 12 år, till 4 560 kr på `SE-HUND-BAS`.

## Filer
- `apps/backoffice/src/views/policy-issue.ts` (ny), `src/components/policy-actions.ts` (ny), `src/policy-form.ts` (ny)
- `apps/backoffice/src/views/policy-detail.ts`, `src/views/animal-detail.ts`, `src/components/app-shell.ts`, `src/views/labels.ts`, `src/locales/sv.ts`
- `apps/backoffice/test/policy-form.test.ts` (ny), `e2e/policy-issue.spec.ts` (ny)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
