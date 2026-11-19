# Ansökan och grupper i back office (PR #104)

**Datum:** 2026-11-19 **ADR:** 0007, 0031, 0035 **Moduler:** apps/backoffice

## Vad
Fjärde och sista PR:en för policy, djur och parter. Inget ändras i API:t.
- **Ansökan:** en produkt med hälsofrågor, som `SE-HUND-PLUS`, kan tecknas via en ansökan.
- **Grupper:** kull och hushåll kan skapas och få medlemmar.

## Hur det fungerar
1. **Hälsofrågorna** hämtas för produkten, djurets art och startdagen (`GET /v1/application-questions`) när produkten har `underwritingSeries`.
   - Varje fråga är ett val mellan ja och nej med designsystemets valkort.
   - En fråga om diagnoser som besvaras med ja visar ett fält för koderna.
2. **`answerProblems` och `applicationBody`** i `policy-form.ts` kräver svar på alla frågor och skickar samma innehåll som ett tecknande, plus svaren.
3. **Prisindikationen** tar med svaren, så att den visar vad ansökan skulle ge: godkänd, med förbehåll, till prövning eller avslag. Inget sparas.
4. **Efter en ansökan** öppnas ansökans sida, där beslutet och en eventuell prövning syns.
5. **Grupper:** partens sida listar grupperna (`GET /v1/policy-groups?policyholderPartyId=`) och skapar nya. En kullgrupp kräver kullens id. Gruppens sida visar medlemmarna med från- och till-dag, lägger till en policy och avslutar ett medlemskap med skäl.

## Val och avvägningar
- **Samma formulär för tecknande och ansökan.** Det som skiljer är hälsofrågorna och vart man hamnar efteråt. Två formulär hade gett två ställen att hålla lika.
- **Knappen säger vad som händer:** "Skicka ansökan" eller "Teckna försäkringen".
- **Grupper skapas från försäkringstagaren,** eftersom en grupp har en försäkringstagare som ska ha varje medlems policy.

## Att känna till
- **Grenen byggde på #103** innan den var sammanslagen. Den flyttades till main med `git rebase --onto` innan den pushades, så ingen force-push behövdes.
- **Sixtens ansökan i flödestestet** får avslag på grund av åldern, och ansökans sida öppnas ändå.

## Filer
- `apps/backoffice/src/views/group-detail.ts` (ny), `src/views/policy-issue.ts`, `src/views/party-detail.ts`, `src/policy-form.ts`, `src/components/app-shell.ts`, `src/views/labels.ts`, `src/locales/sv.ts`
- `apps/backoffice/test/policy-form.test.ts`, `e2e/applications-groups.spec.ts` (ny), `e2e/integrations.spec.ts` (ett andra avslag för Sixten)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
