# Pengar, steg 8b: betalarens konto i back office (PR #158)

**Datum:** 2026-11-24 **ADR:** 0040, 0035 **Moduler:** `apps/backoffice`

## Vad
Partens sida visar betalarkontona. Ett konto har en egen sida med saldot, fakturorna och återbetalningarna. Där görs en kreditnota eller en avskrivning på en faktura, och tillgodohavandet betalas tillbaka.

## Hur det fungerar
1. `src/account-logic.ts` är ren och testad:
   - `creditMax` ger det mesta en kreditnota eller avskrivning får ta, efter samma regler som API:t (`KRED-06`, `KRED-07`).
   - `creditProblems` och `creditBody` kontrollerar formuläret och gör om kronor till minsta enhet med `toMinorUnits`.
   - `refundProblems` och `refundBody` gör samma sak för återbetalningen, där ett tomt belopp betyder allt.
   - `dunningState` ger det senaste steget för obetald premie.
2. `src/components/party-accounts.ts` (`<pv-party-accounts>`) läser `GET /v1/payer-accounts?partyId=` och visas på partens sida för den som har `billing:read`.
3. `src/views/payer-account.ts` (`<pv-payer-account>`, `/payer-accounts/{id}`) läser kontot, fakturorna och återbetalningarna parallellt.
   - Kreditnotan går till `POST /v1/invoices/{id}/credit-notes`. Svaret `201` betyder gjord och `202` betyder förslag, och beskedet säger vilket.
   - Återbetalningen går till `POST /v1/payer-accounts/{id}/refunds`.

## Val och avvägningar
- **Kontot har en egen sida, inte bara ett kort på parten.** Fakturorna, kreditnotan och återbetalningen tar plats. En länk till kontot går också att skicka till en kollega.
- **Formuläret visar gränsen för varje sort** ("högst 3 590 kr"), och en sort utan utrymme är avstängd. Kontorister ska inte behöva få `409` för att förstå varför.
- **Texter med belopp** är en fast text följd av beloppet. Språkkatalogen har bara fasta texter, inga platshållare.

## Att känna till
- **Testet i webbläsaren** kör `billing.invoicing` via `POST /v1/jobs/billing.invoicing/runs`. Körningen upprepas tills Eriks (`pty_owner002`) faktura finns, eftersom relän gör planerna strax efter att servern startat. Partens sida öppnas genom sökfältet, eftersom `page.goto` laddar om appen och tappar dev-sessionen.
- **Testet för köerna** kopplar en inbetalning till samma konto, så kontot har ett tillgodohavande när hela sviten körs. Då syns två beloppsfält.
- **En dev-server från repots rot** läser `.env` och den sparade rollinställningen. Där saknar `dev-all` ekonomirollerna tills `npm run roles:sync -- --apply` körts.

## Filer
- `apps/backoffice/src/account-logic.ts`, `components/party-accounts.ts`, `views/payer-account.ts`
- `apps/backoffice/test/account-logic.test.ts`, `e2e/payer-account.spec.ts`
