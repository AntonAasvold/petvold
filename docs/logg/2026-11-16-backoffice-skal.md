# Toppraden och menyn enligt designsystemet (PR #87)

**Datum:** 2026-11-16 **ADR:** 0035 **Moduler:** apps/backoffice

## Vad
Första av tre PR:er som bygger om back office efter designsystemet Petvold.
- **Toppraden** är svart och har Petvold, Back office, ett sökfält, språkval och Logga ut.
- **Menyn** har val som är 44 px höga. Det valda valet är svart med vit text, och räknare visar köerna som väntar.

## Hur det fungerar
1. **Stilarna:** `src/styles/pv-components.ts` läser in `design/components.css` som text med Vites `?inline` och gör den till en Lit-stilmall med `unsafeCSS`. `app-shell.ts` har den först i `static styles` och använder klasserna `pv-topbar` och `pv-nav` direkt. Det som gäller bara skalet, som layouten och språkvalet på svart, ligger efter.
2. **Toppraden:** sökfältet är ett `<form role="search">`. `searchTarget` i `policy-logic.ts` gör frågan till en sida. Ett känt id öppnas direkt, och allt annat går till `/policies` med frågan i `history.state`. `policies-search.ts` läser den därifrån och tömmer tillståndet.
3. **Räknarna:** varje avsnitt i `permissions.ts` kan ha `count`, alltså en lista och dess filter. `loadCounts` hämtar en sida med högst 100 per kö som användaren ser, och `countLabel` visar "3" eller "100+". Räknarna hämtas efter inloggningen och en sekund efter varje sidbyte.
4. **Språkvalet** är kvar som `wa-select`. Dess etikett döljs visuellt med `::part(form-control-label)` men finns kvar för skärmläsare. Annars tog den plats, svart på svart.

## Val och avvägningar
- **En källa för komponenternas stilar.** `design/components.css` läses in vid bygget i stället för att kopieras in i komponenten. Ändras designsystemet följer komponenterna med.
- **Räknarna läser en sida, inte ett antal.** API:t har inga anrop för antal. 100 räcker för att se att något väntar. Ett anrop för antal i kontraktet kan komma om köerna blir stora.
- **Personnummer i historikens tillstånd.** Sökfältet finns på varje sida, och ett personnummer får aldrig hamna i adressen (ADR 0026). `history.state` försvinner vid omladdning, och det är meningen.
- **Vem som är inloggad** visas också, i grått före Logga ut. Specifikationen nämnde det inte, men handläggare behöver se vilken roll de är inloggade med.
- **Knappen Logga ut** är en vanlig `<button>` med designsystemets stil. En `wa-button` på svart bakgrund hade krävt fler undantag i temat.

## Att känna till
- Flödestestet för skalet kontrollerar räknaren för meddelanden. Sixtens ofullständiga avslag ligger alltid i den kön, medan skadornas kö kan vara tom när testet körs.
- Testet kontrollerar också att det valda menyvalet är svart, som ett enkelt prov på att temat och stilarna har laddats.

## Filer
- `apps/backoffice/src/components/app-shell.ts`, `src/styles/pv-components.ts` (ny), `src/permissions.ts`, `src/policy-logic.ts`, `src/router.ts`, `src/views/policies-search.ts`, `src/locales/sv.ts`
- `apps/backoffice/test/format.test.ts`, `test/policy-logic.test.ts`, `e2e/shell.spec.ts` (ny)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/teknik/designsystem.md`
