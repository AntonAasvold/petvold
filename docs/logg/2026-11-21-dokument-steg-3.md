# Dokument, steg 3: Gotenberg och mallarna (PR #117)

**Datum:** 2026-11-21 **ADR:** 0038 (steg 3) **Moduler:** documents, api, apps/backoffice

## Vad
Petvold gör skadebesked och försäkringsbrev till PDF/A med sina egna mallar och Gotenberg. Dokumentet sparas i arkivet och visar vilken mall och vilken data det gjordes av.

## Hur det fungerar
1. **Anropet:** `POST /v1/notices/{id}/documents` läser meddelandet och, för läsaren, mottagarens namn och adress och djurets namn. API:t ger mallen `renderRule`, så att skälen och stegen får samma text som i API:t.
2. **`DocumentService.generate`:**
   - hittar mallen för typ, marknad och språk
   - fyller den med meddelandets innehåll och skickar HTML:en till `PdfRenderer`
   - kontrollerar att svaret är en PDF
   - sparar den med `template`: namn, marknad, språk, version, mallens kontrollsumma och en hash av datan i kanonisk JSON
3. **Mallarna** i `modules/documents/src/templates/`:
   - en gemensam layout med färger och typsnitt ur `design/tokens.json`, i A4 med marginaler
   - mallar för skadebesked och försäkringsbrev
   - texterna i en språkkatalog per språk
   - allt som fylls i escapas
   - kontrollsumman räknas på mallens källa, CSS:en och texterna
4. **`GotenbergRenderer`** skickar `index.html` till `/forms/chromium/convert/html` med A4 och `stages: [{ op: 'remediate', profile: ['PDF/A-2b', 'PDF/UA-1'] }]`.
5. **Gotenberg** körs i docker compose med flaggor som stänger av nätåtkomst, JavaScript, hämtning och webhooks för Chromium. Testet mot Gotenberg lägger in en bild från en extern adress, och loggen visar att den blockeras.
6. **Back office:** kortet "PDF från Petvold" på meddelandets sida.

## Val och avvägningar
- **Gotenberg 9.1.0** från 2026-11-06. I version 9 är PDF/A ett steg (`remediate`) och inte längre fälten `pdfa` och `pdfua`.
- **Mallarna som TypeScript-funktioner,** utan en mallmotor. Det blir inget nytt beroende, och escapingen sker på ett ställe. Svenska texter får bara finnas i språkkatalogen, och `check-language` tillåter `texts-sv.ts`.
- **Namn och adress läses när PDF:en görs** och sparas inte som data, som ADR 0032 kräver. Datans hash bygger därför bara på meddelandets innehåll.
- **Ett meddelandes dokument följer meddelandet** vid behörigheten, så att dokumentsystemet ser skadebesked utan `claims:read`.
- **Typsnitten:** Inter och Space Grotesk finns inte i Gotenberg och skickas inte med än, så Liberation Sans används. Typsnitten kan skickas med som filer senare.

## Att känna till
- **Flödestesterna** körs utan Gotenberg och kontrollerar beskedet `503`. Den riktiga PDF:en provas i databastesterna mot Gotenberg i docker compose.
- **Automatiska PDF:er** finns inte än. Inställningen som gör PDF:en när meddelandet skapas kommer i steg 4.

## Filer
- `modules/documents/src/index.ts`, `src/gotenberg.ts` (ny), `src/templates/` (ny), `src/postgres.ts`, `test/templates.test.ts` (ny), `test-db/gotenberg.test.ts` (ny), `test-suites/document-store.ts`, `package.json`
- `db/migrations/0047_documents_templates.sql` (ny), `db/test/claims-schema.test.ts`, `compose.yaml`, `.env.example`, `scripts/check-language.ts`
- `modules/api/src/app.ts`, `src/composition.ts`, `src/server.ts`, `openapi.yaml`, `test/documents.test.ts`
- `apps/backoffice/src/views/notice-detail.ts`, `src/locales/sv.ts`, `e2e/integrations.spec.ts`
