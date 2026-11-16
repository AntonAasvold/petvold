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

En prenumeration anger typer som `*` (alla), en grupp (`policy.*`) eller en enskild typ (`application.declined`).

*Inte byggt än:* skador, djur och kundmeddelanden, och ett kontrakt för händelserna i AsyncAPI (steg 2). Död post, att skicka igen och att stänga av en prenumeration automatiskt (steg 3).

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
- **Ingen ordning lovas.** Mottagaren sorterar på `time` om ordningen spelar roll.

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

`GET /v1/webhook-subscriptions/{id}/deliveries?status=dead` visar händelser som inte kom fram, med senaste svar och fel.

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
| `GET .../{id}/deliveries` | `webhooks:read` | Utskicken, med status och försök |

- **Marknaderna** ska ligga inom anroparens. Bara den som har alla marknader får ange `*`.
- **Rollen** `integration-admin` har båda rättigheterna.

**Exempel:** dokumentsystemet vill veta när en ansökan avslås.

```http
POST /v1/webhook-subscriptions
{ "url": "https://docs.example.com/petvold", "eventTypes": ["application.declined"], "markets": ["SE"], "description": "Dokumentsystemet" }
```

## Lokalt

Token `dev-integration` hanterar prenumerationer. Dev-servern tillåter `http://localhost` som adress, så en mottagare på den egna datorn kan ta emot händelserna. Dev-servern använder en fast nyckel för hemligheterna, som aldrig får användas i drift.
