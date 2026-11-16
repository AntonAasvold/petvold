# Back office, steg 1: grunden och skadornas köer (PR #80)

**Datum:** 2026-11-16 **ADR:** 0035 **Moduler:** apps/backoffice (ny), api (CORS i dev-servern)

## Vad
Första steget av back office: appen med inloggning, meny efter rättigheter, svenska och engelska, och skadornas köer och ärende med bedömning, beräkning och beslut. Allt är bara läsning. Datatabellen `<pv-data-grid>` är grunden för alla listor som kommer.

## Hur det fungerar
1. **Start** (`src/main.ts`): Web Awesomes stilar, de lokala ikonerna, språket och sessionen. Sedan läggs `<pv-app>` på sidan.
2. **`<pv-app>`** hämtar `GET /v1/me` efter inloggningen. Menyn byggs av `sectionsFor`, och sökvägen väljer vy med `match` i `router.ts`. `navigate` byter sida utan omladdning.
3. **Kön** (`claims-queue.ts`) anropar `GET /v1/claims` med `status`, `limit` och `cursor`. `pager.ts` lägger ihop sidorna. Ett nummer per anrop gör att svaret från en kö man lämnat ignoreras.
4. **Ärendet** (`claim-detail.ts`) hämtar ärendet, bedömningen och besluten samtidigt. `404` och `403` blir vanliga besked.
5. **Typerna:** `openapi-typescript` gör `src/api/schema.d.ts` av kontraktet, och `openapi-fetch` typar anropen. En adress, en parameter eller ett fält som inte finns är ett typfel.

## Val och avvägningar
- **`@lit/localize` i körläge med egna id:n.** Engelskan står i koden och svenskan i `sv.ts`. Ingen generering behövs, och `sv.ts` är undantagen från språkkontrollen. Texter med variabler undviks, så att översättningen förblir en vanlig tabell.
- **Ikonerna kopieras lokalt.** Web Awesomes standardbibliotek hämtar ikoner från Font Awesomes CDN. Anton föreslog lokala ikoner. `scripts/copy-icons.mjs` kopierar de ikoner som står i `icons.json` från npm-paketet `@fortawesome/fontawesome-free` (ikonerna CC BY 4.0, koden MIT) till `public/icons`, och `src/icons.ts` registrerar dem som standardbibliotek. Ett test kontrollerar att varje ikon som koden använder finns i listan.
- **En egen router och inget delat lager för tillstånd.** Varje vy hämtar sitt eget, och `api` skickas som egenskap. Det räcker för en app med få sidor. `@lit/context` kan läggas till om det blir för mycket att skicka.
- **Token i minnet.** En omladdning loggar in igen via identitetstjänsten. Det är säkrare än `localStorage` och följer IETF:s råd för appar i webbläsaren.
- **Portar:** appen använder 5180 och flödestesterna 8797 och 5181. Playwright återanvänder aldrig en server som redan kör.

## Att känna till
- **Ett misstag under bygget.** Port 5173 användes av en Vite-server i ett annat lokalt projekt.
  - Första versionen av testkonfigurationen återanvände den servern, så ett test laddade fel app. Ögonblicksbilden togs bort, och innehållet användes inte.
  - Jag hade också rensat portarna med `kill`, vilket kan ha stoppat den andra servern.
  - Därför egna portar och inga återanvända servrar.
- Dev-servern tillåter nu också `http://localhost:5180` med CORS.
- Första gången behövs `npx playwright install chromium` i `apps/backoffice`.

## Filer
- `apps/backoffice/` (ny): `package.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `index.html`, `icons.json`, `scripts/copy-icons.mjs`, `src/`, `test/` och `e2e/`
- `package.json` (workspace `apps/*` och skripten `ui:*`), `.github/workflows/ci.yml` (jobbet `ui`), `scripts/check-language.ts`, `modules/api/src/dev-server.ts`
- `docs/funktion/backoffice.md` och `docs/teknik/backoffice.md` (nya), `docs/README.md`, `docs/funktion/README.md`, `docs/teknik/utvecklingsmiljo.md`, `README.md`
