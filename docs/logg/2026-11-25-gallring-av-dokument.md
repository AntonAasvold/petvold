# Gallring av dokument (PR #165)

**Datum:** 2026-11-25 **ADR:** 0038 punkt 9, 0028 **Moduler:** `documents`, `api`

## Vad
Dokumenten om en part gallras när parten anonymiseras. Filen tas bort ur lagringen, och raden med kontrollsumma, typ och datum finns kvar. Länkarna slutar fungera. Därmed är ADR 0038 byggd.

## Hur det fungerar
1. **`DocumentService.erasePartyDocuments(partyId)`** går igenom dokumenten med parten i `partyIds`.
   - Filen tas bort med `BlobStore.delete`, och sedan sätts `erased_at` med `DocumentStore.markErased`.
   - Filen tas bort först. Om markeringen fallerar hittar nästa körning dokumentet igen.
   - Filen tas bort också för ett dokument som redan är markerat. Det behövs efter en återställning.
2. **`S3BlobStore.delete`** använder `DeleteObjectCommand`. S3 svarar likadant för en nyckel som inte finns.
3. **Kroken `documents`** läggs till i `composition.ts` efter `payments`. Den stoppar aldrig ett godkännande.
4. **`erasures:reapply`** tar bort filerna igen när `DOCUMENTS_DATABASE_URL` och `PETVOLD_DOCUMENTS_BUCKET` är satta.

Rätten att uppdatera `erased_at` fanns redan sedan migration 0046. Ingen ny migrering behövdes.

## Val och avvägningar
- **Gallring med parten i stället för en egen körning med ett datum per dokument**, som ADR 0038 punkt 9 först tänkte sig. Gallringen av parter räknar redan policyer och skador som relationer. Ett dokument gallras därför vid samma tidpunkt som det hör till, utan ett datum som måste räknas fram och flyttas. Förtydligandet står i ADR 0038.
- **Ett dokument om två parter** gallras när den första av dem anonymiseras. Det innehåller den partens uppgifter.

## Att känna till
- **En bucket med versionshantering** behåller gamla versioner tills dess egen livscykelregel tar bort dem.
- **En kortare lagringstid för en viss sorts dokument** finns inte. Då behövs ett gallringsdatum och en körning.
- **Testet i `api`** prövar att kopplingen i `composition.ts` raderar både dokumenten och betaluppgifterna.

## Filer
- `modules/documents/src/index.ts`, `s3.ts`, `postgres.ts`, `test/document-service.test.ts`, `test-suites/document-store.ts`, `test-db/s3-blob-store.test.ts`
- `modules/api/src/composition.ts`, `scripts/reapply-erasures.ts`, `test/erasure-hooks.test.ts`
