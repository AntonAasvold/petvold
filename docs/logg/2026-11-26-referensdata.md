# Referensdata i back office (PR #NN)

**Datum:** 2026-11-26 **ADR:** 0022, 0035 **Moduler:** `apps/backoffice`

## Vad
**Referensdata** i menyn visar arter, raser och kön med namn per språk, om koden erbjuds för ny data och historiken. En ny kod läggs till, och en ändring sparas som en ny revision med skäl.

## Hur det fungerar
- `src/reference-logic.ts` är ren och testad. `referenceProblems` följer API:ts regler: kodens mönster, minst ett namn, art för en ny ras och skäl vid en ändring. `referenceBody` bygger anropet. `suggestCode` föreslår en kod från det engelska namnet.
- `src/views/reference-view.ts` (`<pv-reference-data>`, `/reference-data`) har en flik per sort. Ett valt värde visar formuläret och revisionerna, och `PUT /v1/reference-data/{kind}/{code}` sparar.

## Val och avvägningar
- **Koden föreslås men kan ändras** innan den sparas. Sedan ändras den aldrig, eftersom djur och produkter pekar på den.
- **Svenska och engelska visas alltid i formuläret**, och andra språk som en kod redan har visas också.

## Filer
- `apps/backoffice/src/reference-logic.ts`, `views/reference-view.ts`, `permissions.ts`, `components/app-shell.ts`, `locales/sv.ts`, `icons.json`
- `apps/backoffice/test/reference-logic.test.ts`, `test/format.test.ts`, `e2e/reference.spec.ts`
