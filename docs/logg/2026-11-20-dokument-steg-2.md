# Dokument, steg 2: uppladdning från back office och kundens dokument (PR #116)

**Datum:** 2026-11-20 **ADR:** 0038 (steg 2), 0036 **Moduler:** api, apps/backoffice

## Vad
- En handläggare laddar upp en fil som bilaga till en skada direkt från back office.
- Kundens sida visar alla dokument om kunden i en lista: Petvolds arkiv, brev som bolagets dokumentsystem skickat och bilagor i bolagets arkiv.

## Hur det fungerar
1. **Uppladdningen:** kortet "Bilagor" skickar först filen till `POST /v1/claims/{id}/documents` med `FormData`, och skapar sedan bilagan med adressen `urn:petvold:doc:{id}` och dokumentets kontrollsumma, storlek och mediatyp.
2. **Kontrollen:** `POST /v1/claims/{id}/attachments` prövar en adress i Petvolds arkiv mot dokumentet. Dokumentet ska höra till samma ärende och ha samma sha256, storlek och mediatyp. Skademotorn ändras inte och läser aldrig dokumenten (ADR 0001).
3. **Kundens lista:** `GET /v1/parties/{id}/documents` samlar
   - Petvolds dokument med kundens id, som `seesDocument` prövar en och en
   - bilagor i bolagets arkiv på skador på kundens policyer
   - meddelanden till kunden med ett lyckat utskick som har ett dokument-id

   En bilaga i Petvolds arkiv listas en gång, som dokument med bilagans typ.
4. **Back office:** `<pv-party-documents>` på kundens sida, och "Öppna" för en fil i arkivet skapar en intern länk och öppnar den i en ny flik.

## Val och avvägningar
- **En egen adress för kundens lista** (`/v1/parties/{id}/documents`) i stället för att utöka `GET /v1/documents`. Raderna har olika form beroende på var filen finns, och `Document` beskriver bara Petvolds arkiv. ADR 0038 är uppdaterad.
- **Två anrop vid uppladdning** i stället för ett. Bilagan och dokumentet hör till olika moduler. Går det andra anropet inte igenom finns dokumentet ändå i arkivet och i kundens lista, och handläggaren kan försöka igen.
- **Uppladdning är förvalet** i formuläret. Adressen i bolagets arkiv finns kvar som alternativ.

## Att känna till
- **Ett brev från bolagets dokumentsystem** går inte att öppna från Petvold. Listan visar dess id i bolagets arkiv.
- **E2E:** testet öppnar inte fliken med PDF:en, eftersom en PDF aldrig blir klar som sida i en webbläsare utan fönster. Det hämtar länken och kontrollerar filen.

## Filer
- `modules/api/src/app.ts`, `openapi.yaml`, `test/documents.test.ts`
- `apps/backoffice/src/components/claim-attachments.ts`, `src/components/party-documents.ts` (ny), `src/document-logic.ts` (ny), `src/views/party-detail.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `test/document-logic.test.ts` (ny), `e2e/register.spec.ts`
- `docs/funktion/dokument.md`, `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/adr/0038-dokument-och-arkiv.md`
