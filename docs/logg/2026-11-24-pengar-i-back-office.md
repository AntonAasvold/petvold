# Pengar, steg 8a: köerna i back office (PR #157)

**Datum:** 2026-11-24 **ADR:** 0040, 0035 **Moduler:** `apps/backoffice`

## Vad
Back office har en ny post i menyn, **Pengar**, med tre köer:
- **Okopplade inbetalningar:** kopplas för hand till ett konto eller en faktura.
- **Spärrade utbetalningar:** släpps efter kontroll av betaluppgifterna.
- **Kreditförslag:** kreditnotor och avskrivningar över gränsen som attesteras eller skickas tillbaka.

## Hur det fungerar
1. `src/money-logic.ts` är ren och testad:
   - `moneyTabs` ger flikarna efter behörigheten.
   - `matchProblems` och `matchBody` kontrollerar kopplingen och bygger anropet. `bac_` blir `accountId` och `inv_` blir `invoiceId`.
   - `mayRelease`, `heldSince`, `mayDecideProposal` och `returnReasonOk` hör till utbetalningarna och kreditförslagen.
2. `src/views/money-view.ts` (`<pv-money>`) visar listan i `<pv-data-grid>` och den valda raden i ett `pv-card` till höger. Upplägget är detsamma som för ärendena.
   - Varje flik läser sin lista: `GET /v1/received-payments?status=unmatched`, `GET /v1/payouts?status=held` och `GET /v1/credit-proposals?status=proposed`.
   - Åtgärderna går genom `act()` med `IdempotencyKeys`, som de andra vyerna. Efter en lyckad åtgärd laddas kön om.
3. Menyposten räknar okopplade inbetalningar.
4. `DEV_TOKENS` har nu `dev-billing`, `dev-billing-manager` och `dev-accountant`, så att de går att välja vid inloggningen.

## Val och avvägningar
- **En vy med flikar i stället för tre menyposter.** Ekonomi arbetar i alla tre köerna, och menyn är redan lång. Räknaren visar bara okopplade inbetalningar. Det är den kö som växer av sig själv, och de andra två är sällsynta.
- **Fyra ögon i gränssnittet där det går att avgöra.** Kreditförslaget har `proposedBy`, så knapparna döljs för den som föreslog. Utbetalningen säger inte vem som gav betaluppgifterna, så där visas knappen och API:t säger nej med 403. Att lägga till vem som gav uppgifterna i `Payout` hade ändrat kontraktet för något som API:t redan kontrollerar.
- **Ingen sökning efter konto eller faktura vid kopplingen.** Handläggaren klistrar in id:t, och formuläret kontrollerar formen. Sökning efter OCR eller namn hör till 8b, när betalarens konto får en egen sida.

## Att känna till
- **Testet i webbläsaren** skapar en inbetalning med en signerad avisering från låtsasbanken. Sedan väntar det tills `billing` fått den, eftersom relän går varje sekund. Annars kan listan laddas innan inbetalningen finns.
- **Utbetalningar som väntar på betaluppgifter** (`awaiting-details`) har ingen flik än. De kommer med betaluppgifterna i 8c.

## Filer
- `apps/backoffice/src/money-logic.ts`, `views/money-view.ts`
- `apps/backoffice/test/money-logic.test.ts`, `e2e/money.spec.ts`
