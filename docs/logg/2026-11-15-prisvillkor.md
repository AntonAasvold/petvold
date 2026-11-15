# Prisvilkor: rabatter efter grundpriset (PR #57)

**Datum:** 2026-11-15 **ADR:** 0030 **Moduler:** `pricing-core`, `decisioning`, `catalog`, `policies`, `api`

## Vad

Rabatter läggs på efter grundpriset som prisvilkor: rabatt för andra djuret i ett hushåll eller en kull, och kampanjkoder. Prisvillkoren är en egen serie som publiceras med fyra ögon.

## Hur det fungerar

1. **I `decisioning`** är prisvillkoren en version med `calculationModel: price-terms.v1`, och `validatePriceTerms` kontrollerar dem. `familyOf` håller isär skaderegler, tariffer och prisvilkor i olika serier, och `priceTermsInForce` ger versionen som gäller.
2. **`price(tariff, input, priceTerms)`** räknar grundpriset som förut och sparar det som `basePremium`. Sedan:
   - Den bästa grupprabatten för `input.group` (sort och plats) väljs.
   - En kampanj med `input.campaignCode` läggs till, om den gäller på startdagen och, när `newPoliciesOnly` är satt, bara för nya policyer.
   - Summan begränsas till `maxTotalDiscountBp` och dras från grundpriset med BigInt, avrundat en gång.
   - Lägsta premie och avrundningen gäller igen.
   - Varje rabatt blir ett steg i `breakdown`, och `facts.discountBp` visar summan.
   - Prisvillkorens referens ingår i `inputHash`.
3. **I katalogen** finns `priceTermsSeries`, som bara får finnas med `tariffSeries`. Vid granskning kontrolleras den via `ProductDeps.priceTermsProblems`.
4. **I `PolicyService.quote`** blir `groupId` till nästa plats i gruppen. Grupper som är begränsade till en kanal anger `group` själva. Prisvillkoren hämtas via `TariffPort.priceTermsInForce`.

## Val och avvägningar

- **Bara den bästa grupprabatten.** Annars skulle en kullrabatt och en allmän grupprabatt ges för samma djur.
- **Rabatter i baspunkter av grundpriset, inte av varandra.** Det blir lättare att förklara, eftersom 15 % + 20 % blir 35 % och inte 32 %.
- **En okänd kampanjkod ger fel**, i stället för att tyst ignoreras. Kunden ska veta att koden inte gällde.
- **En ny serie** i stället för fält i tariffen. Det följer ditt beslut, och kampanjer kan ändras utan att tariffen ändras.

## Att känna till

- Tecknande, ändring och förnyelse använder inte priset än. Det är nästa PR.
- Den lokala databasen har `SE-HUND-BAS` utan prisvillkor. Kör `npm run dev:reset` eller prova i minnesläge.

## Filer

- `modules/pricing-core/src/index.ts` (`PriceTermsContent`, `validatePriceTerms`, prisvillkor i `price`), `modules/pricing-core/src/fixtures.ts`
- `modules/decisioning/src/index.ts`, `modules/catalog/src/products.ts`, `modules/catalog/seed/products.json`
- `modules/policies/src/index.ts` (`quote`), `modules/api/src/app.ts`, `modules/api/src/wiring.ts`, `modules/api/src/dev-server.ts`, `modules/api/openapi.yaml`
