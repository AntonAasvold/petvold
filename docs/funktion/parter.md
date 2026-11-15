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

## Radering och begränsning (ADR 0028)

Personuppgifter tas bort genom att parten **anonymiseras**. Namn, födelsedatum, kontaktuppgifter, adress, språk och motiveringar tas bort i alla revisioner, och personnummer och organisationsnummer tas bort. Id:t, sorten och marknaden finns kvar, så att djurens ägarskap, försäkringar och beslut fortfarande hänger ihop. Det går inte att ångra.

1. **Någon begär anonymisering:** `POST /v1/parties/{id}/erasure-requests` med `basis` och `reason`. `basis` är `subject-request` om personen själv har bett om det, eller `retention-expired` om lagringstiden har gått ut. En part kan bara ha en obesvarad begäran.
2. **Någon annan godkänner:** `POST /v1/erasure-requests/{id}/approvals`. Den som begärde får inte godkänna (`403`). Parten anonymiseras i samma ögonblick.
3. **Eller avslår:** `POST /v1/erasure-requests/{id}/rejections` med `reason`. Om personen själv bad om radering men uppgifterna måste sparas, till exempel för ett skadeärende inom tioårsgränsen, anges `restrictUntil`. Parten är då **begränsad** till och med det datumet: den syns inte vid sökning och ger `404` för alla utom den som har `parties:privacy`. Ett djur kan inte heller få en begränsad eller anonymiserad part som ny ägare.

`GET /v1/erasure-requests?status=pending` visar obesvarade begäranden, äldst först.

Motiveringarna får inte innehålla personuppgifter. De sparas för att visa vad som hänt.

**Exempel:** Anna ber om att bli raderad. `dev-privacy` registrerar begäran, och `dev-privacy-2` ser att Anna inte har några försäkringar eller skador kvar och godkänner. `GET /v1/parties/{id}` visar sedan bara `"anonymized": true`, id, sort och marknad.

## Lagringstid och gallring (ADR 0028)

**Lagringstiden** anges per marknad som ett antal hela år efter partens sista relation. Petvold föreslår tio år för Sverige, eftersom den som vill ha försäkringsersättning har tio år på sig att väcka talan (försäkringsavtalslagen 7 kap. 4 §). Det täcker också bokföringslagens sju år. Försäkringsbolaget ansvarar för värdena. En marknad utan regel gallras aldrig automatiskt.

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `GET /v1/retention-settings` | `parties:privacy` | Gällande lagringstider |
| `GET /v1/retention-settings/versions` | `parties:privacy` | Alla versioner |
| `POST /v1/retention-settings/versions` | `parties:erase` | Ny version med `basedOnVersion`, `markets` och `reason` |
| `POST /v1/retention-runs` | `parties:retention` | Gallringskörning. Med `"dryRun": true` visas bara vilka parter som skulle beröras. |

**Sista relationen** är det senaste av:
- när parten själv senast ändrades
- när partens senaste ägarskap av ett djur slutade

Om parten äger ett djur i dag, eller har en annan pågående relation, gallras den inte. Policymodulen (M3) kommer att rapportera försäkringar och skador på samma sätt.

**Gallringskörningen** går igenom alla parter i anroparens marknader. För varje part vars lagringstid har gått ut skapas en begäran om anonymisering med `basis: retention-expired`. En dataskyddsansvarig godkänner eller avslår varje begäran, precis som när någon själv har bett om radering. Körningen är tänkt att schemaläggas med rollen `retention-job`, till exempel en gång i veckan.

**Exempel:** Anna sålde sin sista hund 1 juni 2015. Med tio år går lagringstiden ut 1 juni 2025. Nästa körning skapar en begäran, och `dev-privacy` godkänner den.

**Efter en återställning från säkerhetskopia** körs `npm run erasures:reapply` innan systemet öppnas. Det kör alla godkända anonymiseringar igen, i ordning, och går att köra flera gånger.

## Vem ser vad

- `party-registrar` registrerar och ändrar, till exempel kundservice.
- `handler`, `approver` och `animal-registrar` kan läsa.
- `privacy-officer` registrerar, godkänner och avslår begäranden om radering, ser begränsade parter, ändrar lagringstider och kan köra gallring. Det krävs två personer för att anonymisera.
- `retention-job` får bara köra gallringen.
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
| Ändring av en anonymiserad part | `409` |
| Godkännande av sin egen begäran om radering | `403` |
| En begäran som redan är besvarad | `409` |

## Lokalt

Dev-servern registrerar Bellas ägare `pty_owner001` (Anna Example) utan personnummer. Tokens `dev-privacy` och `dev-privacy-2` är två dataskyddsansvariga, så att fyra ögon går att prova. `dev-retention-job` kör gallringen. Token `dev-registrar` får registrera och ändra parter i Sverige. Testerna använder personnummer födda 2099, som ingen levande person kan ha.

*Inte byggt än:* kundens åtkomst till sin egen part, kontaktpersoner för organisationer, och relationer från policyer och skador i gallringen (M3).
