# Back office, steg 5b: produkter och regler (PR #85)

**Datum:** 2026-11-16 **ADR:** 0035, 0021, 0023 **Moduler:** apps/backoffice

## Vad
Produkter och regeluppsättningar med sina versioner och hela livscykeln:
- nytt utkast från en version
- ändra som JSON
- skicka till granskning
- publicera med fyra ögon, eller skicka tillbaka
- avsluta försäljningen av en produkt, eller avveckla en regelversion

Därmed är ADR 0035 byggd.

## Hur det fungerar
1. **`<pv-versions-panel>`** visar versionerna i en tabell. Den valda versionen visas med innehåll och de knappar som `lifecycleActions` tillåter.
2. **En `VersionsAdapter` per sort** i `catalog-views.ts` gör anropen.
   - Produkter har versionsnamn, säljperiod, `submissions`, `publications`, `returns` och `sales-endings`.
   - Regeluppsättningar har versionsnummer från API:t, beräkningsmodell, `retirements` i stället för `sales-endings`, och samma övriga steg.
3. **Utkastet** redigeras som JSON. `parseJson` stoppar ogiltig JSON innan något skickas, och API:t validerar resten. `act` visar nu fälten i ett `422` (`errors`), så att författaren ser alla fel på en gång.
4. **Fyra ögon:** `lifecycleActions` visar inte "Publicera" för den som skickade in versionen. API:t kontrollerar det också.

## Val och avvägningar
- **En gemensam komponent med adapter.** Livscykeln är densamma för produkter och regler, och därför också koden. Det som skiljer sig ligger i adaptern.
- **Innehållet som JSON.** Produkter och regler har stora och olika scheman: tariffer, teckningsregler och skaderegler. Formulär för vart och ett vore mycket kod. JSON med kontraktets validering räcker för den som skriver produkter och regler. Formulär kan komma senare för det som ändras ofta.
- **Nästa versionsnamn föreslås** efter årtalet, till exempel `2026.2` efter `2026.1`.

## Att känna till
- **Flödestestet avslutar försäljningen av `SE-HUND-BAS@2026.1`** från nästa år och publicerar en ny version i den testserver som körs i minnet. Det påverkar inte de andra testerna, som gäller i dag.
- **Simulering** av en regelversion mot sparade beslut (`.../simulations`) finns i API:t men inte i appen än.

## Filer
- `apps/backoffice/src/catalog-logic.ts`, `src/components/versions-panel.ts`, `src/views/catalog-views.ts` (nya)
- `apps/backoffice/src/actions.ts`, `permissions.ts`, `auth.ts`, `components/app-shell.ts`, `locales/sv.ts`, `icons.json`
- `apps/backoffice/test/catalog-logic.test.ts`, `test/format.test.ts`, `e2e/catalog.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`
