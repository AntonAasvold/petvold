# Skadenummer och id från servern (PR #93)

**Datum:** 2026-11-18 **ADR:** 0036 **Moduler:** claims-core, claims-store-memory, claims-store-postgres, api, apps/backoffice

## Vad
Steg 1 i skadeprocessen. Petvold ger ett ärende id och skadenummer när klienten inte skickar dem. Skadenumret är till exempel `S-2026-000123`: marknadens prefix, året och nästa nummer i årets serie. Back office väljer inte längre egna nummer.

## Hur det fungerar
1. **Kontraktet:** `id` och `claimNo` är inte längre obligatoriska i `ClaimFields`. `Claim` (det som sparats) kräver dem och har dem som egna fält, annars blev de valfria i typerna som openapi-typescript genererar.
2. **Porten:** `ClaimsStore` har `nextClaimNumber(year)` och `claimNoTaken(claimNo)`.
   - **Postgres:** tabellen `claims.claim_number_series` (migration 0036) med en rad per år. Nästa nummer tas med `insert … on conflict do update … returning`, som är atomiskt utan lås.
   - **Minnet:** en räknare per år.
   - **Den gemensamma testsviten** provar båda, också tio samtidiga anrop.
3. **Skademotorn:** `registerClaim` tar `NewClaim`, där id och nummer är valfria.
   - **Id och nummer ges före bedömningen.** Ärendet ingår i underlaget, och `inputHash` ska stämma med det som sparas.
   - **Året** räknas med `marketDate`, i marknadens tidszon.
   - **Ett nummer som en klient redan tagit** hoppas över.
   - **Ett eget nummer som redan används** ger `409`.
4. **Inställningen:** `PETVOLD_CLAIM_NUMBER_PREFIX` (`SE=S,NO=N`) läses av `claimNumberPrefixFromEnv` i `composition.ts`. Ett felaktigt värde stoppar starten. Förvalet är `S`.
5. **Förhandsbedömningen** får id `clm_preview` och tar inget nummer ur serien.

## Val och avvägningar
- **En serie för hela installationen och inte per marknad.** Två marknader kan då aldrig få samma nummer, inte heller om de har samma prefix. Numret blir lite mindre "eget" per marknad, men det är enklare att hålla unikt.
- **Prefixet i miljön och inte i en inställning i API:t.** Det sätts en gång när bolaget installerar Petvold och ändras sällan. Ett byte påverkar bara nya nummer. Behövs det i API:t kan det flyttas till en inställning med historik, som gallringens.
- **`claimNoTaken` före `saveClaim` och inget nytt försök efter en krock.** Serien ger aldrig samma nummer två gånger. Bara en klient som samtidigt väljer exakt det nästa numret kan krocka, och den får `409` från den unika nyckeln.
- **Gotenberg i roadmapen.** Dokumentskapandet planeras nu med Gotenberg (MIT) i stället för Carbone, eftersom Carbones licens begränsar hur Carbone får köras.

## Att känna till
- **Testet för migreringar** i `db/test/claims-schema.test.ts` listar varje migration och behöver en ny rad för varje ny migration.
- **Den lokala databasen** behöver `npm run db:migrate` för migration 0036.
- **Back office** skickar samma idempotensnyckel tills registreringen gått igenom. Det id som servern ger kommer från svaret.

## Filer
- `modules/api/openapi.yaml`, `src/composition.ts`, `src/server.ts`, `test/api.test.ts`, `test/composition.test.ts`
- `modules/claims-core/src/types.ts`, `src/ports.ts`, `src/service.ts`, `test/claim-numbers.test.ts` (ny), `test-suites/claims-store.ts`
- `modules/claims-store-memory/src/index.ts`, `modules/claims-store-postgres/src/index.ts`, `test-db/claims-store.test.ts`
- `db/migrations/0036_claims_number_series.sql` (ny), `db/test/claims-schema.test.ts`
- `apps/backoffice/src/claim-form.ts`, `src/views/claim-register.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `test/claim-form.test.ts`, `e2e/register.spec.ts`
- `docs/funktion/skadereglering.md`, `docs/funktion/backoffice.md`, `docs/teknik/arkitektur.md`, `docs/teknik/drift.md`, `docs/roadmap.md`
