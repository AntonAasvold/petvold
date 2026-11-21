# Ändring, avslut och överlåtelse mot fakturorna (PR #136)

**Datum:** 2026-11-21 **ADR:** 0040 (punkt 4, beslut 2026-11-21) **Moduler:** `billing-core`, `billing`, `webhooks`, `api`

## Vad
`policy.changed`, `policy.cancelled` och `policy.transferred` ändrar nu det som faktureras. Det som redan fakturerats och inte längre behövs krediteras med en kreditnota.

## Hur det fungerar
**I `billing-core`:**
- `reduceInstallments` drar en sänkning från delbetalningar, lika mycket på var och en och aldrig under noll. Det som inte går att dra blir `rest`.
- `settleTerm` avräknar en term:
  - tar bort det som inte är fakturerat
  - låter det som termen kostar stå kvar på fakturerade rader, de äldsta först
  - krediterar resten
  - gör en ny delbetalning om fakturorna inte räcker
- `splitByWeight` delar ett belopp efter vikter.

**`BillingService.adjust`** tar emot händelserna via `handlePolicyEvent`:
1. Den läser planerna i kraft, alltså de som ingen annan plan ersätter.
2. `termLines` samlar termens rader: allt som fakturerats från termens planer för kontot, med det som återstår efter kreditnotor, och de ofakturerade delbetalningarna i planen i kraft.
3. **Ändring:** `distributeAdjustment` för en höjning, eller en egen delbetalning när allt är fakturerat. `reduceInstallments` för en sänkning, och resten krediteras på de senaste fakturerade raderna.
4. **Avslut och överlåtelse:** `refund` eller `premium` delas på termerna efter förlorade dagar med `splitByWeight`, och sedan avräknas varje term med `settleTerm`. Vid en överlåtelse får den nya ägaren en plan med `premiumPlan` från försäljningsdagen, med regeln för en första premie.
5. `BillingStore.addAdjustment` sparar allt i en transaktion:
   - nya planer (`replaces_plan_id`, `adjustment`)
   - nya konton
   - kreditnotor med nummer ur fakturornas serie
   - `invoice.credited`

   En händelse som kommer två gånger ger ingenting, och en plan ersätts bara en gång (`premium_plan_replaces`).
6. Faktureringen tar bara planer i kraft.

## Val och avvägningar
- **En ersättande plan i stället för ändrade rader.** Raderna i `billing` ändras aldrig, och en faktura pekar på planen och delbetalningen den kom från. Den nya planen behåller delbetalningarnas nummer, och en ny delbetalning får nästa nummer i termen.
- **Planerna kan inte räknas om med `replayPlan`.** En ersättande plan följer av den förra planen, fakturorna och händelsen, och `adjustment` säger vad som hände. Bara den första planen för en term räknas om från sitt underlag.
- **En lägre premie dras från framtiden först**, enligt beslutet 2026-11-21. Rester krediteras på de senaste raderna, alltså de månader som ligger närmast termens slut.
- **Avslutets återbetalning delas efter dagar.** Policymodulen räknar `refund` över alla termer som berörs, till exempel en redan förnyad term. `billing` delar den efter dagar som varje term förlorar. Skatten räknas om på det som är kvar.
- **Kreditnotor utan attest.** De följer av policyhändelser. Attest för en persons kreditnota kommer i steg 5.
- **Egenskapstestet** (`adjustments.property.test.ts`) prövar att det som faktureras för termen (fakturor minus kreditnotor plus det som är kvar) alltid är vad termen kostar, efter slumpade ändringar och ett avslut. Jag provade det med ett inplanterat fel, och det fallerar då.

## Att känna till
- **Återkallelse** (`policy.reinstated`) gör ingenting i `billing` än. Det kommer i 2c-2b.
- **Inga betalningar** finns än, så en avräkning ger aldrig ett tillgodohavande.
- **Ingen kreditnota till kunden.** Den går inte ut som meddelande än.

## Filer
- `modules/billing-core/src/index.ts`
- `modules/billing/src/index.ts`, `postgres.ts`
- `modules/billing/test/adjustments.test.ts`, `adjustments.property.test.ts`
- `db/migrations/0053_billing_adjustments.sql`
