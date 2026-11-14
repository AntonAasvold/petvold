# 0001. Modulär monolit med tydliga modulgränser

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Systemet består av många komponenter (produkt, policy, skada, billing, ledger …) men byggs av en liten grupp.

## Beslut

En kodbas och en driftsenhet, uppdelad i moduler under `modules/`. Varje modul har eget kontrakt, eget databasschema och egen databasroll. Moduler pratar via API eller händelser, aldrig via varandras tabeller.

## Konsekvenser

Enkel drift och inga distribuerade transaktioner från dag ett. En modul kan brytas ut till egen tjänst utan att andra ändras. Gränserna måste hållas med disciplin och lint.

## Alternativ

Mikrotjänster från start: för mycket drift för vår storlek. En enda modul utan gränser: går inte att dela upp senare.
