# Bolagets inställningar för meddelanden och erbjudande om överlåtelse (PR #71)

**Datum:** 2026-11-16 **ADR:** 0032, 0029 **Moduler:** communications, policies, api

## Vad
Bolaget kan ställa in sina meddelanden per marknad:
- hur många dagar "snarast" ger
- vilka typer som lagen inte kräver och som inte ska skapas
- texter per språk, nämligen avsändaren och hur ett beslut prövas

Ett avslag som saknar text om prövning blir ofullständigt och hamnar i kön. Den nya ägaren till ett sålt djur får ett erbjudande om att ta över policyn. Det är sista delen av ADR 0032, utom skadebesked.

## Hur det fungerar
1. **Inställningarna** (`modules/communications/src/index.ts`) är versioner med `NoticeSettingsStore`, byggt som gallringens inställning i `parties`.
   - `settings()` lägger in version 1 första gången. Den har en tom inställning per marknad som har regler.
   - `changeSettings` kräver versionen som gäller och kontrollerar varje fält. En typ som lagen kräver kan inte stängas av.
2. **När ett meddelande skapas** läser `handlePolicyEvent` inställningen som gäller.
   - En avstängd typ ger inget meddelande.
   - Dagar för "snarast" tas från inställningen, annars från `NOTICE_RULES`.
   - Texterna väljs på meddelandets språk, annars på marknadens. `sender` och de texter som `REQUIRED_TEXTS` anger för typen kopieras till innehållet.
   - Versionen sparas i `settingsVersion`.
3. **`viewOf`** räknar `incomplete` från innehållet. Kön (`attention`) tar med ofullständiga meddelanden som inte har skickats.
4. **Förslaget** (`modules/policies/src/index.ts`): `handleAnimalEvent` skickar händelsen `proposal.created` till `PolicyStore.addProposal(p, events)`. I Postgres sparas förslaget och händelsen i samma transaktion, och händelsen bara om förslaget är nytt.
5. **Erbjudandet:** meddelandemodulen läser förslaget via `PolicySource.proposal`. `policySource` i `wiring.ts` ger bara förslag om överlåtelse. Mottagaren är den nya ägaren, och innehållet har termen som gäller dagen ägarbytet sker.

## Val och avvägningar
- **Texterna kopieras till meddelandet** i stället för att läsas när det skickas. Ett meddelande visar då vad det sades, även om bolaget senare ändrar texten.
- **Petvold skriver inga texter åt bolaget.** Version 1 är tom, och ett avslag utan text om prövning syns i kön i stället för att skickas med en text som bolaget inte har godkänt. Exemplet i dokumentationen nämner Konsumenternas försäkringsbyrå och Allmänna reklamationsnämnden, men det är bolaget som skriver texten.
- **Hela inställningen ersätts vid ändring**, som för gallringen. En marknad som utelämnas får Petvolds förval.
- **`transfer-offer` krävs inte av lagen** och kan stängas av, till exempel om bolaget ringer den nya ägaren i stället.
- **Ändringen av inställningen kontrollerar inte anroparens marknader**, precis som gallringens inställning. Rollen ges till dem som får ändra för alla marknader.

## Att känna till
- Migration 0032 lägger till `settings_version` utan värde för meddelanden som redan finns. De saknar `settingsVersion` i svaret, och kontraktet tillåter det.
- `PolicyStore.addProposal` tar nu händelser som andra argument.
- `npm run roles:sync -- --apply` lägger till rollen `communications-manager`.

## Filer
- `modules/communications/src/index.ts`, `src/postgres.ts`, `test/`, `test-suites/notice-store.ts`, `test-db/notice-store.test.ts`
- `modules/policies/src/index.ts`, `src/postgres.ts`, `test-suites/policy-store.ts`
- `db/migrations/0032_communications_settings.sql`, `db/test/claims-schema.test.ts`
- `modules/api/src/app.ts`, `composition.ts`, `wiring.ts`, `permissions.ts`, `dev-server.ts`, `openapi.yaml`, `test/notices.test.ts`, `test/composition.test.ts`
- `docs/funktion/meddelanden.md`, `behorighet.md`, `policyer.md`, `docs/teknik/arkitektur.md`
