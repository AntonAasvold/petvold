# Pengar, steg 6a: verifikationer (PR #152)

**Datum:** 2026-11-24 **ADR:** 0040 **Moduler:** `accounting` (ny), `billing`, `billing-core`, `api`, `webhooks`

## Vad
Den nya modulen `accounting` gör en verifikation med dubbel bokföring av varje händelse som rör pengar. Det gäller fakturor, kreditnotor, avskrivningar, inbetalningar, kopplingar, återbetalningar, utbetalningsordrar och utbetalningar. Verifikationerna och saldot per konto läses i API:t.

## Hur det fungerar
1. Reläets källor `billing`, `payments` och `claims` lämnar varje händelse till `AccountingService.handleEvent` efter de andra modulerna.
2. För fakturor och kreditnotor hämtar den raderna via porten `AccountingSources` (`accountingSources` i `wiring.ts`). Den rena funktionen `verificationFor` gör sedan raderna i debet och kredit.
3. `assertBalanced` kontrollerar att debet och kredit går ihop och att varje rad har ett belopp på en sida. Databasen kontrollerar det senare också.
4. `store.add` tar nästa nummer ur serien för marknaden och året i samma transaktion, som fakturanumren. Samma händelse två gånger ger en verifikation.
5. `billing` skickar nu `payment.matched` när en inbetalning kopplas till en betalare, med referensen eller av en person.

## Val och avvägningar
- **Inbetalningar går först till okopplade inbetalningar.** När `payment.matched` kommer flyttas de till premiefordran. Bokföringen läser då aldrig av `billing` om en inbetalning är kopplad, och beror inte på i vilken ordning modulerna hinner behandla händelsen. Saldot på kontot är alltid kön.
- **Tillgodohavanden är ett negativt saldo på premiefordran** per betalare. Ett eget konto hade krävt att `billing` sa hur mycket av varje kreditnota som blev tillgodohavande just då. Förtydligandet står i ADR 0040.
- **Avstämningstest:** tre månader av demons testdata, och sedan stäms varje konto av mot `billing` och `payments`: premiefordran, okopplade inbetalningar, banken och skulderna. Testet visar att bokföringen och modulerna är överens, inte bara att varje verifikation går ihop.
- **Egenskapstestet hittade ett fel.** Fördelningen av en kreditnota på premie, skatt och avgift lade resten på den första delen, så att 2 öre av en rad med 1 öre var fick 2 öre premieintäkt tillbaka. Nu används största rest, så att ingen del blir större än sin vikt.
- **Samma fel fanns i `billing-core`.** `splitByWeight` lägger resten på den sista vikten, och kreditnotorna från steg 5b fördelades med den. De använder nu en egen funktion, `splitWithinCaps`, med ett egenskapstest. `splitByWeight` ändrades inte, eftersom överlåtelserna använder den och sparade resultat ska kunna räknas om på samma sätt.

## Att känna till
- Kontoplanen och dagsavslutet med CSV kommer i steg 6b. Till dess är kontona Petvolds egna slag.
- En installation behöver rollen `accounting_service` och `ACCOUNTING_DATABASE_URL` före migration 0064. I demon skapar `initdb` rollen, men bara när databasen skapas, så kör `reset.sh` eller skapa rollen för hand.
- Händelser som redan publicerats före uppgraderingen bokförs inte i efterhand.

## Filer
- `modules/accounting/src/index.ts` och `postgres.ts`, och `db/migrations/0064_accounting.sql`
- `db/migrations/0063_billing_payment_matched.sql` och `modules/billing/src/index.ts`
- `modules/billing-core/src/index.ts`: `splitWithinCaps`
- `modules/api/src/composition.ts`, `wiring.ts`, `app.ts` och `permissions.ts`
- `modules/accounting/test/rules.test.ts` och `modules/api/test/accounting.test.ts`
- `docs/funktion/bokforing.md`
