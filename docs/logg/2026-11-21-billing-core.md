# Pengar, steg 1: `billing-core` (PR #129)

**Datum:** 2026-11-21 **ADR:** 0040, 0018, 0014 **Moduler:** `billing-core`

## Vad
Räkningen för premier finns nu som rena funktioner: premieplanen för en term, fördelningen av en betalning, hur en premieändring läggs på planen och vad ett avslut betyder mot det som är fakturerat och betalt. Ingen annan modul använder dem än. Det gör `billing` i steg 2.

## Hur det fungerar
Allt ligger i `modules/billing-core/src/index.ts`, utan beroenden till andra moduler, som `pricing-core`.

- **`premiumPlan(input)`** stegar fram perioderna med `addMonths` från termens början. Varje gräns räknas från början (`termStart + k × intervallet`), inte från förra gränsen, så att en term från den 31:a inte glider till den 28:e för resten av året. Beloppen delas med `split`: en kortare sista period får sin andel per dag, avrundad nedåt, och resten delas lika med det som blir över på den första. Skatten räknas en gång på hela premien med `applyBpHalfUp` (BigInt) och delas på samma sätt. Planen bär `model: 'premium-plan.v1'` och `inputHash` (sha256 av modellen och indata i kanonisk JSON, samma som i `pricing-core`).
- **`replayPlan(input, saved)`** räknar om och jämför hela planen.
- **`allocatePayment(amount, items)`** sorterar på förfallodag och sedan id, och tar så mycket som går av varje post.
- **`distributeAdjustment(adjustment, uninvoicedSeqs)`** ger `spread`, `separate`, `credit` eller `none`.
- **`settleCancellation({ plan, states, refund })`** räknar termens nya kostnad (premie minus `refund`, ny skatt och avgifterna för fakturerade delbetalningar). Det som ska betalas utöver det betalda behålls på fakturerade delbetalningar, den äldsta först. Resten av dem krediteras, och ofakturerade tas bort.

## Val och avvägningar
- **Den sista perioden får sin andel per dag**, inte en lika stor del. ADR 0040 säger att resten läggs på den första delbetalningen, men säger inget om en kortare term. En ny ägare som tar över i juni ska inte betala ett helt kvartal för sjutton dagar i mars. Hela perioder kostar lika mycket oavsett hur många dagar månaden har, eftersom en kund förväntar sig samma belopp varje månad.
- **Skatten delas som premien** i stället för att räknas per delbetalning. Annars skulle avrundningen per delbetalning kunna ge en summa som skiljer sig från skatten på hela premien.
- **Avgiften per delbetalning tas bara när intervallet är kortare än ett år.** En årsbetalare som får en kort term ska inte betala en avgift.
- **Vid avslut står skulden kvar på fakturerade delbetalningar** i stället för att allt krediteras och en ny faktura görs. Kunden ser då samma faktura som förut, med ett lägre belopp att betala, och betalningsreferensen gäller fortfarande. Det är vad ADR 0040 menar med att "resten står kvar som skuld".
- **Skatten räknas om på den nya premien**, inte som skatt på återbetalningen, så att avrundningen blir densamma som om termen hade haft den premien från början.
- **Första premien** tar avins dag som indata. Planen vet inte när fakturan skickas, så `billing` gör om planen med rätt dag när avin går ut, eller räknar förfallodagen när den fakturerar. Det avgörs i steg 2.

## Att känna till
- **Egenskapstesterna** (`billing.property.test.ts`) prövar att planen summerar exakt, att perioderna täcker termen utan glapp, att hela perioder skiljer sig med mindre än antalet, att en betalning aldrig skapar eller tappar pengar och går till den äldsta först, och att avräkningen alltid går ihop: betalt + kvar + ny debitering − tillgodohavande = termens nya kostnad.
- **En betald delbetalning måste vara fakturerad.** En förskottsbetalning är ett tillgodohavande på kontot i `billing`, inte en betalning på en delbetalning.
- **Dröjsmålsränta och kvittning** finns inte här. De kommer i senare steg.

## Filer
- `modules/billing-core/src/index.ts`
- `modules/billing-core/test/billing.test.ts`
- `modules/billing-core/test/billing.property.test.ts`
- `docs/funktion/premier.md`
