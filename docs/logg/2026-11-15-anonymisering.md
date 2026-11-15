# Anonymisering och begränsning av parter (PR #42)

**Datum:** 2026-11-15 **ADR:** 0028 **Moduler:** `parties`, `api`

## Vad

En dataskyddsansvarig kan begära att en part anonymiseras, och en annan godkänner. Personuppgifterna försvinner ur hela historiken, men part-id:t finns kvar. En begäran från personen själv som måste avslås gör parten begränsad till ett datum.

## Hur det fungerar

1. `POST /v1/parties/{id}/erasure-requests` går till `PartyService.requestErasure`. Den sparar en `ErasureRequest` med partens marknad, för omfånget. `addErasureRequest` skriver bara om parten inte redan har en obesvarad begäran (`insert … where not exists`).
2. `POST /v1/erasure-requests/{id}/approvals` går till `approveErasure`. Den kontrollerar att begäran är obesvarad och att godkännaren är en annan person, och anropar sedan `PartyStore.decideErasure`.
3. `PostgresPartyStore.decideErasure` gör två saker i en transaktion:
   - Den lägger in beslutet i `erasure_decision`. En trigger stoppar den som begärde.
   - Den kör `select parties.anonymize(party_id)`. Funktionen är `security definer` och ägs av migreringsrollen. Den kontrollerar att det finns ett godkänt beslut, tömmer personfälten i alla revisioner, sätter `anonymized = true` och tar bort id-numren.
4. `toParty` läser `anonymized`. `get` räknar fram `restrictedUntil` från avslagen.
5. I API-lagret ser `seesParty` till att en begränsad part bara syns för den som har `parties:privacy`. `PartyService.marketOf` svarar `null` för begränsade och anonymiserade parter, så djurregistret kan inte peka nya ägarskap på dem.

`anonymize(party)` är också en ren funktion i TypeScript, som minneslagringen och testerna använder. Fälten den tar bort står i `PERSONAL_FIELDS`.

## Val och avvägningar

- **Funktion i databasen i stället för uppdateringsrätt.** Tjänsterollen får fortfarande inte ändra historik. Ett fel i koden eller ett stulet lösenord räcker inte för att anonymisera någon utan ett sparat, godkänt beslut.
- **Fyra ögon både i tjänsten och i databasen.** Tjänsten ger `403` med ett tydligt fel. Triggern stoppar även anrop som inte går via tjänsten.
- **Motiveringar i revisionerna tas också bort.** De är fritext och kan innehålla adresser, till exempel "Flytt till …".
- **Begränsning som ett datum på avslaget**, inte en egen tabell. Den följer direkt av beslutet och kan inte glömmas bort.
- **Avslag kräver inte fyra ögon.** Ett avslag tar inte bort något.

## Att känna till

- Motiveringen i en begäran om radering sparas för alltid. Den får inte innehålla personuppgifter, och det står i kontraktet.
- Migrationen går inte att backa om det finns anonymiserade parter, eftersom de gamla constraints kräver namn. Det är avsiktligt.
- Inte byggt än: lagringstider per marknad, `lastActivity` i andra moduler, gallringsjobbet, och att köra anonymiseringarna igen efter en återställning.

## Filer

- `modules/parties/src/index.ts` (`requestErasure`, `approveErasure`, `rejectErasure`, `anonymize`, `restrictedOn`), `modules/parties/src/postgres.ts`
- `db/migrations/0019_parties_erasure.sql`
- `modules/api/src/app.ts`, `modules/api/src/permissions.ts`, `modules/api/openapi.yaml`
- `modules/parties/test/`, `modules/parties/test-suites/party-store.ts`, `modules/parties/test-db/`, `modules/api/test/parties.test.ts`
