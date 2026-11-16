# Djurregister

Registret håller ordning på de försäkrade djuren: vad djuret är, hur det identifieras och vem som äger det vid en viss tidpunkt. Besluten bakom finns i ADR 0024, ADR 0025 (uppslagning) och ADR 0027 (kullar).

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
| `allowLookup` | Om djuret kan slås upp, till exempel av en klinik. Stängt om inget anges. | Med motivering |
| `identifiers` | Chip, registreringsnummer och pass | Läggs till, tas aldrig bort |
| `ownerships` | Ägare med giltighetstid | Ägarbyte |
| `litterId` | Kullen djuret föddes i, om det registrerades med en kull | Aldrig |

## Så fungerar det

- **Historik.** Varje ändring av uppgifterna blir en ny revision med vem, när och varför. `GET .../revisions` visar alla.
- **Id-nummer är unika.** Ett chipnummer kan bara höra till ett djur. Chipnummer har 15 siffror. Mellanslag och bindestreck tas bort, så `752 098 100 000 001` och `752098100000001` är samma nummer.
- **Ägarskap har giltighetstid.** Ett ägarbyte från 1 juni avslutar det gällande ägarskapet 1 juni, och den nya ägaren gäller från samma dag. Det blir aldrig glapp eller överlapp.
- **Ägare är [parter](parter.md)**, till exempel `pty_owner001`. Ägaren måste finnas och höra till samma marknad som djuret, både vid registrering och vid ägarbyte (ADR 0026).

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
| `POST /v1/litters` | `animals:write` | Registrerar en kull med alla djur, ägda av uppfödaren från födelsedatumet |
| `GET /v1/litters/{id}` | `animals:read` | Kullen med föräldrar, uppfödare och djur |
| `GET /v1/animal-summaries?microchip=…` | `animals:lookup` | Slår upp ett djur som är öppet för uppslagning. Visar inga ägare. Det går också att använda `registration` eller `passport`. |

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

**Ägaren låter kliniker hitta Rex:** `PUT /v1/animals/{id}` med alla uppgifter, `"allowLookup": true` och `"reason": "Ägaren godkänner uppslagning"`.

**Kliniken läser chipet:** `GET /v1/animal-summaries?microchip=752098100000042` ger

```json
{ "items": [{ "id": "ani_…", "market": "SE", "species": "dog", "breed": "dog-beagle", "sex": "male",
  "neutered": true, "name": "Rex", "birthDate": "2024-03-01",
  "identifiers": [{ "type": "microchip", "value": "752098100000042" }] }] }
```

Om Rex är stängd, inte finns eller finns i en annan marknad blir svaret `{ "items": [] }`.

**Kennel Exempel registrerar en kull:**

```http
POST /v1/litters
{
  "market": "SE", "species": "dog", "birthDate": "2026-09-01",
  "damId": "ani_…", "sireId": "ani_…", "breederPartyId": "pty_kennel",
  "animals": [
    { "name": "Valp 1", "sex": "female" },
    { "name": "Valp 2", "sex": "male", "identifiers": [{ "type": "microchip", "value": "752098100000043" }] }
  ]
}
```

Båda valparna ägs av kenneln från 1 september. Om båda föräldrarna är beaglar blir valparna det också. Varje valp har `litterId`, och den säljs med ett vanligt ägarbyte.

**Rex säljs 1 juni:** `POST /v1/animals/{id}/ownerships` med `{ "partyId": "pty_bo", "from": "2026-06-01", "reason": "Såld" }`. Anna ägde Rex till och med 31 maj. Bo äger honom från 1 juni.

## Vem ser vad

- `animal-registrar` registrerar och ändrar. Det kan till exempel vara försäkringsbolagets kundservice eller säljkanal.
- `handler` och `approver` kan läsa.
- Alla ser bara djur i sina egna marknader. Ett djur i en annan marknad ger `404`.
- **Roller som är bundna till klinik eller försäkringar ser inga hela djur.** Registret kan inte avgöra vilka djur som hör till en viss klinik eller försäkring, och ett helt djur visar ägaren.
- **Kliniker slår upp djur** med `GET /v1/animal-summaries` (rättigheten `animals:lookup`, som rollen `clinic` har). De hittar bara djur som är öppna (`allowLookup`) och i klinikens marknader, och ser aldrig ägare eller historik. Det går inte att söka på ägare. Se ADR 0025.

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
| En kull utan djur eller med fler än 24, en mor som inte är hona, en förälder av annan art eller född efter kullen | `422` |
| Ägaren finns inte, eller hör till en annan marknad | `422` |

## Lokalt

Dev-servern registrerar Bella (`ani_bella`, labrador, chip `752098100000001`, ägare `pty_owner001`, öppen för uppslagning) första gången. Token `dev-clinic` kan slå upp henne. Token `dev-registrar` får registrera och ändra djur i Sverige.

## Händelser

Ett ägarbyte ger händelsen `animal.ownership_changed`, med förra och nya ägaren och dagen. En rättelse som sätter ett nytt dödsdatum ger `animal.died`. Händelserna skrivs i samma transaktion som ändringen (ADR 0008). Policymodulen gör om dem till förslag om överlåtelse och avslut (se [Policyer](policyer.md#när-djuret-säljs-eller-dör)).

*Inte byggt än:* en logg över vem som slagit upp ett djur, att lägga till ett djur i en kull i efterhand, och en ägare som flyttar till ett annat land.
