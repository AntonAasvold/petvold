# Dokument, steg 1: arkivet och länkarna (PR #115)

**Datum:** 2026-11-20 **ADR:** 0038 (steg 1) **Moduler:** documents (ny), api, db

## Vad
- **En fil kan laddas upp till en skada** och sparas i Petvolds arkiv, med Petvolds egen kontrollsumma.
- **Kundens dokument** listas per kund, ärende eller policy, och bara det anroparen får se.
- **Ett dokument öppnas genom en länk** som slutar gälla, loggas och kan spärras.
- **Arkivet är S3:** bolagets lagring i drift och SeaweedFS lokalt.

## Hur det fungerar
1. **Uppladdningen:** `POST /v1/claims/{id}/documents` läser filen ur `multipart/form-data`. API:t tar fram försäkringstagaren på första behandlingsdagen ur policyn och anropar `DocumentService.upload`. Den gör så här:
   - kontrollerar storleken, mediatypen och filens första byte mot mediatypen
   - räknar sha256
   - sparar filen i arkivet och sedan uppgifterna, så att en rad aldrig pekar på en fil som saknas
2. **Länken:** `createLink` sparar länken med ett slumpat id, och adressen blir `{id}.{HMAC(id)}`. `open` gör så här:
   - kontrollerar signaturen med `timingSafeEqual`
   - kontrollerar att länken inte har gått ut eller spärrats och att dokumentet inte har gallrats
   - loggar hämtningen
   - kontrollerar filens sha256 innan den lämnas ut
3. **Vem som ser vad:** `seesDocument` i `app.ts` följer det dokumentet hör till: ett ärende med `coversClaim`, ett meddelande med `seesNotice` och en policy med `coversPolicy`. Ett dokument utanför anroparens omfång ger `404`.
4. **Lagringen:**
   - **Uppgifterna:** `documents.document`, `documents.link` och `documents.link_access` (migration 0046) med rollen `documents_service`. Tjänstens roll får bara spärra länkar och märka filer som gallrade.
   - **Filerna:** `S3BlobStore` skriver med `If-None-Match: *`, så att lagringen själv vägrar att skriva över en fil.
5. **Kompositionsroten** kopplar ihop uppgifterna, arkivet och nyckeln. Servern i drift kräver `DOCUMENTS_DATABASE_URL`, `PETVOLD_DOCUMENT_KEY`, `PETVOLD_PUBLIC_URL` och `PETVOLD_DOCUMENTS_BUCKET`. `/healthz` frågar också arkivet.

## Val och avvägningar
- **SeaweedFS i stället för MinIO.** MinIO ger inte längre ut färdiga images för den fria versionen och har licensen AGPL v3. SeaweedFS har licensen Apache 2.0, ges ut aktivt och har ett S3-API med `weed mini`, som skapar hinken vid start. Ändringen står i ADR 0038.
- **Två nya rättigheter i stället för `signed-in`.** `signed-in` är bara för det som gäller anroparen själv, som `GET /v1/me`. `documents:read` och `documents:share` går att ge och ta bort per roll.
- **Samma svar för alla fel på en länk.** `410` för en länk som gått ut, spärrats eller manipulerats, så att svaret inte säger något om dokumentet.
- **`@aws-sdk/client-s3` 3.1162.0** från 2026-11-04, alltså minst två veckor gammal. Den talar med både AWS och SeaweedFS.
- **Uppladdningen finns bara under en skada.** Det täcker bilagorna i steg 2. Uppladdning till en policy eller ett meddelande kommer när den behövs.

## Att känna till
- **En lokal databas** behöver rollen `documents_service` innan migreringen, och `npm run dev:up` för att starta SeaweedFS. `.env.example` har de nya raderna.
- **Rollinställningen:** en sparad rollinställning saknar de nya rättigheterna tills `npm run roles:sync -- --apply` körs. Annars svarar dokumentens anrop `403`.
- **Dev-servern stannar** om arkivet inte svarar vid start. `tsx watch` startar då inte om förrän en fil ändras.
- **Virusskanning** finns inte. Uppladdade filer kan bara läsas av den som får se ärendet.

## Filer
- `modules/documents/` (ny): `src/index.ts`, `src/postgres.ts`, `src/s3.ts`, `test/`, `test-db/`, `test-suites/document-store.ts`
- `db/migrations/0046_documents.sql` (ny), `db/init/01-roles-and-databases.sql`, `db/test/claims-schema.test.ts`
- `compose.yaml`, `dev/seaweedfs/s3.json` (ny), `.env.example`
- `modules/api/openapi.yaml`, `src/app.ts`, `src/composition.ts`, `src/dev-server.ts`, `src/server.ts`, `src/permissions.ts`, `test/documents.test.ts` (ny), `test/composition.test.ts`, `test/permissions.test.ts`, `package.json`
- `docs/funktion/dokument.md` (ny), `docs/funktion/behorighet.md`, `docs/teknik/arkitektur.md`, `docs/teknik/drift.md`, `docs/teknik/utvecklingsmiljo.md`, `docs/adr/0038-dokument-och-arkiv.md`
