# Pengar, steg 5a: tillgodohavanden (PR #150)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `billing`, `payments`, `api`, `webhooks`

## Vad
Ett tillgodohavande betalar kontots obetalda fakturor, eller betalas tillbaka till kunden när kontot inte har mer att fakturera. Kunden kan också be om det tillbaka. Återbetalningen betalas ut som en utbetalning, som en ersättning.

## Hur det fungerar
1. **Körningen `billing.credits`** (04:30) går igenom marknadens betalarkonton. För ett konto med tillgodohavande väljer `applyCredit` (`receipts.ts`) vilka fakturor det betalar, den äldsta förfallna först.
2. **`store.settleCredit`** tar samma lås per konto som inbetalningarna och räknar om i transaktionen. Det som sparas är tillgodohavanden som används (`credit_application`), återbetalningar (`refund`) och händelserna `invoice.paid` (`paidWith: credit`) och `refund.ordered`.
3. **Utan obetalda fakturor** avgör `hasMoreToBill` om kontot har något kvar: en delbetalning som inte fakturerats, eller en term som pågår och inte avslutats eller överlåtits. Har det inget betalas tillgodohavandet tillbaka.
4. **Reläet** lämnar `refund.ordered` till `PaymentsService.handleBillingEvent`, som gör en utbetalning med `purpose: premium-refund` och återbetalningens id som order. Väntan, spärr och frisläppning är desamma som för en ersättning.

## Val och avvägningar
- **Tillgodohavandet räknas ut, det sparas inte.** Det är det mottagna minus det som betalat fakturor och det som betalats tillbaka. Det som läggs till är vad som hänt, aldrig ett saldo som ändras.
- **Före påminnelserna.** Körningen går mellan faktureringen (04:00) och påminnelserna (05:00), så att ingen påminns om det som tillgodohavandet täcker. Betalar tillgodohavandet en faktura som är uppsagd, återkallas uppsägningen som vid en betalning.
- **Utbetalningen blev allmän.** En utbetalning har nu ett syfte, och bara en ersättnings utbetalning har skada, beslut och policy. Kontraktet ändrades så att `claimId` och `policyId` inte krävs på utbetalningar och `payout.*`. Händelserna har inga mottagare utanför Petvold än.
- **Egenskapstest:** vilka betalningar, användningar och återbetalningar som helst ger aldrig ett negativt tillgodohavande eller en överbetald faktura. Det mottagna är alltid lika med det betalda, plus tillgodohavandet, plus det återbetalda. Ett fel jag satte in med flit, att glömma återbetalningarna, fångades först när den sista regeln kom till.

## Att känna till
- Tillgodohavandet används efter att fakturan skickats. Kunden får fakturan med hela beloppet, och den visas sedan som betald. Att dra av på själva fakturan kräver en ändring i faktureringen.
- Kreditnotor och avskrivningar som en person gör, med attest, kommer i steg 5b.
- Demon på sex månader: 26 gånger betalade tillgodohavandet en faktura, och 7 återbetalningar betalades ut.

## Filer
- `modules/billing/src/receipts.ts`, `index.ts` och `postgres.ts`
- `modules/payments/src/index.ts`, `payouts.ts` och `postgres.ts`
- `db/migrations/0060_billing_credit.sql` och `0061_payments_refunds.sql`
- `modules/billing/test/credits.test.ts`, `receipts.property.test.ts` och `modules/api/test/credits.test.ts`
