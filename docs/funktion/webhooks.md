# Webhooks

Bolagets system kan få veta när något händer i Petvold, utan att fråga. En prenumeration anger en adress och vilka händelser den vill ha. Petvold skickar varje händelse dit, signerad, och försöker igen om mottagaren inte svarar. Beslutet bakom finns i ADR 0033.

## Så fungerar det

1. **Bolaget skapar en prenumeration** med `POST /v1/webhook-subscriptions`, med adress, händelsetyper och marknader. Svaret innehåller en hemlighet. Den visas bara här.
2. **Något händer i Petvold**, till exempel att en policy tecknas. Reläet lägger händelsen i en kö för varje prenumeration som vill ha den.
3. **Petvold skickar händelsen** som en CloudEvent till adressen, med en signatur i rubrikerna.
4. **Mottagaren kontrollerar signaturen** och svarar `2xx`. Annars försöker Petvold igen.

## Händelser

| Grupp | Typer | `subject` |
| --- | --- | --- |
| Policyer | `policy.issued`, `policy.changed`, `policy.renewed`, `policy.transferred`, `policy.cancelled`, `policy.reinstated` | policyns id |
| Ansökningar | `application.received`, `application.accepted`, `application.referred`, `application.declined`, `application.withdrawn`, `application.expired` | ansökans id |
| Förslag | `proposal.created`: överlåtelse till en ny ägare, eller avslut när djuret dött | policyns id |
| Skador | `claim.registered`, `claim.decision_proposed`, `claim.proposal_returned`, `claim.decided`, `claim.payout_ordered`, `claim.review_requested`, `claim.withdrawn`, `claim.dismissed`, `claim.corrected`, `claim.attachment_added`, `claim.information_requested`, `claim.information_reminded`, `claim.information_received`, `claim.information_expired`, `claim.information_cancelled` | skadans id |
| Djur | `animal.ownership_changed`, `animal.died` | djurets id |
| Kundmeddelanden | `notice.created`, `notice.document_made`, `notice.delivered`, `notice.failed` | meddelandets id |
| Fakturor | `invoice.issued`: nummer, konto, part, datum, belopp, valuta, betalningsreferens och policyer. `invoice.credited`: kreditnotans id och nummer, konto, part, belopp, valuta och policyhändelsen den kom av (ADR 0040) | fakturans id |
| Inbetalningar | `payment.succeeded`: riktning, adapter, belopp, valuta, betalningsreferens och bokföringsdag (ADR 0017). Inget om betalaren. | inbetalningens id |
| Körningar | `job.failed`: körning, startsätt och start, aldrig felet (ADR 0037) | körningens id |

En prenumeration anger typer som `*` (alla), en grupp (`policy.*`) eller en enskild typ (`application.declined`).

**Kontraktet för händelserna** är [`asyncapi.yaml`](../../modules/api/asyncapi.yaml) (AsyncAPI 3.0). Det har fälten i `data` för varje typ och vilka som alltid finns. `npm run lint:openapi` stoppar om kontraktet och listan över vilka fält som får gå ut skiljer sig åt.

Några exempel på vad som stannar i Petvold:
- vem som beslutade eller gjorde något
- kundens egna ord i en begäran om prövning
- skälet i texten vid ett ägarbyte
- bedömningen bakom ett skadebeslut

Mottagaren hämtar sådant med API:t om den har rätt till det.

## Hur en händelse ser ut

```http
POST https://crm.example.com/petvold
content-type: application/cloudevents+json
webhook-id: pev_8c1f…
webhook-timestamp: 1794816000
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

{
  "specversion": "1.0",
  "id": "pev_8c1f…",
  "source": "/petvold/policies",
  "type": "petvold.policy.issued.v1",
  "subject": "pol_91c2…",
  "time": "2026-11-16T09:12:04Z",
  "datacontenttype": "application/json",
  "market": "SE",
  "sequence": "00000000000000000412",
  "data": {
    "policyId": "pol_91c2…", "transactionId": "ptx_…", "animalId": "ani_kajsa",
    "policyholderPartyId": "pty_owner004", "productVersion": "SE-HUND-PLUS@2026.1",
    "startDate": "2026-11-16", "endDate": "2027-11-16",
    "premium": { "amount": 412300, "currency": "SEK" }
  }
}
```

- **Tunna händelser.** `data` har id:n och fält som inte är personuppgifter. Det kan vara status, belopp, datum och skälskoder. Det är aldrig namn, adresser, anteckningar eller vem som gjorde något. Mottagaren hämtar resten med API:t och sin egen token, så samma behörighet gäller som annars.
- **Versionerade typer.** En ändring som bryter mot innehållet blir en ny typ, till exempel `.v2`.
- **`id` är samma vid varje försök.** Mottagaren använder det för att känna igen en händelse som kommer två gånger.
- **Ingen ordning lovas.** Mottagaren sorterar om ordningen spelar roll:
  - **`sequence`** (tillägg i CloudEvents) är händelsens plats i modulens outbox. Det ökar per `source` och är utfyllt med nollor till 20 siffror, så att det sorterar rätt som text. Ett glapp betyder inte att en händelse saknas, eftersom en transaktion som rullats tillbaka lämnar ett.
  - **`time`** sorterar mellan moduler.
  - `job.failed` kommer inte från någon outbox och har ingen `sequence`.
- **Belopp i skadebeslut.** `payout` i `claim.decided` är skadans hela ersättning efter beslutet, inte förändringen. En höjning jämfört med förra beslutet ger `claim.payout_ordered` med skillnaden.

## Signaturen

Signaturen följer Standard Webhooks. Det finns bibliotek för mottagaren i flera språk.

1. Ta `webhook-id`, `webhook-timestamp` och kroppen exakt som den kom, och sätt ihop dem med punkter: `id.tidsstämpel.kropp`.
2. Räkna HMAC-SHA256 med hemligheten. Hemligheten är det som står efter `whsec_`, avkodat från base64.
3. Jämför med värdet efter `v1,` i `webhook-signature`. Rubriken kan ha flera signaturer, separerade med mellanslag, och en räcker.
4. Vägra en tidsstämpel som ligger mer än fem minuter fel. Det skyddar mot att någon spelar upp ett gammalt anrop.

**Byta hemlighet:** `POST /v1/webhook-subscriptions/{id}/secret-rotations` ger en ny hemlighet. Den gamla signerar också i 24 timmar, så att mottagaren hinner byta utan att tappa händelser.

## Försök och fel

| Mottagaren svarar | Petvold |
| --- | --- |
| `2xx` | Levererad |
| `410 Gone` | Stänger av prenumerationen. Inget skickas förrän en person aktiverar den igen. |
| Annat, eller inget svar inom 15 sekunder | Försöker igen efter 5 sekunder, 5 minuter, 30 minuter, 2 timmar, 5 timmar, 10 timmar och sedan var 24:e timme, med lite slumpad spridning |
| Inget lyckat svar på tre dygn | Händelsen blir `dead` |
| Inget lyckat svar alls på fem dygn | Stänger av prenumerationen, med skälet i `disabledReason` |

**Händelser som inte kom fram:**
- **Listan:** `GET /v1/webhook-deliveries?status=dead` visar döda händelser för alla prenumerationer inom anroparens marknader, med senaste svar och fel. `failingSince` på prenumerationen visar sedan när allt har misslyckats.
- **Skicka igen:** `POST /v1/webhook-subscriptions/{id}/deliveries/{deliveryId}/retries` skickar en död händelse igen. `POST /v1/webhook-subscriptions/{id}/delivery-retries` skickar alla döda för prenumerationen, till exempel när mottagaren har varit nere i flera dagar. Varje händelse får tre nya dygn.
- **Aktivera igen:** en avstängd prenumeration aktiveras med `PUT` och `status: active`. Händelser som väntade skickas då.

**Gallring:** 30 dagar efter att en händelse levererades eller gavs upp tas innehållet bort (`prunedAt`, och `event.data` blir tomt). Tid, svar och antal försök finns kvar som bevis. En händelse vars innehåll är borttaget kan inte skickas igen.

**Säkerhet:**
- Adressen måste använda `https`.
- Den får inte peka på ett lokalt eller privat nät, varken när prenumerationen skapas eller när adressen slås upp vid utskicket.
- Omdirigeringar följs inte.
- Hemligheten sparas krypterad med installationens nyckel.

## Prenumerationer

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/webhook-subscriptions` | `webhooks:manage` | Skapar en prenumeration och ger hemligheten |
| `GET /v1/webhook-subscriptions`, `.../{id}` | `webhooks:read` | Listar och visar, utan hemligheter |
| `PUT /v1/webhook-subscriptions/{id}` | `webhooks:manage` | Ändrar adress, typer, marknader eller status, med `basedOnRevision` |
| `POST .../{id}/secret-rotations` | `webhooks:manage` | Ny hemlighet |
| `GET .../{id}/deliveries` | `webhooks:read` | Utskicken för prenumerationen, med status och försök |
| `GET /v1/webhook-deliveries` | `webhooks:read` | Utskick för alla prenumerationer, till exempel `status=dead` |
| `POST .../{id}/deliveries/{deliveryId}/retries`, `POST .../{id}/delivery-retries` | `webhooks:manage` | Skicka döda händelser igen |

- **Marknaderna** ska ligga inom anroparens. Bara den som har alla marknader får ange `*`.
- **Rollen** `integration-admin` har båda rättigheterna.

**Exempel:** dokumentsystemet vill veta när en ansökan avslås.

```http
POST /v1/webhook-subscriptions
{ "url": "https://docs.example.com/petvold", "eventTypes": ["application.declined"], "markets": ["SE"], "description": "Dokumentsystemet" }
```

## Lokalt

Token `dev-integration` hanterar prenumerationer. Dev-servern tillåter `http://localhost` som adress, så en mottagare på den egna datorn kan ta emot händelserna. Dev-servern använder en fast nyckel för hemligheterna, som aldrig får användas i drift.
