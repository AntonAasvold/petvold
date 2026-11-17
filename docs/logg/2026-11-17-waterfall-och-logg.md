# Beräkningen och historiken som komponenter (PR #89)

**Datum:** 2026-11-17 **ADR:** 0018, 0035 **Moduler:** apps/backoffice

## Vad
Sista av tre PR:er som bygger om back office efter designsystemet. Det kom två nya Lit-komponenter:
- **`<pv-waterfall>`** visar beräkningen: en rad per steg, en stapel i procent av det fakturerade beloppet, skrafferade avdrag och regeln för varje steg.
- **`<pv-event-log>`** visar historiken nyast först på `--panel-inverse`.

## Hur det fungerar
1. **Stilarna:** båda komponenterna har `pvComponents` först i `static styles`, alltså `design/components.css` inläst som text, och använder `.pv-wf__*` och `.pv-log__*` direkt. Se [Lits dokumentation om stilar](https://lit.dev/docs/components/styles/). Det som bara gäller komponenten ligger efter, som raden för ersättningen och märken som väntar på svart.
2. **Beräkningen:** `waterfallSteps` i `src/waterfall.ts` går från det fakturerade beloppet och drar av ett steg i taget i samma ordning som motorn:
   - det som inte ersätts
   - moms som inte ersätts
   - fast självrisk
   - rörlig självrisk
   - det som taket i försäkringsbeloppet tar

   Varje avdrag ritas från det som är kvar efter det till det som var kvar före, så att staplarna bildar en trappa. Ersättningen ritas från noll.
3. **Historiken:** `claimHistory` i `src/history.ts` gör ärendet, besluten, förslagen och begärandena om prövning till händelser med samma namn som API:t och webhooks använder (`claim.decided`, `proposal.created` …). `claim-detail.ts` ger dem text och märke, och "Varför?" öppnar förklaringen.
4. **`<pv-event-log>` är allmän.** Den tar emot färdiga poster med märke, tid, rad, status och en valfri knapp. Den kan därför användas för webhooks och meddelanden senare.

## Val och avvägningar
- **Stegen räknas fram i appen från `Calculation`**, inte från förklaringens steg. Förklaringen finns bara för ett beslut, men beräkningen visas också innan något är beslutat. Ordningen är densamma som i `calculate()` i `assess.ts`.
- **Avdrag som är noll visas inte.** En rad för "ingen moms" säger inget. Att den fasta självrisken är noll inom en öppen period syns i bedömningen och i förklaringen.
- **Tid i loggen i ISO-ordning,** `2026-11-13 14:32`, som designsystemet säger, och lika på svenska och engelska.
- **Korten för attest, prövning och omprövning blev också `pv-card`,** så att hela högerspalten följer samma mönster. Det var en liten ändring som hörde till PR 2.

## Att känna till
- **Den gamla tabellen över beslut är borta.** Flödestesterna letar nu i regionen "History", och "Varför?" har en etikett med beslutets nummer ("Why? #1").
- **Förklaringen** har också en lista med "Fixed deductible". Testet letar därför inuti `pv-explanation-dialog`.
- **Staplarna** sätts med `style` i procent. Det är värden som räknas fram, inte fasta storlekar.

## Filer
- `apps/backoffice/src/components/waterfall.ts` (ny), `src/components/event-log.ts` (ny), `src/waterfall.ts` (ny), `src/history.ts` (ny)
- `apps/backoffice/src/views/claim-detail.ts`, `src/components/claim-actions.ts`, `src/format.ts`, `src/locales/sv.ts`
- `apps/backoffice/test/waterfall.test.ts` (ny), `e2e/decisions.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/teknik/designsystem.md`
