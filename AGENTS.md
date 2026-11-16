# Instruktioner för kodagenter

För Cursor, Codex och andra agenter som läser `AGENTS.md`. Samma regler som i [CLAUDE.md](CLAUDE.md), som är källan om de skiljer sig åt.

Petvold är en headless kärna för djurförsäkring (hund, katt, häst) för europeiska marknader. Allt går genom API:t i `modules/api/openapi.yaml`.

## Regler

- **Rent ursprung (ADR 0009).** Använd aldrig material från någon arbetsgivare, bara publika källor och egna idéer. Ange källor. Exempeldata är påhittad.
- **All kod på engelska:** identifierare, kommentarer, felmeddelanden, testnamn, SQL, konfiguration och exempeldata. `npm run lint:lang` stoppar å, ä och ö i kod. Dokumentation, commit-meddelanden och PR-beskrivningar skrivs på svenska.
- **Pengar** är heltal i minsta enhet, med valutan en gång per objekt (ADR 0014). Marknaden anges alltid.
- **Moduler läser aldrig varandras tabeller** (ADR 0001). Domänkod i `*-core` har ingen I/O.
- **Kontrakt före kod.** Ändra `openapi.yaml` först. `npm run lint:openapi` kontrollerar att kontrakt och kod stämmer.
- **Varje PR** uppdaterar `docs/funktion/`, `docs/teknik/`, `docs/status.md` och skriver en post i `docs/logg/`. Se `docs/arbetssatt.md`.

## Bygga ett gränssnitt mot Petvold

1. **Starta API:t:** `npm run dev:up` och sedan `npm run dev`. API:t svarar på http://localhost:8787, och API-sidan finns på `/docs`.
2. **Logga in med en dev-token** i `Authorization: Bearer …`, till exempel `dev-handler`, `dev-approver`, `dev-seller` eller `dev-customer`. Alla finns i `modules/api/src/dev-server.ts`.
3. **Fråga vem du är:** `GET /v1/me` ger rättigheter, omfång och beloppsgränser. Visa bara det som anroparen får göra. API:t kontrollerar ändå varje anrop.
4. **Listor** svarar med `{ items, nextCursor? }`. Hämta nästa sida med `?cursor=…`, och tolka aldrig markören. Arbetsköerna är `GET /v1/claims?status=awaiting-decision`, `awaiting-approval` och `review-requested`, och för manuell prövning `GET /v1/applications?status=referred`.
5. **Fel** kommer som `application/problem+json` (RFC 9457) med `title`, `detail` och vid valideringsfel `errors` per fält.
6. **Anrop som skapar något** kräver `Idempotency-Key` (8–128 tecken). Skapa nyckeln en gång per användarhandling, så att ett nytt försök inte skapar en dubblett.
7. **Språk:** skicka `Accept-Language: sv` eller `en`. Skälen i en bedömning kommer översatta.
8. **Teckna:** en produkt med hälsofrågor tecknas med `POST /v1/applications`. Hämta frågorna med `GET /v1/application-questions`. Både ansökan och `POST /v1/policies` kräver kundens godkännande (`acceptance`).
9. **CORS:** dev-servern tillåter `http://localhost:5173` och `http://localhost:3000`. Ange andra med `PETVOLD_CORS_ORIGINS`.

Exempeldatan beskrivs i [docs/teknik/utvecklingsmiljo.md](docs/teknik/utvecklingsmiljo.md). Bellas skador ligger i varje arbetskö.

## Kommandon

```
npm test               # alla enhetstester
npm run test:db        # mot Postgres, kräver npm run dev:up
npm run typecheck
npm run lint:openapi
npm run lint:lang
npm run site           # dokumentationssajten i _site/
npm run dev            # dev-server med exempeldata
npm run dev:reset      # tömmer den lokala databasen
```
