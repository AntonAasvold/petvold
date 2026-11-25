# Återkrav, del 2: kön i back office (PR #171)

**Datum:** 2026-11-25 **ADR:** 0040 punkt 8, 0035 **Moduler:** `apps/backoffice`

## Vad
**Pengar** har fliken **Återkrav**. Där finns förslagen till återkrav, och en handläggare med `billing:credit` beslutar: kräva tillbaka, avräkna mot tillgodohavandet eller skriva av.

## Hur det fungerar
- `money-logic.ts` har fliken `recoveries` (`billing:read`) och `mayDecideRecovery`.
- `money-view.ts` läser `GET /v1/recoveries?status=proposed`. Ett valt återkrav visar beloppet, skadan, kunden och betalarkontot som länkar, och beslutet som tre val med en rad om vad som händer. Valen är byggda som prövningen av en ansökan.
- Att avräkna går inte att välja när kunden saknar betalarkonto. Gränsen för avskrivning och tillgodohavandet kontrollerar API:t. Ett nej visas som besked.

## Val och avvägningar
- **Länkar till skadan, kunden och kontot.** Handläggaren behöver se om utbetalningen redan har gått ut och hur mycket kunden har i tillgodohavande innan beslutet.

## Att känna till
- **Webbläsartestet öppnar bara fliken.** Ett förslag kräver ett retroaktivt avslut av en policy med betald skada, och i exempeldatan är det Bellas policy, som andra webbläsartester använder. Besluten prövas genom API:t i `modules/api/test/recoveries.test.ts`.

## Filer
- `apps/backoffice/src/money-logic.ts`, `views/money-view.ts`, `locales/sv.ts`
- `apps/backoffice/test/money-logic.test.ts`, `e2e/money.spec.ts`
