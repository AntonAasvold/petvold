# 0005. Pengar som heltal i minsta valutaenhet

- Status: Ersatt av [0014](0014-valuta-en-gang-per-objekt.md)
- Datum: 2026-11-14

## Sammanhang

Skadeberäkningar och bokföring tål inga avrundningsfel. Flera marknader ger flera valutor.

## Beslut

`Money` är `{ amount: integer, currency: ISO 4217 }` i minsta enhet. Procentsatser i baspunkter. Avrundning halv uppåt på ett enda ställe. Ingen valutaväxling inne i flödena.

## Konsekvenser

Exakt aritmetik. Presentationen sker i klienten.

## Alternativ

Decimaltal: ger avrundningsfel. Decimal-bibliotek: fungerar men sprids lätt och är långsammare.
