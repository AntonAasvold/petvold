# Teckning

Teckningsreglerna avgör om en ansökan om en ny försäkring godkänns, godkänns med förbehåll, går till manuell prövning eller avslås. Beslutet bakom finns i ADR 0031.

*Läge:* teckningsreglerna, ansökan, kön för manuell prövning och besluten i den är byggda.

## Vad reglerna innehåller

Teckningsreglerna är en versionerad serie i regelmodulen, med beräkningsmodellen `underwriting.v1`. De har samma livscykel som skaderegler och tariffer: utkast, granskning och publicering med fyra ögon (se [Produktkonfiguration](produktkonfiguration.md#regeluppsättningar)). Reglerna som gäller på **ansökningsdagen** används.

| Del | Betyder |
| --- | --- |
| `ageLimits` | Per art: lägsta ålder i dagar och högsta ålder i hela år på startdagen. En art som saknas avslås (`species-not-covered`). Gränserna gäller nya försäkringar, inte förnyelse. |
| `questions` | Hälsofrågorna. Varje fråga har ett id, en text per språk och en typ. `boolean` besvaras med ja eller nej. `diagnoses` besvaras med ja och diagnoskoderna, eller med nej. En fråga kan gälla bara vissa arter. |
| `answerRules` | Vad ett ja leder till: `rider` (förbehåll), `refer` (manuell prövning) eller `decline` (avslag), alltid med en skälskod. En regel kan gälla bara vissa diagnoser (`onlyFor`). |
| `breedRules` | Raser som går till manuell prövning eller avslås, med skälskod. |

## Utfallet

Alla regler prövas, och det strängaste utfallet vinner:

| Utfall | När |
| --- | --- |
| `accept` | Ingen regel slår till |
| `accept-with-riders` | Bara förbehåll |
| `refer` | Någon regel ger manuell prövning, och ingen ger avslag |
| `decline` | Någon regel ger avslag |

Svaret redovisar varje kontroll med resultat och underlag: art, ålder i dagar och år, ras och varje fråga. Skälskoderna för manuell prövning och avslag listas i den ordning de hittades. Försäkringsavtalslagen kräver skäl vid avslag (FAL 3 kap. 1 § och 7 kap. 6 §). Kanalen översätter koden till kundens språk.

**Förbehåll.** Ett förbehåll från en fråga av typen `diagnoses` undantar de diagnoser kunden angav, plus de som regeln listar. Ett förbehåll från en ja- eller nej-fråga undantar regelns diagnoser. Skademotorn prövar förbehållen som i dag (se [Skadereglering](skadereglering.md)).

**Svaren kontrolleras.** Alla frågor för arten måste besvaras en gång. Ett ja på en fråga av typen `diagnoses` kräver diagnoskoder. Ett nej eller en ja- eller nej-fråga tar inga koder.

## Exempel

Påhittade regler för hund i Sverige:

```json
{
  "market": "SE",
  "ageLimits": [{ "species": "dog", "minAgeDays": 42, "maxAgeYears": 9 }],
  "questions": [
    { "id": "previous-illness", "type": "diagnoses",
      "labels": { "sv": "Har djuret varit sjukt, skadat eller behandlats av veterinär de senaste två åren?" } },
    { "id": "ongoing-symptoms", "type": "boolean",
      "labels": { "sv": "Har djuret symtom just nu som inte har undersökts av veterinär?" } }
  ],
  "answerRules": [
    { "question": "previous-illness", "outcome": "decline", "reason": "heart-disease", "onlyFor": ["CAR-MITRAL", "CAR-DCM"] },
    { "question": "previous-illness", "outcome": "rider", "reason": "previous-illness", "riderDescription": "Uppgiven vid ansökan" },
    { "question": "ongoing-symptoms", "outcome": "refer", "reason": "ongoing-symptoms" }
  ],
  "breedRules": []
}
```

Utfallet för några ansökningar som startar 2026-11-15:

| Ansökan | Utfall |
| --- | --- |
| Doris, född 2023-05-02, nej på båda frågorna | `accept` |
| Doris, ja på tidigare sjukdom med öroninflammation (`ORA-OTIT`) | `accept-with-riders`, förbehåll för `ORA-OTIT` |
| Doris, ja på tidigare sjukdom med mitralisinsufficiens (`CAR-MITRAL`) | `decline`, skäl `heart-disease` |
| Doris, ja på symtom som inte undersökts | `refer`, skäl `ongoing-symptoms` |
| En valp född 2026-10-05, 41 dagar gammal | `decline`, skäl `too-young` |
| En hund som fyller 10 år på startdagen | `decline`, skäl `too-old` |

## Produkten pekar på reglerna

Produktversionen anger serien i `underwritingSeries` (se [Produktkonfiguration](produktkonfiguration.md)). Vid granskningen måste en version vara i kraft när försäljningen börjar, för samma marknad och med åldersgränser för varje art som produkten täcker. En produkt utan serie tecknas direkt med `POST /v1/policies`, utan frågor.

## Ansökan

**1. Hämta frågorna.** `GET /v1/application-questions?productVersion=SE-HUND-PLUS@2026.1&species=dog` ger frågorna i reglerna som gäller i dag, i ordning. `label` är texten på anroparens språk (`Accept-Language`), och `labels` har alla språk. Rättigheten är `policies:quote`, som för prisindikationen.

**2. Visa priset och vad svaren leder till.** `POST /v1/quotes` med `answers` ger också `underwriting`: utfallet, förbehållen och skälen. Inget sparas.

**3. Skicka ansökan.** `POST /v1/applications` tar det som `POST /v1/policies` tar, plus `answers`. Rättigheten är `policies:write`.

```http
POST /v1/applications
{
  "market": "SE", "animalId": "ani_kajsa", "policyholderPartyId": "pty_owner004",
  "productVersion": "SE-HUND-PLUS@2026.1", "startDate": "2026-12-01",
  "acceptance": {
    "channel": "web", "reference": "sess-41b7", "acceptedAt": "2026-11-16T09:12:00Z",
    "documents": [
      { "type": "terms", "language": "sv", "sha256": "c4aa50fc…" },
      { "type": "pre-contract", "language": "sv", "sha256": "704d4d94…" }
    ]
  },
  "answers": [
    { "question": "previous-illness", "value": true, "diagnosisCodes": ["ORA-OTIT"] },
    { "question": "ongoing-symptoms", "value": false },
    { "question": "lameness", "value": false }
  ]
}
```

Petvold gör samma kontroller som vid tecknande och räknar fram priset. Godkännandet ska ange de dokument kunden fick se, eftersom produkten har dokument ([Policyer](policyer.md)). Sedan körs teckningsreglerna som gäller på ansökningsdagen, och ansökan sparas. Svaret är `201` för alla utfall:

| `status` | Utfall | Vad händer |
| --- | --- | --- |
| `accepted` | `accept` eller `accept-with-riders` | Policyn tecknas i samma transaktion. `policyId` pekar på den, och förbehållen ligger på första termen. |
| `referred` | `refer` | Ansökan väntar på en person med rollen `underwriter`. Ingen policy finns än. |
| `declined` | `decline` | Ansökan sparas med skälskoderna. Kanalen förklarar dem för kunden. |

**Förbehållen på policyn** har `source: "underwriting"`, ansökans id och frågan de kommer från. De gäller från startdagen och följer med vid förnyelse. Skademotorn prövar dem som andra förbehåll.

**Underlaget sparas** (ADR 0018) i `underwriting`:
- `input`: djurets art, ras och födelsedag som de var i registret, startdagen och svaren
- `result`: utfallet, varje kontroll, skälen och teckningsreglernas version och kontrollsumma
- `engineVersion`: Petvolds version

Samma regler och samma underlag ger samma utfall och samma `inputHash`. Vid en skada kan bolaget visa vilka frågor som ställdes och vad som svarades (FAL 4 kap. 2 §).

**Kön.** `GET /v1/applications?status=referred` är kön för manuell prövning, äldst först. Listan kan också filtreras på `market`, `animalId` och `policyholderPartyId`. Den som är bunden till en klinik eller till policyer ser inga ansökningar. En ansökan i kön har en sista dag för beslut (`deadline`): dagen den kom in plus produktens `policy.applicationExpiryDays`, förval 30 dagar.

## Manuell prövning

En ansökan i kön kan beslutas en gång. Beslutet sparas bredvid det automatiska utfallet, så båda syns (`decision`), och `status` visar beslutet.

**Beslut:** `POST /v1/applications/{id}/decisions` kräver rättigheten `policies:underwrite`, som rollen `underwriter` har. Varje beslut kräver en motivering (`note`).
- **Godkänn** (`"outcome": "accept"`): policyn tecknas till premien kunden ansökte till. Om tariffen i dag ger ett annat pris sparas kundens pris som ett manuellt pris, med ansökan som skäl. Förbehållen blir de som reglerna föreslog, eller de som anges i `riders` (`source: "manual"`). Om startdagen har passerat anges en ny med `startDate`. Godkännandet från ansökan följer med till policyn.
- **Avslå** (`"outcome": "decline"`): kräver en skälskod i `reason`, som kanalen förklarar för kunden (FAL 7 kap. 6 §).

```http
POST /v1/applications/app_…/decisions
{ "outcome": "accept", "note": "Journalen visar en förkylning som är över" }
```

**Återkalla:** `POST /v1/applications/{id}/withdrawals` med en valfri `reason`, rättighet `policies:write`. Kanalen använder den när kunden inte längre vill ha försäkringen.

**Utgång:** `POST /v1/application-expiry-runs`, rättighet `policies:renew`, avslutar varje ansökan i kön vars sista dag har passerat. Den körs schemalagt som förnyelsen. En ansökan som har gått ut kan inte beslutas (`409`).

**Gallring (ADR 0028).** En ansökan räknas som en relation till sökanden. En ansökan som väntar håller relationen pågående, och de andra räknas från dagen de kom in. En godkänd ansökan har dessutom policyn, som gäller längre.

**Händelser:** `application.received` och sedan `application.accepted`, `application.referred` eller `application.declined`. `policy.issued` har ansökans id.

## Exempeldata

Dev-servern har teckningsreglerna `SE-HUND-UW@1` med frågorna på svenska och engelska, och produkten `SE-HUND-PLUS@2026.1` som använder dem. Produkten har påhittade dokument på svenska och engelska, och Lenas ansökningar anger de svenska villkoren och förköpsinformationen. Lena (`pty_owner004`) har tre ansökningar:
- Kajsa uppgav en öroninflammation och fick ett förbehåll för `ORA-OTIT`.
- Rocky har symtom som ingen veterinär har undersökt och väntar i kön. Token `dev-underwriter` kan besluta om honom.
- Sixten är 12 år och avslogs med skälet `too-old`.

*Inte byggt än:* brevet med skälen vid avslag (F2), ansökan från kundkanalen, och en kortare lagringstid för avslagna ansökningar.
