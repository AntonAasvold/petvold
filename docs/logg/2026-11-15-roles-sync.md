# Nya standardroller till en sparad rollinställning (PR #44)

**Datum:** 2026-11-15 **ADR:** 0020 **Moduler:** `api`

## Vad

`npm run roles:sync` lägger till nya standardroller och standardrättigheter i en installation som redan har en sparad rollinställning. Ändringen sparas som en ny version med motivering.

## Hur det fungerar

1. Skriptet `modules/api/scripts/sync-roles.ts` läser den senaste versionen ur `access.role_config` med `ACCESS_DATABASE_URL`.
2. `syncWithDefaults(current)` i `permissions.ts` jämför med `DEFAULT_ROLES`:
   - En roll som saknas läggs till som den är.
   - En roll med samma namn får de standardrättigheter den saknar, sist i listan.
   - Övriga roller, bindningar och beloppsgränser rörs inte.
3. Skriptet skriver ut tilläggen. Utan `--apply` slutar det där.
4. Med `--apply` sparas resultatet via `AccessService.change`, med `changedBy: roles-sync`, en motivering som räknar upp tilläggen och `basedOnVersion`. Samma validering och versionskontroll gäller som i API:et.

## Val och avvägningar

- **Visa först, spara med `--apply`.** En standardrättighet som installationen medvetet har tagit bort skulle annars komma tillbaka utan att någon ser det.
- **Bara tillägg.** En borttagning ur standardrollerna i en ny version av Petvold sprids inte. Det kräver ett eget beslut i varje installation.
- **Ett skript mot databasen, inte ett API-anrop.** Det körs vid uppgradering av den som driftar installationen, inte av en administratör i ett gränssnitt. `callerRoles` är tom, så regeln om att inte ändra sina egna roller blir inte aktuell.

## Att känna till

- Utan sparad inställning gör skriptet ingenting, eftersom version 1 skapas från standardrollerna vid start.
- Det ersätter skriptet jag använde lokalt i arbetsmappen (version 4–8). Lokalt är inställningen redan uppdaterad.
- Provat mot testdatabasen: version 1 med bara `handler` och `admin` fick de saknade rollerna som version 2, och en andra körning svarade att allt redan är uppdaterat.

## Filer

- `modules/api/src/permissions.ts` (`syncWithDefaults`), `modules/api/scripts/sync-roles.ts`
- `modules/api/test/permissions.test.ts`
