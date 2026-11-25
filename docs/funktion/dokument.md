# Dokument

Petvold har ett eget arkiv för filer: bilagor till skador i dag och, senare, brev som Petvold gör själv (ADR 0038). Filen ligger i bolagets objektlagring som talar S3, och Petvold sparar uppgifterna om den i modulen `documents`. Andra moduler sparar bara dokumentets id.

## Ladda upp

`POST /v1/claims/{id}/documents` (rättighet `claims:register`) tar emot filen som `multipart/form-data` i fältet `file`.

- **Tillåtna filer:** högst 25 MB, och bara PDF, JPEG, PNG eller HEIC. Filens innehåll måste stämma med mediatypen. En HTML-fil som kallar sig PDF avvisas.
- **Kontrollsumman** (sha256) räknar Petvold själv. Den kontrolleras igen varje gång filen öppnas, och en fil som inte stämmer lämnas aldrig ut.
- **Filen ändras aldrig.** Arkivet vägrar att skriva över en fil som redan finns.
- **Dokumentet hör till ärendet** och gäller försäkringstagaren på första behandlingsdagen. Därför kommer det med i kundens lista.

```
POST /v1/claims/clm_021877/documents
Idempotency-Key: 7c41…
Content-Type: multipart/form-data; boundary=…

201 { "id": "doc_…", "kind": "uploaded", "mediaType": "application/pdf", "size": 184320,
      "sha256": "e733…", "owner": { "claimId": "clm_021877", "policyId": "pol_bella" },
      "partyIds": ["pty_owner001"], … }
```

## Kundens dokument

`GET /v1/documents?partyId=pty_…` listar kundens dokument, nyast först. Listan kan också tas fram per ärende (`claimId`) eller policy (`policyId`), men aldrig för alla dokument på en gång.

Listan visar bara det anroparen får se:
- `documents:read`
- rätten till det dokumentet hör till: `claims:read` för ett ärende, `policies:read` för en policy och `notices:read` för ett meddelande
- anroparens omfång, så att en klinik bara ser sina egna ärenden och kundkanalen bara sina policyer
- för en kunds lista dessutom `parties:read`

Ett dokument som anroparen inte får se finns inte för anroparen, och svaret blir `404`.

### En lista för kunden, var dokumentet än finns

`GET /v1/parties/{id}/documents` (rättighet `parties:read`) samlar allt om kunden i en lista, nyast först:

| `source` | `type` | Vad | Öppnas |
| --- | --- | --- | --- |
| `petvold` | `attachment` | En fil i Petvolds arkiv, med bilagans typ när den är en bilaga | Med en länk (`documentId`) |
| `insurer` | `attachment` | En bilaga i bolagets arkiv | På adressen (`url`) |
| `insurer` | `notice` | Ett brev som bolagets dokumentsystem skickade, med kanal, kontrollsumma och id i bolagets arkiv (`archiveId`) | I bolagets arkiv |

Varje rad kräver rätten till det den gäller: `documents:read` för Petvolds arkiv, `claims:read` för bilagor och `notices:read` för brev. Back office visar listan på kundens sida.

## Bilagor från arkivet

En uppladdad fil blir en bilaga med adressen `urn:petvold:doc:{id}` (ADR 0036, 0038). `POST /v1/claims/{id}/attachments` kontrollerar att dokumentet hör till samma ärende, och att kontrollsumma, storlek och mediatyp är dokumentets. Back office gör båda stegen när en fil laddas upp.

## Länkar

En fil öppnas aldrig via en permanent adress. Den som vill öppna den skapar en länk som slutar gälla:

`POST /v1/documents/{id}/links` med `audience` och valfritt `seconds`:

| `audience` | För | Gäller | Kräver |
| --- | --- | --- | --- |
| `internal` | En person i back office | 15 minuter | `documents:read` |
| `customer` | Kunden, till exempel i en portal eller ett mejl | 60 sekunder till 7 dagar, förval 15 minuter | `documents:read` och `documents:share` |

- **Adressen** är `{PETVOLD_PUBLIC_URL}/d/{token}`. Den består av ett slumpat id och en signatur, och den säger varken vilket dokument eller vilken kund det gäller. Den kräver ingen inloggning, eftersom den signerade adressen själv är behörigheten.
- **Svaret** har `Cache-Control: no-store`, `Referrer-Policy: no-referrer` och ett neutralt filnamn, så att adressen inte sparas eller läcker vidare.
- **När länken inte fungerar** svarar adressen `410`. Det gäller både en länk som har gått ut, en som har spärrats och en manipulerad länk. Svaret säger inte varför.
- **Loggen:** `GET /v1/documents/{id}/links` visar varje länk, vem som skapade den och när den öppnades. Det är underlaget för vem som har sett dokumentet, till exempel vid en begäran om tillgång (GDPR artikel 15).
- **Spärr:** `POST /v1/documents/{id}/links/{linkId}/revocations` (rättighet `documents:share`) gör att länken slutar fungera direkt.
- **Petvold sparar inte adressen.** Skapa en ny länk när den behövs igen.

## PDF från Petvolds mallar

Petvold kan göra ett meddelande till en PDF med sina egna mallar (ADR 0038):

`POST /v1/notices/{id}/documents` (rättighet `notices:deliver`).

- **Petvold gör underlaget.** Mallen fylls med meddelandets innehåll, och dessutom med uppgifter som läses när PDF:en görs: mottagarens namn och adress, djurets namn och skälens text. Skälen har samma text som i API:t. Namn och adresser sparas aldrig i meddelandet.
- **Gotenberg gör PDF:en.** Den blir PDF/A-2b och PDF/UA-1, och Gotenberg hämtar ingenting utifrån.
- **Dokumentet** hör till meddelandet och gäller mottagaren. Det finns alltså i kundens lista. Det sparar mallens namn, marknad, språk, version och kontrollsumma, och en hash av datan (`template`). Samma mall och data ger samma dokument.
- **Mallar finns** för `claim-decision` (skadebesked), `policy-confirmation` (försäkringsbrev) och `invoice` (faktura: belopp, förfallodag, OCR- eller RF-referens, vart kunden betalar och raderna med period och avgift), för Sverige på svenska och engelska. En annan typ ger `422`.
- **Utan Gotenberg** (`PETVOLD_GOTENBERG_URL`) svarar anropet `503`.
- **En ny PDF** av samma meddelande blir ett nytt dokument.
- **Dokumenten per meddelande:** `GET /v1/documents?noticeId=` listar dem.

Mallarna använder designsystemets färger och avstånd: svartvitt, ramar och tabeller med linjer. Typsnitten Inter och Space Grotesk finns inte i Gotenberg, så Liberation Sans används i stället.

### Petvold gör breven automatiskt

Inställningen `documentMaker` per marknad avgör vem som gör meddelandenas dokument (se [Meddelanden](meddelanden.md#bolagets-inställningar)).

- **`insurer` är förvalet.** Bolagets dokumentsystem gör dokumentet som förut, och den som redan har ett dokumentsystem märker ingen skillnad.
- **Med `petvold`** gör Petvold PDF:en direkt när meddelandet skapas, för de typer som har en mall: skadebesked och försäkringsbrev. Andra typer gör dokumentsystemet som förut.
- **Meddelandet sparar vem som gör dokumentet** (`documentMaker`) när det skapas. En ändrad inställning gäller bara nya meddelanden.
- **PDF:en görs av reläet** efter `notice.created`. Om Gotenberg inte svarar försöker reläet igen, och efter tio försök läggs händelsen undan som en död händelse. Då går PDF:en fortfarande att göra med "Gör PDF". En PDF som gjordes före ett avbrott används i stället för att en ny görs.
- **Meddelandet får dokumentet** (`document`: id, sha256, vem och när), och händelsen `notice.document_made` säger till dokumentsystemet att PDF:en finns.
- **Utskicket rapporteras med bara kanal och tid.** Petvold fyller i sitt dokument och dess sha256. Ett annat dokument-id ger `422`, och en rapport innan PDF:en finns ger `409`.
- **Utan Gotenberg** nekas inställningen `petvold` med `422`, eftersom Petvold då inte kan göra några PDF:er.
- **Kundens lista** visar PDF:en en gång, från Petvolds arkiv, med meddelandets id och typ.

## Rättigheter

| Rättighet | Får | Standardroller |
| --- | --- | --- |
| `documents:read` | Läsa dokument och öppna dem med en kort länk | `handler`, `approver`, `clinic`, `policy-registrar`, `underwriter`, `privacy-officer`, `document-service`, `customer-channel` |
| `documents:share` | Ge kunden en länk, och spärra en länk | `document-service`, `customer-channel` |

En sparad rollinställning behöver `npm run roles:sync -- --apply` för att få de nya rättigheterna.

## Gallring

Dokumenten gallras när parten de gäller anonymiseras ([Parter](parter.md#radering-och-begränsning-adr-0028), ADR 0028). Det gäller mottagaren av ett meddelande, och försäkringstagaren för en policy eller ett ärende.
- **Filen tas bort** ur lagringen. Uppgifterna om dokumentet finns kvar med typ, datum och kontrollsumma, så att det går att visa att dokumentet fanns och att det gallrats.
- **En länk till dokumentet** slutar fungera (`410`), och nya länkar går inte att skapa.
- **Gallringen av parter** räknar policyer och skador som relationer. Ett dokument gallras därför inte förrän det det hör till har passerat lagringstiden.
- **Efter en återställning** från säkerhetskopia tar `npm run erasures:reapply` bort filerna igen. Det kräver `DOCUMENTS_DATABASE_URL` och `PETVOLD_DOCUMENTS_BUCKET`.

En bucket med versionshantering behåller gamla versioner av filen tills bucketens egen livscykelregel tar bort dem. Ställ in en sådan regel.

**Exempel:** Annas lagringstid går ut, och en dataskyddsansvarig godkänner anonymiseringen. Hennes skadebesked och bilagor finns kvar i listan med typ och datum, men går inte att öppna.

## Det som kommer

ADR 0038 är byggd i alla fem stegen. Steg 5 blev gallring med parten (se förtydligandet i ADR 0038).
