# Djurregister

Registret håller ordning på de försäkrade djuren: vad djuret är, hur det identifieras och vem som äger det vid en viss tidpunkt. Beslutet bakom finns i ADR 0024.

## Vad ett djur har

| Fält | Betyder | Ändras |
| --- | --- | --- |
| `id` | Petvolds id, till exempel `ani_bella` | Aldrig |
| `market` | Marknaden djuret är registrerat i. Styr vem som ser djuret. | Aldrig |
| `species` | Art ur [referensdatan](referensdata.md), till exempel `dog` | Aldrig |
| `breed` | Ras ur referensdatan. Den måste höra till arten. Kan utelämnas om rasen är okänd. | Med motivering |
| `sex`, `neutered` | Kön ur referensdatan, och om djuret är kastrerat | Med motivering |
| `name`, `birthDate` | Namn och födelsedatum | Med motivering |
| `deceasedOn` | Dödsdatum | Med motivering |
| `identifiers` | Chip, registreringsnummer och pass | Läggs till, tas aldrig bort |
| `ownerships` | Ägare med giltighetstid | Ägarbyte |

## Så fungerar det

- **Historik.** Varje ändring av uppgifterna blir en ny revision med vem, när och varför. `GET .../revisions` visar alla.
- **Id-nummer är unika.** Ett chipnummer kan bara höra till ett djur. Chipnummer har 15 siffror. Mellanslag och bindestreck tas bort, så `752 098 100 000 001` och `752098100000001` är samma nummer.
- **Ägarskap har giltighetstid.** Ett ägarbyte från 1 juni avslutar det gällande ägarskapet 1 juni, och den nya ägaren gäller från samma dag. Det blir aldrig glapp eller överlapp.
- **Ägare är parter**, till exempel `pty_owner001`. Partmodulen, som ska hålla personer och organisationer, är inte byggd än.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/animals` | `animals:write` | Registrerar ett djur med id-nummer och första ägare |
| `GET /v1/animals?microchip=…` | `animals:read` | Söker på chip. Det går också att söka med `registration`, `passport` eller `ownerPartyId` (djur som parten äger i dag), men bara med ett filter i taget. |
| `GET /v1/animals/{id}` | `animals:read` | Djuret med id-nummer och alla ägare |
| `PUT /v1/animals/{id}` | `animals:write` | Rättar eller ändrar uppgifter, med `basedOnRevision` och `reason` |
| `GET /v1/animals/{id}/revisions` | `animals:read` | Alla revisioner, äldst först |
| `POST /v1/animals/{id}/identifiers` | `animals:write` | Lägger till ett id-nummer |
| `POST /v1/animals/{id}/ownerships` | `animals:write` | Ny ägare från ett datum |

## Exempel

**Registrera Rex:**

```http
POST /v1/animals
{
  "market": "SE", "species": "dog", "breed": "dog-beagle", "sex": "male",
  "name": "Rex", "birthDate": "2024-03-01",
  "identifiers": [{ "type": "microchip", "value": "752098100000042" }],
  "owner": { "partyId": "pty_anna", "from": "2024-05-01" }
}
```

**Rex kastreras:** `PUT /v1/animals/{id}` med alla uppgifter, `"neutered": true`, `"basedOnRevision": 1` och `"reason": "Kastrerad"`. Svaret har `revision: 2`.

**Rex säljs 1 juni:** `POST /v1/animals/{id}/ownerships` med `{ "partyId": "pty_bo", "from": "2026-06-01", "reason": "Såld" }`. Anna ägde Rex till och med 31 maj. Bo äger honom från 1 juni.

## Vem ser vad

- `animal-registrar` registrerar och ändrar. Det kan till exempel vara försäkringsbolagets kundservice eller säljkanal.
- `handler` och `approver` kan läsa.
- Alla ser bara djur i sina egna marknader. Ett djur i en annan marknad ger `404`.
- **Roller som är bundna till klinik eller försäkringar ser inga djur.** Registret kan inte avgöra vilka djur som hör till en viss klinik eller försäkring. Kliniker kan alltså inte slå upp djur på chipnummer än. Det kräver ett eget beslut om vad en klinik får se om ägaren.

## Spärrar

| Fall | Svar |
| --- | --- |
| Chipnumret finns på ett annat djur | `409` |
| Någon har ändrat djuret sedan `basedOnRevision` | `409` |
| Ras som inte hör till arten, eller en avaktiverad kod | `422` |
| Födelsedatum i framtiden, eller första ägare före födelsedatumet | `422` |
| Dödsdatum i framtiden eller före födelsedatumet | `422` |
| Ny ägare samma dag som eller före den gällande, eller efter dödsdatumet | `422` |
| Samma ägare igen | `409` |

## Lokalt

Dev-servern registrerar Bella (`ani_bella`, labrador, chip `752098100000001`, ägare `pty_owner001`) första gången. Token `dev-registrar` får registrera och ändra djur i Sverige.

*Inte byggt än:* kullar, händelser vid ägarbyte och dödsfall (M3), och kontroll av att parten finns (partmodulen).
