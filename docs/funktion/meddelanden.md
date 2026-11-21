# Meddelanden till kunden

Lagen kräver att kunden får vissa besked, till exempel ett försäkringsbrev när en policy tecknas och skälen när en ansökan avslås. Petvold avgör vilka besked som krävs, när de senast ska skickas och vad de ska innehålla. Bolagets dokumentsystem gör dokumentet med sina egna mallar, skickar det och rapporterar tillbaka. Beslutet bakom finns i ADR 0032.

## Så fungerar det

1. **Något händer i Petvold,** till exempel att en policy tecknas. Policymodulen skriver en händelse.
2. **Petvold skapar ett kundmeddelande** från händelsen. Meddelandet anger typ, mottagare, språk, innehåll och lagrum, och sista dagen då det ska vara skickat (`dueBy`).
3. **Dokumentsystemet hämtar meddelandena som väntar** med `GET /v1/notices?status=pending`. Det hämtar namn och adress från parten, väljer mall efter typ och språk, gör dokumentet och skickar det.
4. **Dokumentsystemet rapporterar** med `POST /v1/notices/{id}/deliveries`: att meddelandet skickades, eller att utskicket misslyckades.
5. **En person tar hand om det som fastnar.** `GET /v1/notices?attention=true` visar meddelanden som misslyckats, inte skickats i tid eller saknar en text som lagen kräver.

Samma händelse ger aldrig två meddelanden av samma typ, även om den levereras flera gånger.

**Dokumentsystemet kan få veta direkt** i stället för att fråga. Det prenumererar då på `notice.created` med [webhooks](webhooks.md), och `notice.delivered` och `notice.failed` säger när ett utskick har rapporterats. När Petvold gör dokumentet (`documentMaker: petvold`) säger `notice.document_made` att PDF:en finns i Petvolds arkiv. Läs mer i [Dokument](dokument.md#petvold-gör-breven-automatiskt).

## Typer

| Typ | När | Sista dag | Krävs av (Sverige) |
| --- | --- | --- | --- |
| `policy-confirmation` | En policy tecknas | Tre dagar efter tecknandet | FAL 2 kap. 4 §, distansavtalslagen 3 kap. 11 § |
| `renewal-notice` | En policy förnyas | Den nya termens första dag | FAL 2 kap. 5–6 §§, 3 kap. 5 § |
| `insurer-termination` | Bolaget säger upp policyn (`insurer-term-end`, `insurer-breach` eller `unpaid-premium`) | Dagen bolaget anger att uppsägningen skickades (`receivedOn`) | FAL 3 kap. 3 och 7 §§, 5 kap. 2 § |
| `cancellation-confirmation` | Kunden säger upp, ångrar sig eller behovet faller bort | Tre dagar efter uppsägningen | Ingen lag |
| `application-declined` | En ansökan avslås, av reglerna eller av en person | Tre dagar efter avslaget | FAL 7 kap. 6 § |
| `transfer-offer` | Djuret har sålts, och den nya ägaren erbjuds att ta över policyn (förslaget `transfer`) | Tre dagar efter förslaget | Ingen lag (ADR 0029) |
| `claim-decision` | Ett beslut fattas i ett skadeärende, också vid omprövning | Tre dagar efter beslutet | FAL 7 kap. 1 §, och för ett automatiskt beslut dataskyddsförordningen artikel 22.3 |
| `claim-information-request` | En handläggare begär komplettering av kunden | Tre dagar efter begäran | FAL 7 kap. 1 § |
| `claim-information-reminder` | En öppen begäran till kunden når sin påminnelsedag | Tre dagar efter påminnelsedagen | FAL 7 kap. 1 § |
| `claim-information-expired` | En begäran till kunden går ut utan svar | Tre dagar efter utgången | Ingen lag (ADR 0036) |

- **Tre dagar** är Petvolds tolkning av "snarast", eftersom lagen inte anger något antal dagar. Bolaget kan ändra det i [inställningarna](#bolagets-inställningar).
- **Mottagaren** är försäkringstagaren när beskedet gäller, vid en uppsägning den sista dagen policyn gällde. Vid ett avslag är det den sökande, och vid ett erbjudande den nya ägaren. För en skada är det försäkringstagaren på den första behandlingsdagen.
- **En begäran om komplettering till kliniken** ger inget meddelande. Kliniken är inte kund, och bolaget når den på annat sätt.
- **Språket** är partens språk, annars marknadens, i Sverige svenska.
- **Typer som lagen inte kräver** (`cancellation-confirmation`, `transfer-offer` och `claim-information-expired`) kan stängas av i inställningarna.
- **Skadornas händelser** ger meddelanden från den dag funktionen finns. Beslut och begäranden från tidigare ger inga meddelanden i efterhand.

## Innehållet

Innehållet är fält, inte text. Varje typ har ett schema med versionsnummer, till exempel `renewal-notice.v1`, och dokumentsystemet bygger texten från fälten. Meddelandet har partens och djurets id, inte namn eller adress.

| Schema | Fält |
| --- | --- |
| `policy-confirmation.v1` | `policyId`, `animalId`, `termNo`, `productVersion`, `startDate`, `endDate`, `premium`, `vetCare`, `deductibleOption`, `riders` och `acceptedDocuments` (dokumenten kunden godkände, se [Policyer](policyer.md)) |
| `renewal-notice.v1` | Samma fält om termen som försäkringsbrevet, och `changes` med det som ändrats mot förra termen (`product-version`, `premium`, `vet-care` eller `riders`) och `previous` med förra termens produkt, premie och villkor |
| `insurer-termination.v1` | `policyId`, `animalId`, `reason`, `receivedOn`, `effectiveDate`, `refund`, och bolagets motivering (`grounds`) om den finns. Vid obetald premie också `voidIfPaidBefore`: uppsägningen gäller inte om premien betalas före den dagen (FAL 5 kap. 2 §). |
| `cancellation-confirmation.v1` | `policyId`, `animalId`, `reason`, `receivedOn`, `effectiveDate` och `refund` |
| `application-declined.v1` | `applicationId`, `animalId`, `productVersion`, `reasons` (skälskoderna), `decidedBy` (`rules` eller `person`) och `review`, bolagets text om hur beslutet prövas |
| `transfer-offer.v1` | `policyId`, `animalId`, `proposalId`, `fromPartyId` (den förra ägaren), `from` (dagen den nya ägaren tog över djuret), `deadline` (sista dagen att godkänna) och termens fält som i försäkringsbrevet |
| `claim-decision.v1` | `claimId`, `claimNo`, `policyId`, `animalId`, `decisionId`, `seq`, `outcome`, `payout`, `automated`, `mainReason` och `steps` (nycklar och värden, som i beslutets förklaring), `deviation` när handläggaren gick mot förslaget, `reviewAvailable` (kunden kan begära att en person prövar beslutet) och `review`, bolagets text om hur beslutet prövas |
| `claim-information-request.v1`, `claim-information-reminder.v1` | `claimId`, `claimNo`, `policyId`, `animalId`, `requestId`, `items` (vad som saknas), `note` (handläggarens beskrivning) och `dueDate` (sista dagen att svara) |
| `claim-information-expired.v1` | Samma fält utan `note`, och `decidedOnAvailableBasis`: en handläggare beslutar på det underlag som finns |

Varje typ får också `sender` från inställningarna när bolaget har angett en avsändare. Meddelandet anger vilken version av inställningarna det skapades med (`settingsVersion`).

**Exempel:** Kajsas försäkringsbrev.

```json
{
  "id": "ntc_7f3a…",
  "type": "policy-confirmation",
  "schema": "policy-confirmation.v1",
  "market": "SE",
  "recipientPartyId": "pty_owner004",
  "language": "sv",
  "policyId": "pol_91c2…",
  "source": { "eventId": "pev_…", "eventType": "policy.issued", "occurredAt": "2026-11-16T09:12:04Z" },
  "legalBasis": ["Insurance Contracts Act (2005:104) chapter 2 section 4: written confirmation of the contract, promptly", "…"],
  "dueBy": "2026-11-19",
  "content": {
    "policyId": "pol_91c2…", "animalId": "ani_kajsa", "termNo": 1,
    "productVersion": "SE-HUND-PLUS@2026.1", "startDate": "2026-11-16", "endDate": "2027-11-16",
    "premium": { "amount": 412300, "currency": "SEK" },
    "riders": [{ "description": "…", "diagnosisCodes": ["ORA-OTIT"], "validFrom": "2026-11-16" }],
    "acceptedDocuments": [{ "type": "pre-contract", "language": "sv", "sha256": "704d4d94…" }, { "type": "terms", "language": "sv", "sha256": "c4aa50fc…" }]
  },
  "status": "pending",
  "deliveries": []
}
```

## Utskick

Dokumentsystemet rapporterar varje försök. En rapport ändras aldrig, och den som skickar ett meddelande igen gör en ny rapport.

**Skickat:**

```http
POST /v1/notices/ntc_7f3a…/deliveries
{ "outcome": "sent", "channel": "digital-mailbox", "sentAt": "2026-11-16T14:02:00Z", "documentId": "arch-2026-000123", "sha256": "9b1e…" }
```

- `channel` är `letter`, `email`, `digital-mailbox` eller `customer-portal`.
- `documentId` är dokumentets id i bolagets arkiv, och `sha256` är dokumentets kontrollsumma. Då går det att visa senare exakt vilket dokument kunden fick.
- `sentAt` får inte ligga i framtiden eller före meddelandet skapades.
- **När Petvold gjorde dokumentet** (`documentMaker: petvold`) utelämnas `documentId` och `sha256`. Petvold fyller i sitt dokument. Innan PDF:en finns ger rapporten `409`.

**Misslyckat:**

```http
POST /v1/notices/ntc_7f3a…/deliveries
{ "outcome": "failed", "channel": "letter", "reason": "No postal address" }
```

Skälet får inte innehålla personuppgifter.

**Status och flaggor:**

| Fält | Betyder |
| --- | --- |
| `status: pending` | Inget utskick är rapporterat |
| `status: sent` | Minst ett utskick lyckades |
| `status: failed` | Alla utskick misslyckades |
| `overdue: true` | Inte skickat, och `dueBy` har passerat |
| `late: true` | Det första lyckade utskicket kom efter `dueBy` |
| `incomplete: ["review"]` | Inställningarna saknade en text som lagen kräver när meddelandet skapades, till exempel hur ett avslag prövas |

**Ett sent besked om uppsägning flyttar inte upphörandedagen.** Lagens frister räknas från dagen beskedet skickades. Om bolagets uppsägning skickades efter dagen den räknades från, visar `GET /v1/notices?type=insurer-termination&late=true` den. En person avgör då om upphörandedagen håller, och avslutar eller återkallar uppsägningen i så fall.

## Bolagets inställningar

Bolagets val och texter ligger i en versionerad inställning per marknad (ADR 0032). En ny version ersätter den gamla, och ett meddelande som redan skapats behåller det det skapades med.

| Fält | Betyder | Exempel |
| --- | --- | --- |
| `documentMaker` | Vem som gör dokumenten: `insurer` (förval, bolagets dokumentsystem) eller `petvold` (Petvold gör PDF av skadebesked och försäkringsbrev när meddelandet skapas). `petvold` kräver Gotenberg. | `"petvold"` |
| `promptlyDays` | Dagar som "snarast" ger, 1–30. Utelämnat: Petvolds förval, i Sverige 3. | 5 |
| `disabledTypes` | Typer som lagen inte kräver och som inte ska skapas. En typ som lagen kräver kan inte stängas av. | `["cancellation-confirmation"]` |
| `texts` | Texter per språk: `sender` (avsändaren) och `review` (hur ett beslut prövas). Ett meddelande får texterna på sitt språk, annars på marknadens. | se nedan |

```http
POST /v1/settings/notices/versions
{
  "basedOnVersion": 1,
  "reason": "Svenska texter",
  "markets": {
    "SE": {
      "promptlyDays": 5,
      "texts": {
        "sv": {
          "sender": "Exempelbolaget Försäkring AB",
          "review": "Kontakta i första hand vår klagomålsansvarige. Du kan också vända dig till Konsumenternas försäkringsbyrå eller Allmänna reklamationsnämnden, eller väcka talan i allmän domstol."
        }
      }
    }
  }
}
```

- **Version 1 är tom.** Petvolds lagregler gäller, och bolaget skriver sina egna texter. Petvold skriver inga texter åt bolaget.
- **Utan `review`** blir ett avslag `incomplete` och hamnar i kön. Lagen kräver att avslaget anger hur sökanden får beslutet prövat (FAL 7 kap. 6 §).
- **Skadebeskedet** kräver också `review`. Kunden ska veta hur ett beslut om ersättning prövas, och för ett automatiskt beslut att en person kan pröva det (dataskyddsförordningen artikel 22.3).
- **`basedOnVersion`** måste vara versionen som gäller, annars `409`. Två samtidiga ändringar ger en vinnare.
- **Läsa:** `GET /v1/settings/notices` och `.../versions` med `notices:read`. **Ändra:** `notices:configure`, till exempel rollen `communications-manager`.

## Listor

`GET /v1/notices` kan filtreras på:
- `status` och `type`
- `market`, `policyId`, `applicationId` och `recipientPartyId`
- `attention=true` (misslyckade, försenade och ofullständiga som inte skickats), `overdue=true` och `late=true`

Listan är äldst först och kommer en sida i taget.

## Behörighet

| Roll | Får |
| --- | --- |
| `document-service` | Läsa meddelanden och parter, och rapportera utskick |
| `handler`, `policy-registrar` och `underwriter` | Läsa meddelanden |
| `customer-channel` | Läsa meddelanden om sina egna policyer |
| `communications-manager` | Läsa meddelanden och ändra bolagets inställningar |

En klinik ser inga meddelanden. Se [Behörighet](behorighet.md).

## Exempeldata

Dev-servern skapar meddelanden för exempeldatans policyer och för Sixtens avslagna ansökan. Sixtens avslag är ofullständigt tills bolagets text om prövning finns. Token `dev-documents` är dokumentsystemet, och `dev-communications` kan ändra inställningarna:

```bash
curl -H 'authorization: Bearer dev-documents' 'localhost:8787/v1/notices?status=pending'
```
