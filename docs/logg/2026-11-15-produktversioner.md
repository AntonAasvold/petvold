# Produkter och produktversioner (PR #33)

**Datum:** 2026-11-15 **ADR:** 0021, 0023 (Föreslagen) **Moduler:** `catalog`, `decisioning`, `api`

## Vad

Produktversioner som `SE-HUND-VV-LIV@2026.2` finns nu i katalogen. De har säljperiod, arter, namn, regelserie och valbara försäkringsbelopp och självrisker, och de publiceras med fyra ögon. Skademotorn hittar sin regelserie via policyns produktversion i stället för via en hårdkodad funktion i dev-servern.

## Hur det fungerar

**Från utkast till publicerad version:**
1. `POST /v1/products/SE-HUND-VV-LIV/versions` valideras mot `ProductDraft` i kontraktet och går sedan till `ProductService.createDraft` i `catalog/src/products.ts`. Tjänsten validerar det som kontraktet inte kan uttrycka: standardvalen ska finnas bland alternativen, `periodDays` krävs bara för `fixedPer: period`, ingen art får stå två gånger och `salesTo` ska ligga efter `salesFrom`.
2. `submit` kör `checkReferences`:
   - `speciesActive(kod)` för varje art
   - `ruleSeriesInForce(serie, salesFrom)`, det vill säga att regelserien har en publicerad version som gäller när försäljningen börjar

   Båda är funktioner som installationen ger tjänsten. Därefter räknas `productChecksum` (sha256 över `content` och `salesFrom`) ut, och innehållet låses.
3. `publish` kontrollerar fyra ögon och kontrollsumman. Sedan kontrolleras att ingen annan publicerad version av samma produkt har en överlappande säljperiod (`overlaps`). Databasen gör samma kontroll med `daterange(sales_from, sales_to) &&` i triggern `catalog.check_product_version` (migration 0014).

**När en skada kommer in:**
1. `ClaimsService` hämtar policyn och anropar `RulesPort.getRules('SE-HUND-VV-LIV@2026.2', behandlingsdatum)`.
2. `DecisioningRulesPort` i `decisioning/src/index.ts` anropar `seriesFor(productVersion)`. Funktionen kan nu vara asynkron och svara `null`. I dev-servern är det `products.ruleSeriesOf(pv)`.
3. `ruleSeriesOf` delar id:t vid sista `@`, läser versionen och returnerar `ruleSeries` om versionen är publicerad. Säljperioden spelar ingen roll, eftersom en policy som redan är tecknad behåller sin version.
4. Serien går till `DecisioningService.rulesInForce`, precis som tidigare.

**Villkor för ett val:** `vetCareTermsFor(version, { annualLimit, deductible })` är ren och ger `VetCareTerms` med samma form som policyn redan har. API:et visar den som `GET .../vet-care-terms`. Policymodulen (M3) kommer att använda den när en policy tecknas.

## Val och avvägningar

- **Versionsnamn i stället för nummer.** Policyer och exempeldata använder redan `@2026.2`. Därför har `create` ingen kontroll av "nästa nummer", som regeluppsättningarna har, bara att namnet är unikt.
- **Inget avvecklingssteg.** En avvecklad version skulle lämna befintliga policyer utan regler. I stället kan försäljningen avslutas: `endSales` flyttar bara `salesTo` tidigare, aldrig före i dag, och sparar vem, när och varför. Därför ligger `salesTo` utanför kontrollsumman.
- **En version till salu per produkt och dag.** Den som säljer ska aldrig behöva välja. Det kontrolleras på tre ställen: i tjänsten (bra felmeddelande), i lagringen i minnet (samma beteende som Postgres i testsviten) och i databasen (skydd vid samtidiga anrop och direkta skrivningar).
- **Kontroller via funktioner, inte via import av tjänster.** `catalog` beror inte på `decisioning`. Installationen kopplar ihop dem (`ruleSeriesInForce`), och modulerna läser aldrig varandras tabeller.
- **`CatalogError` i en egen fil.** `index.ts` exporterar `products.ts` som i sin tur behöver felet. Med felet i `errors.ts` blir det inget cirkulärt beroende.
- **Typerna för självrisk kommer från `claims-core`** (`DeductibleTerms`, `VetCareTerms`). Produktens alternativ och policyns villkor har då exakt samma form, och ingen översättning behövs mellan dem.

## Att känna till

- **En okänd produktversion** ger inga regler, och skademotorn svarar `409`. Det märks i dev-servern om exempelprodukten inte är inläst.
- **Exempelprodukten** i `modules/catalog/seed/products.json` publiceras direkt via lagringen och hoppar över granskningen, på samma sätt som exempelreglerna. Filen har svenska namn och är undantagen i `lint:lang`.
- **Nya roller.** `catalog-publisher` och `catalog:publish` når inte en installation som redan har en sparad rollinställning (ADR 0020).
- **I `daterange(sales_from, sales_to)`** betyder `null` i `sales_to` "tills vidare", vilket stämmer med `salesTo` utan värde.
- **Inte byggt än:** andra moment än veterinärvård, pris (M4), och att policyn tecknas med `vetCareTermsFor` (M3).

## Filer

- `modules/catalog/src/products.ts`: typer, `ProductService`, `vetCareTermsFor`, `onSale`, lagring i minnet
- `modules/catalog/src/postgres.ts`: `PostgresProductStore`
- `db/migrations/0014_catalog_products.sql`: tabell, trigger och rättigheter
- `modules/decisioning/src/index.ts`: `DecisioningRulesPort` med asynkron `seriesFor`
- `modules/api/src/app.ts`: nio operationer under `/v1/products`
- `modules/api/src/dev-server.ts`: kopplar ihop katalog, regler och skademotor, och läser in exempelprodukten
- Tester: `modules/catalog/test/product-service.test.ts`, `modules/catalog/test-suites/product-store.ts`, `modules/catalog/test-db/product-store.test.ts` och `modules/api/test/products.test.ts`, som följer en version från utkast till en bedömd skada
