# Parter

Parter är de personer och organisationer som andra delar pekar på, till exempel ägaren till ett djur. Beslutet bakom finns i ADR 0026.

## Vad en part har

| Fält | Betyder | Ändras |
| --- | --- | --- |
| `id` | Petvolds id, till exempel `pty_owner001` | Aldrig |
| `kind` | `person` eller `organization` | Aldrig |
| `market` | Marknaden parten hör till. Styr vem som ser parten. | Aldrig |
| `givenName`, `familyName`, `birthDate` | Personens namn och födelsedatum | Med motivering |
| `name` | Organisationens namn | Med motivering |
| `email`, `phone`, `address`, `language` | Kontaktuppgifter. Telefon i internationellt format (`+46…`), språk som `sv`. | Med motivering |
| `identifiers` | Personnummer och organisationsnummer, med land | Läggs till, tas aldrig bort |

## Så fungerar det

- **Historik.** Varje ändring blir en ny revision med vem, när och varför. En ändring ersätter alla uppgifter, så en uppgift som utelämnas tas bort i den nya revisionen.
- **Id-nummer är unika per land.** Samma personnummer kan bara höra till en part.
- **Svenska nummer kontrolleras.** Personnummer anges med 12 siffror (`ÅÅÅÅMMDD-NNNK`), och datum och kontrollsiffra måste stämma. Samordningsnummer godtas. Organisationsnummer har 10 siffror och kontrollsiffra. För andra länder kontrolleras bara att numret består av bokstäver och siffror.
- **Personnummer visas aldrig.** Alla svar visar `19850312-****` och `masked: true`. Organisationsnummer visas.
- **Sökning sker i anropets innehåll.** `POST /v1/party-searches` med numret i innehållet, så att numret inte hamnar i adresser och loggar.
- **Roller finns där relationen finns.** Att Anna äger Bella står i djurregistret, och att hon är försäkringstagare kommer att stå på policyn.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/party-searches` | `parties:read` | Hittar en part på personnummer eller organisationsnummer |
| `POST /v1/parties` | `parties:write` | Registrerar en person eller organisation |
| `GET /v1/parties/{id}` | `parties:read` | Parten med id-nummer |
| `PUT /v1/parties/{id}` | `parties:write` | Ändrar uppgifterna, med `basedOnRevision` och `reason` |
| `GET /v1/parties/{id}/revisions` | `parties:read` | Alla revisioner, äldst först |
| `POST /v1/parties/{id}/identifiers` | `parties:write` | Lägger till ett personnummer eller organisationsnummer |

## Exempel

**Registrera Anna:**

```http
POST /v1/parties
{
  "kind": "person", "market": "SE", "givenName": "Anna", "familyName": "Exempel",
  "email": "anna@example.test", "phone": "+46 70 000 00 00",
  "address": { "street": "Exempelgatan 1", "postalCode": "111 22", "city": "Stockholm", "country": "SE" },
  "language": "sv",
  "identifiers": [{ "type": "personal-number", "country": "SE", "value": "20990101-1230" }]
}
```

Svaret har `"value": "20990101-****"` och `"masked": true`. Numret är fött 2099, så det kan inte tillhöra någon riktig person.

**Kundservice söker när Anna ringer:** `POST /v1/party-searches` med `{ "type": "personal-number", "country": "SE", "value": "209901011230" }`. Svaret är `{ "items": [ … ] }`, eller en tom lista.

**Anna flyttar:** `PUT /v1/parties/{id}` med alla uppgifter, den nya adressen, `"basedOnRevision": 1` och `"reason": "Flytt"`.

**En kennel:** `{ "kind": "organization", "market": "SE", "name": "Kennel Exempel", "identifiers": [{ "type": "organization-number", "country": "SE", "value": "556000-0000" }] }`. Numret i exemplet är bara ett formexempel.

## Vem ser vad

- `party-registrar` registrerar och ändrar, till exempel kundservice.
- `handler`, `approver` och `animal-registrar` kan läsa.
- Alla ser bara parter i sina egna marknader. En part i en annan marknad ger `404`.
- Roller som är bundna till klinik eller försäkringar ser inga parter.

## Spärrar

| Fall | Svar |
| --- | --- |
| Personnumret eller organisationsnumret finns på en annan part | `409` |
| Någon har ändrat parten sedan `basedOnRevision` | `409` |
| Fel kontrollsiffra, ogiltigt datum, eller fel antal siffror | `422` |
| Personnummer på en organisation, eller organisationsnummer på en person | `422` |
| `name` på en person, eller `givenName` på en organisation | `422` |
| Telefon utan landsnummer, eller ogiltig e-post | `422` |

## Lokalt

Dev-servern registrerar Bellas ägare `pty_owner001` (Anna Example) utan personnummer. Token `dev-registrar` får registrera och ändra parter i Sverige. Testerna använder personnummer födda 2099, som ingen levande person kan ha.

*Inte byggt än:* kontroll i djurregistret att ägaren finns, kundens åtkomst till sin egen part, kontaktpersoner för organisationer, och gallring och anonymisering (GDPR artikel 17).
