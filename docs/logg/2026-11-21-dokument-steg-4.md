# Dokument, steg 4: Petvold gör breven automatiskt (PR #118)

**Datum:** 2026-11-21 **ADR:** 0038 (steg 4) **Moduler:** communications, api, webhooks, apps/backoffice

## Vad
En inställning per marknad, `documentMaker`, avgör om Petvold eller bolagets dokumentsystem gör meddelandenas dokument. Med `petvold` gör Petvold PDF:en av skadebesked och försäkringsbrev när meddelandet skapas. Meddelandet får dokumentets id och sha256, och utskicket rapporteras med bara kanal och tid.

## Hur det fungerar
1. **Inställningen:** `MarketNoticeSettings.documentMaker` är `insurer` (förval) eller `petvold`. `petvold` nekas med `422` om ingen PDF-renderare finns. `communications` får porten `petvoldTemplates(type, market)`, men bara när en renderare finns.
2. **När meddelandet skapas** sparas `documentMaker` på det. Det blir `petvold` bara om marknaden valt det och Petvold har en mall för typen. Andra typer stannar hos bolaget. `notice.created` tar med `documentMaker`.
3. **Reläet** gör PDF:en efter `notice.created` med `ensureNoticePdf` i `modules/api/src/notice-pdf.ts`, samma kod som `POST /v1/notices/{id}/documents`:
   - Om meddelandet redan har ett dokument händer inget.
   - En PDF som gjordes före ett avbrott används igen.
   - Annars görs en ny.
   - Ett fel, till exempel att Gotenberg inte svarar, ger ett nytt försök. Webhooken köas inte två gånger, eftersom kön känner igen händelsens id.
4. **`communications.addDocument`** sparar `{ id, sha256, madeBy, madeAt }` i `communications.notice_document` (en rad per meddelande, och den ändras aldrig). I samma transaktion skrivs `notice.document_made` i outboxen (migration 0048).
5. **Utskicket:** för ett meddelande som Petvold gör dokumentet till fyller `addDelivery` i Petvolds dokument och sha256.
   - Ett annat dokument ger `422`.
   - En rapport innan PDF:en finns ger `409`.
6. **Kundens lista** tar inte längre med en rad från bolagets arkiv för ett meddelande med Petvolds PDF. Raden från Petvolds arkiv får meddelandets id och typ.
7. **Back office:**
   - valet "Vem gör dokumenten" under Inställningar → Meddelanden
   - på meddelandets sida: vem som gör dokumentet, och en rapport utan dokument-id när det är Petvold

## Val och avvägningar
- **PDF:en görs i reläet och inte när meddelandet skapas.** Meddelandet sparas alltid, även när Gotenberg inte svarar, och PDF:en kommer när Gotenberg svarar igen. Ett meddelande som har blivit en död händelse går att rädda med "Gör PDF".
- **Dokumentet är en egen tabell.** Ett meddelande ändras aldrig, och tabellen har bara rätt att lägga till rader, som utskicken. Därför blir dokumentet inte en kolumn som uppdateras.
- **`communications` läser aldrig `documents`.** Modulen vet bara vilka mallar som finns, genom porten, och får dokumentets id och sha256 från API:t.
- **Utskicket sparar Petvolds dokument-id och sha256.** Beviset för vad kunden fick ligger då på samma ställe, var dokumentet än gjordes.

## Att känna till
- **En ändrad inställning gäller bara nya meddelanden,** eftersom meddelandet sparar vem som gör dokumentet när det skapas.
- **Dokumentsystemet väntar på `notice.document_made`** innan det skickar, och prenumererar på den händelsen.
- **Flödestesterna körs utan Gotenberg** och kontrollerar att `petvold` nekas. Den automatiska PDF:en provas i API-testerna med en renderare i minnet.

## Filer
- `db/migrations/0048_communications_notice_documents.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/communications/src/index.ts`, `src/postgres.ts`, `test/communications-service.test.ts`, `test-suites/notice-store.ts`
- `modules/api/src/notice-pdf.ts` (ny), `src/app.ts`, `src/composition.ts`, `openapi.yaml`, `asyncapi.yaml`, `test/documents.test.ts`
- `modules/webhooks/src/index.ts`
- `apps/backoffice/src/settings-logic.ts`, `src/views/settings-view.ts`, `src/views/notice-detail.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `test/settings-logic.test.ts`, `e2e/settings.spec.ts`
