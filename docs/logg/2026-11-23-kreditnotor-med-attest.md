# Pengar, steg 5b: kreditnotor och avskrivningar med attest (PR #151)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `billing`, `api`, back office

## Vad
En handläggare kan kreditera en faktura eller skriva av det obetalda. Inom rollens gräns görs det direkt. Över gränsen blir det ett förslag som någon annan attesterar eller skickar tillbaka.

## Hur det fungerar
1. `POST /v1/invoices/{id}/credit-notes` räknar ut anroparens `creditLimits` med `amountLimitsOf(…, 'credit')`, samma funktion som skadebesluten använder, och anropar `BillingService.credit`.
2. `checkCredit` kontrollerar beloppet: en kreditnota högst det som är kvar att kreditera, en avskrivning högst det obetalda. Inom gränsen gör `makeCredit` kreditnotan direkt. Annars sparas ett `CreditProposal`.
3. `makeCredit` fördelar beloppet på fakturans rader efter det som är kvar på varje rad (`splitByWeight`). Den sparar kreditnotan med `addAdjustment`, samma väg som policyhändelsernas kreditnotor, med nummer ur serien och `invoice.credited`.
4. `approveCreditProposal` kontrollerar fyra ögon och attestantens gräns, kontrollerar fakturan igen och gör kreditnotan med förslagets id som källa. Sedan sparas beslutet en gång.

## Val och avvägningar
- **En avskrivning är en kreditnota av eget slag** (`kind: write-off`). Kunden ser samma sak, men bokföringen i steg 6 behöver skilja en kreditering, som är mindre intäkt, från en avskrivning, som är en kundförlust.
- **Samma mönster som skadebesluten:** gräns per roll och valuta, högst gräns av rollerna med rättigheten, och fyra ögon. Men en rättighet räcker, `billing:credit`. Att attestera kräver samma rättighet och en gräns som täcker beloppet. En ny roll `billing-manager` har den högre gränsen.
- **Kreditnotan görs med förslagets id som källa.** Om attesten avbryts efter kreditnotan men före beslutet, ger ett nytt försök samma kreditnota och inte en till.
- **Fakturan kontrolleras igen vid attesten.** Har kunden betalat under tiden kan avskrivningen vara för stor, och då blir det `409`.
- **Back office** visar gränsen i rollinställningen och kan ändra den. Det finns ännu ingen vy för förslagen.

## Att känna till
- En befintlig rollinställning behöver `npm run roles:sync -- --apply` för `billing:credit` och `billing-manager`.
- Kreditnotan skickas inte till kunden som meddelande än.
- Demon skriver av fakturor som aldrig betalats, 20 dagar efter uppsägningen. På sex månader blev det 8, alla inom gränsen.

## Filer
- `modules/billing/src/index.ts` och `postgres.ts`, och `db/migrations/0062_billing_credit_proposals.sql`
- `modules/api/src/app.ts`, `permissions.ts` och `demo-tokens.ts`
- `apps/backoffice/src/views/settings-view.ts` och `settings-logic.ts`
- `modules/billing/test/credit-notes.test.ts` och `modules/api/test/credit-notes.test.ts`
