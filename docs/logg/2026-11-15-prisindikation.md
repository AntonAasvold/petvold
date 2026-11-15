# Produktens tariff och prisindikation (PR #56)

**Datum:** 2026-11-15 **ADR:** 0030 **Moduler:** `catalog`, `policies`, `parties`, `pricing-core`, `api`

## Vad

En produktversion pekar på en tariffserie, och granskningen kontrollerar att tariffen täcker produkten. Kanaler kan få ett pris utan att något sparas.

## Hur det fungerar

1. **Granskningen.** `ProductContent.tariffSeries` kontrolleras vid granskning i `ProductService.checkReferences`. Kontrollen går via `ProductDeps.tariffProblems(serie, dag, produkt)`, som installationen kopplar till `DecisioningService.tariffInForce` och `tariffCoverage`. `null` betyder att ingen tariff gäller, och en lista betyder att något saknas.
2. **Anropet.** `POST /v1/quotes` går till `PolicyService.quote`:
   - Den hämtar djurets art, ras och födelsedag via `AnimalPort`, eller tar dem från anropet.
   - Den hämtar postnumret via `PartyPort.postalCodeOf`, eller tar det från anropet.
   - Den kontrollerar att produkten säljs på startdagen, i marknaden och för arten, och att valen finns.
   - Den hämtar tariffen via `TariffPort` och anropar `price`.
3. **Svaret** innehåller termens datum, villkoren och `PriceResult`. Det innehåller inte postnumret.
4. **API-lagret** stoppar en roll bunden till kliniker eller försäkringar från att ange `animalId` eller `policyholderPartyId`, eftersom den inte får läsa djur och parter.

## Val och avvägningar

- **Prisindikationen ligger i policymodulen.** Den behöver samma kontroller som tecknandet (produkt till salu, art, val, termlängd), och tecknandet ska använda samma kod.
- **Postnumret hämtas inuti modulen** och lämnas aldrig ut. `PartyService.postalCodeOf` svarar `null` för anonymiserade och begränsade parter.
- **En ny produkt i exempeldatan,** `SE-HUND-BAS@2026.1`, i stället för att ändra den publicerade `SE-HUND-VV-LIV@2026.2`. En publicerad version ändras aldrig.

## Att känna till

- Tecknandet använder inte priset än. Det är steg 4 i planen.
- `SE-HUND-BAS` har `midTermCancellation: immediate`, så direkt uppsägning går att prova lokalt.

## Filer

- `modules/catalog/src/products.ts` (`tariffSeries`, `tariffProblems`), `modules/catalog/seed/products.json`
- `modules/pricing-core/src/index.ts` (`tariffCoverage`)
- `modules/policies/src/index.ts` (`quote`, `TariffPort`), `modules/parties/src/index.ts` (`postalCodeOf`)
- `modules/api/src/app.ts`, `modules/api/src/wiring.ts`, `modules/api/src/dev-server.ts`, `modules/api/src/permissions.ts`, `modules/api/openapi.yaml`
