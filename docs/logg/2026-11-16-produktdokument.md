# Produktens dokument och godkännandet (PR #69)

**Datum:** 2026-11-16 **ADR:** 0032 **Moduler:** common, catalog, policies, api

## Vad
En produktversion kan lista sina dokument till kunden: villkor, förköpsinformation och faktablad, per språk, med adress i bolagets arkiv och kontrollsumma. Kundens godkännande vid tecknande och ansökan anger vilka av dem kanalen visade. Petvold kontrollerar att de hör till produktversionen. Det är första delen av ADR 0032 (punkt 8 och 9). Meddelandemodulen kommer sedan.

## Hur det fungerar
1. **Katalogen** (`modules/catalog/src/products.ts`): `ProductContent.documents` är en lista med `type`, `language`, `uri` och `sha256`. `validateDocuments` kontrollerar formen när ett utkast sparas. `checkReferences`, som körs vid granskning och publicering, kräver alla tre typerna på marknadens språk när produkten har dokument. Dokumenten ligger i innehållet, så `productChecksum` täcker dem utan ändring.
2. **Marknadens språk** finns i `MARKET_LANGUAGES` i `modules/common/src/market.ts`. Det första språket är det som dokument skrivs på om kunden inte ber om något annat. `marketLanguage` ger det, eller `undefined` för en marknad utan förval.
3. **Porten** (`modules/api/src/wiring.ts`): `ProductOffer.documents` har typ, språk och kontrollsumma, inte adressen. Policymodulen behöver inte veta var dokumenten ligger.
4. **Policymodulen** (`modules/policies/src/index.ts`): `acceptanceOf` kontrollerar formen på `acceptance.documents` och sorterar listan. `checkAcceptedDocuments` körs i `planIssue` när produkten är hämtad. Varje angivet dokument måste finnas med samma kontrollsumma, och för en produkt med dokument måste villkoren och förköpsinformationen finnas med.
5. **Manuellt godkännande:** `decideApplication` skickar med ansökans dokument till `planIssue`, så samma kontroll görs igen mot produktversionen.

## Val och avvägningar
- **Ingen migrering.** Dokumenten sparas i befintliga jsonb-kolumner: produktens `content`, ansökans `acceptance` och transaktionens `issue`.
- **Granskningen kräver alla tre typerna**, också förköpsinformationen. ADR 0032 nämner villkor och faktablad. Ett godkännande kräver villkoren och förköpsinformationen, så en produkt utan förköpsinformation på marknadens språk skulle inte gå att sälja.
- **Godkännandet kräver villkor och förköpsinformation, inte faktabladet.** Faktabladet ska lämnas, men det är förköpsinformationen och villkoren som avtalet bygger på (FAL 2 kap. 2 §, distansavtalslagen 3 kap. 4–5 §§). En kanal kan ange faktabladet också.
- **Godkännandet kan ange dokument på ett annat språk** än marknadens, till exempel engelska villkor om kunden bad om det. Det måste bara finnas i produktversionen.
- **Kontrollsumman jämförs med små bokstäver.** En kanal som skickar versaler får samma resultat.
- **Marknadens språk ligger i `common`**, bredvid tidszonerna, eftersom både katalogen och meddelandemodulen behöver det. Bara Sveriges regel har en källa här. De andra marknadernas språk är landets officiella språk. En marknads regel om språk kontrolleras när marknaden läggs till.
- **En produkt utan dokument fungerar som förut**, så befintliga produkter och kanaler påverkas inte. En kanal som anger dokument för en sådan produkt får `422`.

## Att känna till
- Exempelprodukten `SE-HUND-PLUS@2026.1` har påhittade dokument. Kontrollsummorna är sha256 av en kort text, inte av riktiga filer. En befintlig lokal databas har produkten utan dokument, eftersom exempeldatan inte ändrar det som finns. Exempeldatan läser därför dokumenten från den sparade produkten. `npm run dev:reset` ger den nya versionen.
- Tecknande vid en överlåtelse anger inga dokument än.

## Filer
- `modules/common/src/market.ts` (`MARKET_LANGUAGES`, `marketLanguage`)
- `modules/catalog/src/products.ts`, `test/product-service.test.ts`, `seed/products.json`
- `modules/policies/src/index.ts`, `test/policy-service.test.ts`
- `modules/api/src/wiring.ts`, `seed.ts`, `openapi.yaml`, `test/policies.test.ts`, `test/composition.test.ts`
- `docs/funktion/produktkonfiguration.md`, `policyer.md`, `teckning.md` och `docs/teknik/arkitektur.md`
