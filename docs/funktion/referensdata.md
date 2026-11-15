# Referensdata

Kodlistor som annan data pekar på: arter, raser och kön. Försäkringsbolaget äger listorna och översätter dem till sina språk. Beslutet bakom finns i ADR 0022.

## Sorter

| Sort | Exempel på kod | Förälder |
| --- | --- | --- |
| `species` (art) | `dog`, `cat`, `horse` | – |
| `breed` (ras) | `dog-labrador-retriever`, `cat-maine-coon` | En art, till exempel `dog` |
| `sex` (kön) | `male`, `female` | – |

## Så fungerar det

- **Koden ändras aldrig.** Andra data sparar bara koden. Koden består av små bokstäver, siffror och bindestreck.
- **En kod tas aldrig bort.** En kod som inte ska användas längre avaktiveras med `active: false`. Den går fortfarande att läsa, så att gamla djur och policyer visas rätt, men den bör inte erbjudas för nya.
- **Etiketter per språk.** `labels` innehåller texten per språktagg, till exempel `{ "en": "Dog", "sv": "Hund", "de-CH": "Hund" }`. Svaret har också `label` på anroparens språk (`Accept-Language`). Finns inte språket används engelska, och annars det första språket i bokstavsordning.
- **En ras tillhör en art.** Arten anges när rasen skapas och ändras aldrig. En ras kan bara skapas under en aktiv art.
- **Historik.** Varje ändring blir en ny revision med vem, när och varför. Inget skrivs över.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `GET /v1/reference-data/{sort}` | `catalog:read` | Alla koder av sorten. `?parent=dog` ger raserna för hund. `?active=true` ger bara aktiva. |
| `GET /v1/reference-data/{sort}/{kod}` | `catalog:read` | En kod |
| `GET /v1/reference-data/{sort}/{kod}/revisions` | `catalog:read` | Alla revisioner, äldst först |
| `PUT /v1/reference-data/{sort}/{kod}` | `catalog:write` | Skapar koden eller sparar en ny revision |

`catalog:read` finns i nästan alla standardroller, eftersom kliniker, kundkanaler och handläggare behöver listorna. `catalog:write` finns bara i `catalog-manager`.

## Exempel

**Skapa en ras:**

```http
PUT /v1/reference-data/breed/dog-beagle
{ "parent": "dog", "labels": { "en": "Beagle", "sv": "Beagle" } }
```

Svaret är `201` med `revision: 1`.

**Lägga till norska:** hämta koden, och skicka sedan hela etikettlistan med gällande revision och en motivering:

```http
PUT /v1/reference-data/breed/dog-beagle
{ "labels": { "en": "Beagle", "sv": "Beagle", "nb": "Beagle" }, "basedOnRevision": 1, "reason": "Norsk lansering" }
```

Svaret är `200` med `revision: 2`.

**Avveckla en ras:** samma anrop med `"active": false`.

## Spärrar

| Fall | Svar |
| --- | --- |
| Någon annan har sparat en revision sedan `basedOnRevision` | `409`. Inget skrivs över. |
| `basedOnRevision` saknas för en kod som redan finns | `409` |
| Samma ändring skickas igen, till exempel efter ett nätverksfel | `200` med den sparade revisionen. Ingen ny revision skapas. |
| Ändring utan motivering | `422` |
| Ras utan art, eller under en art som inte finns eller är avaktiverad | `422` |
| Försök att flytta en ras till en annan art | `422`. Avaktivera rasen och skapa en ny kod. |
| Okänd sort, till exempel `colour` | `404` |

## Lokalt

Dev-servern läser in exempeldata från `modules/catalog/seed/reference-data.json` första gången: tre arter, två kön och åtta raser, på engelska och svenska. Token `dev-catalog` får ändra dem.

En installation läser in sina egna listor via API:et, till exempel en raslista byggd på FCI:s publika nomenklatur.

*Inte byggt än:* fler sorter (diagnoskoder, fakturakategorier). En ny sort kräver en migration.
