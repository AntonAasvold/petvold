# Återkallelse och avvisning av skador (PR #94)

**Datum:** 2026-11-18 **ADR:** 0036 **Moduler:** claims-core, claims-store-memory, claims-store-postgres, api, webhooks, apps/backoffice

## Vad
Steg 2 i skadeprocessen. Ett ärende kan stängas utan beslut på två sätt:
- **Återkallad:** kunden drar tillbaka anmälan.
- **Avvisad:** dubblett, registrerad av misstag eller inte en skada.

Båda går bara före ett beslut, och ingen av dem går att ångra.

## Hur det fungerar
1. **Kärnan:** `ClaimClosure` och två nya lägen, `withdrawn` och `dismissed`. `CLAIM_STATES` är listan som API:t kontrollerar filtret mot, så att kontraktet och koden har samma lägen.
2. **Tjänsten:** `withdraw` och `dismiss` går genom `close`:
   - kontrollerar skälet och att ärendet varken är stängt eller beslutat
   - bygger journalen som löser upp reserven
   - skickar öppna förslag tillbaka med skälet
   - skriver allt i en transaktion med `closeClaim`

   `decide` vägrar ett stängt ärende.
3. **Lagringen:**
   - **Postgres:** `claims.claim_closure` (migration 0037). Två triggrar med egna felkoder, `PVC01` (stängt) och `PVC02` (beslutat), som lagringen gör till `StoreConflictError`. Funktionen som kontrollerar vad en journal pekar på godkänner nu också ett avslut.
   - **Minnet:** samma regler i koden.
   - **Den gemensamma testsviten** provar båda.
4. **Läget** räknas fortfarande fram, nu med avslutet först. Gallringen räknar ett stängt ärende som avslutat, och tiden för avslutet som den senaste aktiviteten.
5. **Händelser:** `claim.withdrawn` och `claim.dismissed` i AsyncAPI och webhook-katalogen. Motiveringen tas inte med, eftersom fri text kan innehålla personuppgifter. Ett förslag som skickas tillbaka ger också `claim.proposal_returned`.
6. **Back office:**
   - kortet "Stäng utan beslut", med valkort, skälkod och dubblettens id
   - ett kort för det stängda ärendet i stället för beslutet
   - händelsen i historiken
   - flikarna Återkallade och Avvisade i kön

## Val och avvägningar
- **Egna felkoder från triggrarna.** Lagringen kan då skilja ett stängt ärende från andra fel utan att tolka texten.
- **Avvisning kräver `claims:decide`, återkallelse `claims:register`.** En avvisning stänger ärendet utan prövning och är ett beslut om handläggningen. En återkallelse förmedlar kundens vilja. Det betyder att en klinik, som har `claims:register`, kan återkalla en skada den själv anmält. Omfånget begränsar det till klinikens egna ärenden.
- **Dubbletten pekas ut med id.** Handläggaren ser skadenumret, men id:t är entydigt och kan inte ändras. Back office visar ett exempel i tipset.
- **Det stängda kortet ersätter beslutskortet.** Beräkningen och bedömningen visas fortfarande till vänster, som underlag för varför ärendet stängdes.

## Att känna till
- **Den lokala databasen:** migration 0037 rullades tillbaka och kördes igen under arbetet, när triggern för journaler behövde ändras. Den som redan kört den första versionen behöver göra samma sak: `npx dbmate rollback` och sedan `npm run db:migrate`. Den versionen fanns aldrig på main.
- **Databastesterna:** varje `truncate` av `claims.claim` måste ha med `claims.claim_closure`, eftersom den pekar på ärendet.
- **Komponentens äldre stil för `dl`** i `claim-actions.ts` gäller nu bara listor utan `pv-dl`. Annars bröt den designsystemets listor.

## Filer
- `modules/claims-core/src/types.ts`, `src/ports.ts`, `src/service.ts`, `test/closure.test.ts` (ny), `test-suites/claims-store.ts`
- `modules/claims-store-memory/src/index.ts`, `modules/claims-store-postgres/src/index.ts`, `test-db/claims-store.test.ts`, `test-db/service.test.ts`
- `db/migrations/0037_claims_closure.sql` (ny), `db/test/claims-schema.test.ts`
- `modules/api/openapi.yaml`, `asyncapi.yaml`, `src/app.ts`, `src/wiring.ts`, `test/api.test.ts`, `modules/webhooks/src/index.ts`
- `apps/backoffice/src/decide.ts`, `src/history.ts`, `src/components/claim-actions.ts`, `src/views/claim-detail.ts`, `src/views/claims-queue.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `src/api/schema.d.ts`, `test/decide.test.ts`, `test/waterfall.test.ts`, `e2e/register.spec.ts`
- `docs/funktion/skadereglering.md`, `docs/funktion/behorighet.md`, `docs/funktion/webhooks.md`, `docs/funktion/backoffice.md`, `docs/teknik/arkitektur.md`, `docs/teknik/backoffice.md`
