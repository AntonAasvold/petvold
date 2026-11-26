# Pröva regler mot sparade beslut i back office (PR #NN)

**Datum:** 2026-11-26 **ADR:** 0018, 0021, 0035 **Moduler:** `apps/backoffice`

## Vad
På en serie med skaderegler kan en version, ofta ett utkast, prövas mot de sparade besluten i en period innan den publiceras.

## Hur det fungerar
- **API:t fanns redan:** `POST /v1/rule-sets/{series}/versions/{version}/simulations` med `rules:simulate`. Det använder `decisionsForSimulation` i skademotorn. Bara delen i back office saknades.
- **`src/simulation-logic.ts`** är ren och testad. `simulationRange` gör om dagarna till API:ts halvöppna period i UTC, där den sista dagen ingår. `defaultDays` ger de senaste 90 dagarna. `changes` säger vad som ändras i ett beslut.
- **`<pv-rule-simulation>`** under versionerna på regeluppsättningens sida väljer version och period, och visar summorna och de beslut som ändras.

## Val och avvägningar
- **Den nyaste versionen är förvald**, eftersom det oftast är utkastet som ska prövas.
- **Dagar och inte tidpunkter.** Den som prövar tänker i dagar, och API:t får hela dagar i UTC.

## Att känna till
- **En tariff** svarar `422` tills priser sparas med policyerna (ADR 0030). Formulären för tariffer, prisvillkor och teckningsregler kommer i nästa PR.

## Filer
- `apps/backoffice/src/simulation-logic.ts`, `components/rule-simulation.ts`, `views/catalog-views.ts`, `locales/sv.ts`
- `apps/backoffice/test/simulation-logic.test.ts`, `e2e/rule-simulation.spec.ts`
