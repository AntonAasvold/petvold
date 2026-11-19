# Reläet bakom ett lån (PR #98)

**Datum:** 2026-11-19 **ADR:** 0037 **Moduler:** scheduling, api

## Vad
Steg 2 i ADR 0037:
- **En server i taget är reläet.** Tidigare körde varje server sitt eget relä, så samma händelse kunde levereras av två servrar och ordningen inom en outbox kunde brytas.
- **Döda poster sparas** och finns kvar efter en omstart.

## Hur det fungerar
1. **`RelayState`** i `relay.ts` är det reläet behöver: lån och döda poster. `SchedulingStore` uppfyller det, så reläet beror inte på modulen `scheduling` mer än genom typen.
2. **Varje runda börjar med `lead`.** Den tar eller förnyar lånet `relay` i 30 sekunder. Utan lånet levererar servern inget den rundan. Första gången den får lånet läser den in de döda posterna, så att den inte försöker dem igen på egen hand efter en omstart.
3. **En död post** sparas med källa, händelse, antal försök, senaste fel och tid. Själva händelsen sparas inte, eftersom den finns kvar i outboxen.
4. **`retryDeadLetter`** glömmer posten i minnet och i databasen, och nästa runda försöker från början. Back office använder den i steg 3.
5. **`stop`** släpper lånet direkt, så att en annan server tar över utan att vänta 30 sekunder.

## Val och avvägningar
- **Ett lån för hela reläet, inte ett per outbox.** Det är enklast och håller ordningen. En server räcker för volymerna i en installation per bolag. Behövs mer kan lånet delas per källa.
- **Försöken räknas i minnet.** Byter reläet server börjar räkningen om. Det ger några fler försök, men ingen händelse försvinner.
- **Utan `state`,** som i tester och i äldre kod, fungerar reläet som förut med allt i minnet.

## Att känna till
- **Avsnittet om körningar i `drift.md`** sa fortfarande att en schemaläggare utanför Petvold behövs. Det var inaktuellt sedan #97 och är rättat här.
- **`/healthz`** har `relay: 'leading'` eller `'standby'`, så att man ser vilken server som levererar.

## Filer
- `modules/api/src/relay.ts`, `src/composition.ts`, `src/server.ts`, `test/relay.test.ts`
- `modules/scheduling/src/index.ts`, `src/postgres.ts`, `test-suites/scheduling-store.ts`, `test-db/scheduling-store.test.ts`
- `db/migrations/0039_scheduling_relay.sql` (ny), `db/test/claims-schema.test.ts`
- `docs/funktion/korningar.md`, `docs/teknik/drift.md`, `docs/teknik/arkitektur.md`, `docs/roadmap.md`
