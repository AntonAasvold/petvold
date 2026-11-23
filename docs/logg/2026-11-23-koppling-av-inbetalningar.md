# Pengar, steg 3b: inbetalningar kopplas till fakturorna (PR #144)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `billing`, `api`, `webhooks`

## Vad
En inbetalning med en fakturas OCR eller RF betalar fakturan, och det som blir över går till kontots äldsta förfallna faktura och sedan till ett tillgodohavande. En inbetalning utan användbar referens väntar i en kö tills en handläggare kopplar den. En faktura som blir betald ger `invoice.paid`.

## Hur det fungerar
1. Reläets källa `payments` (`composition.ts`) lämnar `payment.succeeded` till `BillingService.handlePaymentEvent`.
2. `handlePaymentEvent` letar upp fakturan med referensen (`invoiceByReference`). Finns den, i samma valuta, blir det en `PaymentMatch` med `how: 'reference'`.
3. `store.addReceipt` sparar inbetalningen i en transaktion. Med en koppling låser den kontot (`pg_advisory_xact_lock`) och läser kontots fakturor, kreditnotor och fördelningar. Sedan kör den `settle` i tjänsten, som anropar `allocate` i `receipts.ts`, och sparar fördelningarna och `invoice.paid`.
4. `POST /v1/received-payments/{id}/matches` gör samma sak med `how: 'manual'` via `store.addMatch`. Unikheten på `payment_match` gör att två samtidiga kopplingar ger en `409`.
5. Fakturans `credited`, `paid`, `open` och `status`, och kontots `balance`, räknas ut vid läsning med `invoiceBalances` och `accountBalance`.

## Val och avvägningar
- **Inget ändras.** Inbetalning, koppling och fördelning är tre tabeller som bara får läggas till (migration 0055). Det betalda räknas ut, så en kreditnota på en betald faktura gör automatiskt det överskjutande till tillgodohavande, utan att något flyttas.
- **Den refererade fakturan först.** ADR 0040 sa äldsta skuld först. Då kunde en kund som betalat en faktura med rätt OCR se den som obetald. Förtydligandet står i ADR:en.
- **Låset per konto** i stället för radlås. `select … for update` kräver rätten att ändra raden, och `billing_service` får bara läsa och lägga till.
- **Kön ligger i `billing`**, inte i `payments`. Det är `billing` som vet vilka referenser som finns, och kopplingen är en fråga om skuld, inte om hur pengar flyttas.
- **Egenskapstest** för fördelningen: vilka betalningar och kreditnotor som helst, i vilken ordning som helst, ger aldrig en överbetald faktura. Hela betalningen hamnar alltid på en faktura eller som tillgodohavande, och kontots saldo går ihop. Ett fel insatt med flit (ingen gräns för den refererade fakturan) fångades.

## Att känna till
- Tillgodohavandet dras inte av på nästa faktura, och betalas inte tillbaka, än. Det kommer i steg 5.
- En okopplad inbetalning som inte hör till någon kund kan inte betalas tillbaka än. Det kräver utbetalningar (steg 3c).
- Demons låtsasbank låter tre av hundra betalningar sakna OCR, så att kön har något i sig.

## Filer
- `modules/billing/src/receipts.ts`, `index.ts` och `postgres.ts`
- `db/migrations/0055_billing_payments.sql`
- `modules/billing/test/receipts.test.ts` och `receipts.property.test.ts`
- `modules/api/src/app.ts`, `composition.ts` och `permissions.ts`
