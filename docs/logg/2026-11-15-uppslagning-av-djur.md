# Uppslagning av djur för kliniker (PR #35)

**Datum:** 2026-11-15 **ADR:** 0025 (Föreslagen) **Moduler:** `animals`, `api`

## Vad

En klinik kan slå upp ett djur på chipnummer, registreringsnummer eller pass. Den hittar bara djur som är öppna för uppslagning och ser aldrig ägaren.

## Hur det fungerar

1. `GET /v1/animal-lookup?microchip=752098100000001` når `app.ts`. Kontraktet kräver `animals:lookup` (`x-permission`), som rollen `clinic` har i `DEFAULT_ROLES`.
2. API-lagret kräver exakt ett av `microchip`, `registration` och `passport` (`IDENTIFIER_TYPES`), annars `422`.
3. `AnimalService.lookup` normaliserar numret, hittar djuret via `findByIdentifier` och tar bort det om `allowLookup` är `false`. Kvar blir `summaryOf(record)`, som är ren och bara plockar ut djurets uppgifter och id-nummer.
4. API-lagret tar bort djur utanför anroparens marknader. Bindningen till klinik kontrolleras inte, eftersom svaret inte säger något om ägaren.

Flaggan sätts vid `POST /v1/animals` (`allowLookup`, `false` om den saknas) eller ändras med `PUT /v1/animals/{id}`, där den är obligatorisk. Varje ändring blir en revision med motivering, som alla andra uppgifter om djuret.

I databasen är flaggan kolumnen `animals.animal_revision.allow_lookup` (migration 0016). Befintliga rader får `false`, och sedan tas standardvärdet bort så att varje ny revision måste ange den.

## Val och avvägningar

- **Ett eget anrop i stället för att ge kliniken `animals:read`.** `animals:read` ger ägare och historik och kan sökas på ägare. Ett eget anrop med en egen rättighet gör det tydligt i rollinställningen vad en klinik får, och kontraktet beskriver ett svar utan personuppgifter (`AnimalSummary`).
- **Flaggan i revisionen.** Då går det att se vem som öppnade djuret och varför, och den kan inte ändras utan `basedOnRevision`.
- **Stängt från början** (GDPR artikel 25.2). Den som registrerar kan skicka `true` om försäkringsbolaget vill att djur ska vara öppna.
- **Obligatorisk i `PUT`.** En klient som inte känner till flaggan skulle annars stänga djuret varje gång den rättar något.
- **Samma tomma svar för stängt, okänt och fel marknad.** En klinik ska inte kunna se att ett stängt djur finns.
- **Sökvägen `/v1/animal-lookup`** och inte `/v1/animals/lookup`, som skulle krocka med `/v1/animals/{animalId}`.

## Att känna till

- Ingen logg över uppslagningar än.
- En klinik kan prova nummer i följd. Den får bara djurens uppgifter, men antalet anrop bör begränsas i installationens API-gateway.
- Installationer med en sparad rollinställning får inte `animals:lookup` på `clinic` automatiskt. Lokalt lades den till via API:et (version 5).
- En Bella som redan fanns lokalt före migrationen är stängd. Öppna henne med `PUT` eller kör `npm run dev:reset`.

## Filer

- `modules/animals/src/index.ts`: `allowLookup`, `AnimalSummary`, `summaryOf`, `AnimalService.lookup`
- `modules/animals/src/postgres.ts`
- `db/migrations/0016_animals_lookup.sql`
- `modules/api/src/app.ts`, `modules/api/src/permissions.ts`, `modules/api/openapi.yaml`
- `modules/api/test/animals.test.ts`, `modules/animals/test/animal-service.test.ts`
