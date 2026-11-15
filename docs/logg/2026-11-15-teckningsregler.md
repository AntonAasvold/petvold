# Teckningsregler och `underwriting-core` (PR #65)

**Datum:** 2026-11-15 **ADR:** 0031 **Moduler:** underwriting-core (ny), decisioning, api

## Vad
Ett försäkringsbolag kan skriva teckningsregler som en versionerad serie och publicera dem med fyra ögon. Reglerna innehåller åldersgränser, hälsofrågor, regler för svaren och raser. Den rena funktionen `underwrite` ger utfallet för en ansökan. Ansökan själv kommer i nästa PR.

## Hur det fungerar
- **`underwrite(rules, input)`** i `modules/underwriting-core/src/index.ts`:
  1. Kontrollerar marknaden och datumen.
  2. Kontrollerar svaren mot `questionsFor(content, species)`. Varje fråga för arten ska besvaras en gång, och koder får bara finnas med ett ja på en fråga av typen `diagnoses`.
  3. Prövar arten och åldern (dagar och hela år på startdagen), rasen och varje svarsregel. Varje prövning blir en `Check`.
  4. Ger utfallet. Det strängaste vinner enligt `SEVERITY`.
  5. Samlar förbehållen. För en fråga av typen `diagnoses` blir det de angivna koderna plus regelns, sorterade.
  6. Räknar `inputHash` över regelreferensen och ett normaliserat underlag, med sorterade svar och koder.
- **`validateUnderwriting`** körs när ett utkast skapas eller ändras, via `DecisioningService.validate`. Den kräver bland annat:
  - kända frågor i reglerna
  - skälskoder
  - beskrivning för ett förbehåll
  - koder för ett förbehåll på en ja- eller nej-fråga
- **`decisioning`** har fått `seriesKindOf(model)`, som ersätter kontrollerna av tariff och prisvilkor på flera ställen. Den nya funktionen `underwritingInForce(series, onDate)` hämtar reglerna. API-lagret använder `seriesKindOf` för att svara `422` på simulering av allt utom skaderegler.

## Val och avvägningar
- **Utfallen är ordnade, och alla regler prövas.** Det ger en fullständig förklaring och gör att fler ja aldrig ger ett mildare utfall. Ett egenskapstest kontrollerar det över alla kombinationer av svar i exemplet.
- **`onlyFor` i stället för ett regelspråk.** En regel per fråga med en lista över diagnoser räcker för det som syns i publika villkor, som "hjärtsjukdom avslås, annat blir förbehåll".
- **Åldersgränsen i hela år och lägsta ålder i dagar**, som villkoren uttrycker det, till exempel "från sex veckor" och "till och med nio år".
- **Frågornas texter är data i reglerna.** Exemplet i koden har bara engelska texter, eftersom `lint:lang` stoppar svenska tecken i kod. Svenska texter skrivs av bolaget i reglerna, som i exemplet i `docs/funktion/teckning.md`.
- **`ageInYears` finns i både `pricing-core` och `underwriting-core`.** Kärnorna beror inte på varandra. Funktionen kan flytta till `common` med B2 i granskningen.

## Att känna till
- Inget i Petvold anropar `underwrite` än. Det gör ansökan i nästa steg.
- Produktversionen pekar inte på någon serie med teckningsregler än. `underwritingCoverage` finns redan och kopplas in med `underwritingSeries`.
- Teckningsregler kan inte simuleras.

## Filer
- `modules/underwriting-core/src/index.ts`, `src/fixtures.ts` och `test/underwrite.test.ts`
- `modules/decisioning/src/index.ts`
- `modules/api/openapi.yaml` (`UnderwritingContent`)
- `docs/funktion/teckning.md`
