# Back office, steg 3: policyer och ansökningar (PR #82)

**Datum:** 2026-11-16 **ADR:** 0035, 0029, 0031 **Moduler:** apps/backoffice

## Vad
Tre nya avsnitt:
- **Policyer:** sökning, och policyn med termer, förbehåll, versioner över tid och historik.
- **Ansökningar:** kön för manuell prövning och beslutet.
- **Förslag:** överlåtelser och avslut som väntar på svar.

## Hur det fungerar
1. **Sökningen:** `parseSearch` i `policy-logic.ts` känner igen ett id på prefixet, ett personnummer och ett chipnummer.
   - Ett policy-id öppnar policyn direkt.
   - Ett djur- eller part-id ger `GET /v1/policies` med `animalId` eller `policyholderPartyId`.
   - Ett personnummer slås upp med `POST /v1/parties/searches`, och ett chip med `GET /v1/animals?microchip=`. Det första träffen ger sedan policyerna.
2. **Policyn:** `policy-detail.ts` hämtar policyn, historiken och förslagen samtidigt. `versionOn` väljer versionen som gäller i dag, bland dem som inte har ersatts. Tabellen över versioner visar båda tidsaxlarna: gäller från och till, och känd från och ersatt.
3. **Ansökan:** `application-detail.ts` visar svaren och kontrollerna ur underlaget. Formuläret för beslut visas med `mayUnderwrite`, och återkallelsen med `mayWithdraw`. `applicationDecisionProblems` kräver motivering, en skälkod vid avslag och ingen startdag bakåt i tiden.
4. **Förslagen** listas med `status=pending`. En rad öppnar policyn, där förslaget besvaras.
5. **`act`** i `actions.ts` är den gemensamma vägen för en åtgärd, med samma besked som i steg 2.

## Val och avvägningar
- **Personnummer söks med `POST`.** Numret hamnar då aldrig i en adress, i webbläsarens historik eller i en logg (ADR 0026). Därför finns det inte heller i sökfältets URL.
- **Bara första träffen** vid sökning på personnummer eller chip. En person har ett nummer och ett djur ett chip, så fler träffar är ett fel i registret. Det kan visas som en lista om det behövs.
- **Skälkoden vid avslag skrivs som text** med reglernas första skäl förvalt. Koderna kommer från teckningsreglerna och skiljer sig mellan bolag, så det finns ingen fast lista att välja från.
- **Förslag besvaras från policyn**, inte från kön. Den som svarar ser då vad förslaget gäller.

## Att känna till
- **Märken och testerna.** Web Awesomes märken har rollen `status`. Testerna letar därför efter beskedet som `wa-callout[role="status"]`.
- **Omladdning loggar ut** i utvecklingsläget, eftersom token bara finns i minnet. Testerna går mellan avsnitten för att hämta listor igen.

## Filer
- `apps/backoffice/src/policy-logic.ts`, `src/actions.ts`, `src/views/policies-search.ts`, `policy-detail.ts`, `applications-queue.ts`, `application-detail.ts`, `proposals-queue.ts` (nya)
- `apps/backoffice/src/permissions.ts`, `components/app-shell.ts`, `views/labels.ts`, `locales/sv.ts`
- `apps/backoffice/test/policy-logic.test.ts`, `test/format.test.ts`, `e2e/policies.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`
