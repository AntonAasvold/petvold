# Pengar, steg 3c-1: utbetalningar till försäkringstagaren (PR #146)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `payments`, `api`, `webhooks`

## Vad
Ett skadebeslut som ger ersättning betalas ut till försäkringstagaren genom låtsasbanken. Betaluppgifterna ägs av `payments`. Nya uppgifter kan spärra utbetalningen tills en annan person släpper den.

## Hur det fungerar
1. Reläets källa `claims` (`composition.ts`) gör om händelsen till webhookformen och lämnar `claim.payout_ordered` till `PaymentsService.handleClaimEvent`, innan den går till webhooks.
2. `handleClaimEvent` väljer en adapter som kan betala ut i marknaden och valutan. Finns ingen, gör den ingenting. Annars hämtar den försäkringstagaren den dagen genom porten `policies` (samma adapter som `billing` använder) och den aktuella betaluppgiften.
3. `payoutGate` (`payouts.ts`) avgör det första steget: `awaiting-details`, `held` eller `pending`. Med `pending` anropas adapterns `payout` med utbetalningens id som idempotensnyckel, och svaret blir nästa steg och `payout.paid` eller `payout.failed`.
4. `addPayeeAccount` sparar nya uppgifter och flyttar utbetalningar som väntar på uppgifter eller är spärrade. `releasePayout` kontrollerar att uppgifterna inte ändrats och att den som släpper inte är den som gav dem.

## Val och avvägningar
- **Steg i stället för en status som ändras.** En utbetalning ändras aldrig. Den flyttas genom att steg läggs till (`payout_step`, nyckeln är utbetalning och nummer). Två som flyttar samma utbetalning samtidigt får ett unikhetsfel, och bara en av dem lyckas. Steget `pending` sparas innan adaptern anropas, så att en krasch mellan anropen aldrig ger en utbetalning som Petvold inte vet om.
- **Ingen adapter, ingen utbetalning.** Först stoppade en installation utan låtsasbank skadornas relä, eftersom ordern inte kunde betalas. Två befintliga tester fångade det. Nu ligger ordern kvar hos bolaget, som före steg 3c.
- **Spärrade utbetalningar spärras om på nya uppgifter.** Testet för ändrade uppgifter visade att en spärrad utbetalning annars låg kvar med de gamla uppgifterna, och att frisläppningen alltid gav en konflikt.
- **Fyra ögon utan ny roll.** `billing-clerk` får ge uppgifter och släppa utbetalningar, men aldrig båda för samma uppgifter.
- **Uppgifterna kontrolleras till formen:** clearingnummer och konto som siffror, och IBAN med kontrollsiffror enligt ISO 13616. Svenska kontonummers kontrollsiffror per bank kontrolleras inte.
- **Direktreglering till kliniker är ett eget steg (3c-2).** Det behöver avtal per klinik med giltighetstid och betaluppgifter per klinik.

## Att känna till
- Betaluppgifterna är personuppgifter. Gallringen ser att en part har en pågående utbetalning, men uppgifterna raderas inte när parten raderas. Det står bland det öppna i statusen.
- En adapter som svarar `pending` följs inte upp än. Det kommer med bankfilerna (steg 7).
- I demon spärras nya uppgifter i två dagar, så att kön syns.

## Filer
- `modules/payments/src/payouts.ts`, `index.ts`, `fake.ts` och `postgres.ts`
- `db/migrations/0056_payments_payouts.sql`
- `modules/payments/test/payouts.test.ts` och `test-suites/payments-store.ts`
- `modules/api/src/app.ts`, `composition.ts`, `permissions.ts` och `demo-data.ts`
