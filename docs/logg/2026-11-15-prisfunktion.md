# Prisfunktion och tariffer (PR #55)

**Datum:** 2026-11-15 **ADR:** 0030 **Moduler:** `pricing-core` (ny), `decisioning`, `api`

## Vad

Petvold kan räkna en premie med en tariff. Tariffer publiceras med fyra ögon som skaderegler. Ingenting använder priset än. Prisindikation och pris vid tecknande kommer i nästa PR:er.

## Hur det fungerar

1. **`price({ content, ref }, input)`** i `pricing-core`:
   - Den hittar grundpremien för art och försäkringsbelopp.
   - Den hittar åldersbandet med `ageInYears(födelse, start)`, riskgruppen för rasen, faktorn för självrisken och zonen med `zoneFor`, där det längsta postnummerprefixet gäller.
2. **Faktorerna** multipliceras i BigInt: täljaren gånger baspunkterna, och nämnaren gånger 10 000 för varje faktor. Varje steg i `breakdown` visar beloppet så långt, avrundat för läsaren, men räkningen fortsätter oavrundad.
3. **Slutet.** Lägsta premie, avrundning till `roundTo` halvt uppåt, och termens premie som årspremien gånger termens dagar delat med årets dagar, också halvt uppåt.
4. **`inputHash`** är sha256 över tariffens referens och de uppgifter som avgjorde priset. Postnumret ingår inte, bara zonen.
5. **I `decisioning`** är en tariff en version med `calculationModel: tariff.v1`. `isTariffModel` styr vilken kontroll innehållet får (`validateTariff` eller skadereglernas). En serie får inte blanda skaderegler och tariffer. `rulesInForce` svarar `null` för en tariffserie, och `tariffInForce` för en serie med skaderegler.

## Val och avvägningar

- **Beräkningsmodellen skiljer tariffer från skaderegler.** Då behövs ingen ny tabell, ingen ny livscykel och inga nya rättigheter. Tariffer publiceras av samma roller som skaderegler.
- **Avrundning en gång.** Flyttal eller avrundning per steg ger öresfel som syns vid omräkning.
- **`breakdown` visar avrundade mellanbelopp** för läsaren. Beräkningen avrundar ändå bara en gång, så summan av stegen kan skilja sig ett öre från ett eget överslag.
- **Exempeltariffen** i `pricing-core/fixtures` är påhittad (ADR 0009).

## Att känna till

- Produktversionen pekar inte på en tariffserie än.
- Simulering av en tariff ger `422` tills priser sparas med policyer.

## Filer

- `modules/pricing-core/src/index.ts`, `modules/pricing-core/src/fixtures.ts`, `modules/pricing-core/test/price.test.ts`
- `modules/decisioning/src/index.ts` (`isTariffModel`, `tariffInForce`), `modules/decisioning/test/decisioning-service.test.ts`
- `modules/api/src/app.ts`, `modules/api/openapi.yaml`, `modules/api/test/api.test.ts`
- `docs/funktion/pris.md`
