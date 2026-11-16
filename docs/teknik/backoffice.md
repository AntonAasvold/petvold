# Back office: hur den är byggd

Appen ligger i `apps/backoffice` (ADR 0035). Den är byggd med Lit 3, Web Awesome 3 (bara kärnan, MIT), Vite och TypeScript. Den byggs till statiska filer och pratar bara med API:t.

## Delar

| Fil | Gör |
| --- | --- |
| `src/main.ts` | Laddar Web Awesomes stilar och ikoner, väljer språk och session, och startar `<pv-app>` |
| `src/components/app-shell.ts` | `<pv-app>`: inloggning, `GET /v1/me`, meny efter rättigheter och routing |
| `src/components/data-grid.ts` | `<pv-data-grid>`: tabellen under varje lista |
| `src/views/` | En vy per sida: `login-view`, `claims-queue` och `claim-detail`. `labels.ts` översätter koder. |
| `src/api/schema.d.ts` | Typerna, genererade från `modules/api/openapi.yaml` med `npm run ui:types`. Den är incheckad, och CI stoppar om den avviker. |
| `src/api/client.ts` | openapi-fetch med token och `Accept-Language`. `unwrap` ger data eller ett problem (RFC 9457). |
| `src/auth.ts` | `devSession` med dev-serverns tokens, och `oidcSession` med oidc-client-ts (PKCE, token bara i minnet) |
| `src/i18n.ts`, `src/locales/sv.ts` | `@lit/localize` i körläge. Engelskan står i koden med ett id per text, och svenskan i `sv.ts`. Web Awesomes egen svenska laddas också. |
| `src/format.ts`, `grid-keys.ts`, `pager.ts`, `permissions.ts`, `decide.ts` | Ren logik utan webbläsare: formatering, tangentbord, sidindelning med markör, menyer, och vad ett beslut kräver och vem som får göra vad. Testas med `node:test`. |
| `src/components/claim-actions.ts` | `<pv-claim-actions>`: besluta, attestera, skicka tillbaka, begära prövning och ompröva. Varje åtgärd skickar `Idempotency-Key` (`IdempotencyKeys`, samma nyckel tills åtgärden gått igenom) och beslutet `expectedInputHash`. `409` blir ett besked med "Ladda om". |
| `src/components/explanation-dialog.ts` | `<pv-explanation-dialog>`: förklaringen till ett beslut i en `wa-dialog` |
| `src/icons.ts`, `icons.json`, `scripts/copy-icons.mjs` | Ikoner från Font Awesome Free (npm), kopierade till `public/icons` före dev och bygge. `wa-icon` läser dem därifrån och aldrig från ett CDN. |

## `<pv-data-grid>`

- **En vanlig `<table>`** med `role="grid"` och Web Awesomes färger och avstånd. Rubriken står kvar vid rullning.
- **Kolumner som data:** `{ key, header, value, align, sortable }`. `value` får ge text eller en Lit-mall, till exempel ett märke.
- **Tangentbordet** följer ARIA-mönstret för grid. `move` i `grid-keys.ts` räknar fram nästa cell, och en flyttbar `tabindex` håller ett tabbstopp i tabellen.
- **Händelser:** `pv-row-activate` (Enter eller klick), `pv-load-more` och `pv-sort`.
- **Lägen:** laddar, tomt, fel med "Försök igen", och "Visa fler" när API:t har en `nextCursor`.

## Konfiguration vid bygget

| Variabel | Betyder | Förval |
| --- | --- | --- |
| `VITE_API_URL` | API:ts adress | `http://localhost:8787` |
| `VITE_OIDC_ISSUER` | Bolagets identitetstjänst. Saknas den används dev-tokens. | – |
| `VITE_OIDC_CLIENT_ID` | Appens klient-id hos identitetstjänsten | `petvold-backoffice` |
| `VITE_OIDC_SCOPE` | Scope | `openid` |

API:t måste tillåta appens adress i `PETVOLD_CORS_ORIGINS` (drift.md).

## Test

- **`npm run ui:test`** testar den rena logiken. Den kontrollerar också att varje ikon som koden använder finns i `icons.json`, och att varje text-id i koden har en svensk översättning i `sv.ts` och inget mer.
- **`npm run ui:e2e`** kör flödena i Chromium med Playwright: köerna, tangentbordet, språket, besluta mot förslaget, besluta, attestera med fyra ögon, pröva och förklaringen. Testerna delar en API-server och körs i ordning. Attesten körs före andra beslut på Bellas skador, eftersom de delar försäkringsbelopp. Det startar API:ts dev-server i minnet på port 8797 och Vite på 5181. Egna portar, och aldrig en server som redan kör, så att en annan app på de vanliga portarna inte testas av misstag.
- **CI-jobbet `ui`** genererar typerna och jämför dem, typkontrollerar, kör båda testerna och bygger.
