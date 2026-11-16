# Konventioner för API-kontraktet (PR #73)

**Datum:** 2026-11-16 **ADR:** 0034 **Moduler:** api

## Vad
Reglerna för kontraktet är nedskrivna i `docs/teknik/api-konventioner.md`, och `npm run lint:openapi` kontrollerar dem. Avvikelserna som finns i dag står i en lista som bara kan krympa. Nästa PR rättar dem.

## Hur det fungerar
1. **`conventionProblems`** i `modules/api/src/conventions.ts` tar det tolkade kontraktet och går igenom varje adress och operation:
   - delar i kebab-case
   - sökvägsparametrar som `{xId}` med mönster, eller en känd naturlig nyckel
   - ingen samling på toppnivå under en annan resurs
   - bara ett id eller `searches` direkt under en samling
   - inställningar under `/v1/settings`
   - handlingar som substantiv i plural
   - filter i camelCase, `status` i stället för `state`, och `{roll}PartyId`
   - `operationId` och taggar
2. **Parametrar på adressnivå räknas med.** Flera adresser har `parameters` för hela adressen och inte för varje operation.
3. **`conventionCheck`** jämför med `KNOWN_DEVIATIONS`. Den ger dels nya avvikelser, dels poster i listan som inte längre avviker.
4. **`check-contract.ts`** stoppar på båda. Det betyder att en rättelse också måste ta bort sin post ur listan.

## Val och avvägningar
- **Egen kod i stället för Spectral.** Reglerna är få och gäller just det här kontraktet. Kontrollen ligger bredvid den som redan jämför kontrakt och kod.
- **En lista som bara krymper** i stället för att rätta allt i samma PR. Reglerna och kontrollen kan granskas för sig, och listan visar exakt vad nästa PR ska rätta.
- **Inte allt kan kontrolleras.** Att en samling heter i plural, att en underresurs ägs av sin förälder och att en körning heter efter sin samling kräver granskning.
- **Ordlistan över versioner** finns för att samma ord betyder sju saker. Ingen av dem behöver ändras, men de ska inte blandas ihop.

## Att känna till
- En ny roll i ett filter för parter (`{roll}PartyId`) läggs till i `PARTY_ROLES`.
- Testet `conventions.test.ts` kör också kontrollen mot det riktiga kontraktet.

## Filer
- `modules/api/src/conventions.ts`, `scripts/check-contract.ts`, `test/conventions.test.ts`
- `docs/adr/0034-api-konventioner.md`, `docs/teknik/api-konventioner.md`, `docs/arbetssatt.md`, `docs/adr/README.md`
