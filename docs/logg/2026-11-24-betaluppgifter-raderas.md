# Betaluppgifter raderas med parten (PR #NN)

**Datum:** 2026-11-24 **ADR:** 0040 punkt 11, 0028, 0001 **Moduler:** `payments`, `parties`, `api`

## Vad
När en begäran om radering godkänns raderas också partens betaluppgifter i `payments`. Raderingen stoppas medan en utbetalning till parten är på väg. Efter en återställning från säkerhetskopia raderar `npm run erasures:reapply` betaluppgifterna igen.

## Hur det fungerar
1. **`PartyDeps.erasureHooks`** är en lista med `ErasureHook`, där varje krok har `name`, `blocker` och `erase`.
   - `approveErasure` frågar först varje krok om något står i vägen. Svarar någon blir det `409`, och då ändras ingenting.
   - Sedan körs `erase` på varje krok, och sist anonymiseras parten.
   - Ordningen gör att inga personuppgifter blir kvar om anonymiseringen skulle fallera. `erase` går att köra flera gånger.
2. **`composition.ts`** skapar listan innan partsmodulen byggs och lägger till kroken för `payments` när `payments` finns. Partsmodulen läser aldrig andra modulers tabeller (ADR 0001).
3. **`PaymentsService`:**
   - `erasureBlocker` säger nej medan en utbetalning är spärrad eller skickad utan svar.
   - `erasePayee` raderar kontonumren genom `PaymentsStore.erasePayeeAccounts`.
   - Läsningarna hoppar över raderade uppgifter. Partens nästa utbetalning väntar därför på nya uppgifter.
4. **Migration 0066:**
   - `erased_at` på `payments.payee_account`.
   - En kontroll att raderade uppgifter är tomma.
   - Rätt att uppdatera de två kolumnerna.
   - Triggern `payee_account_erase_only`, som bara tillåter en radering, en gång.
5. **`reapply-erasures.ts`** flyttades från `parties/scripts` till `api/scripts`. Skriptet behöver båda modulerna, och partsmodulen ska inte bero på `payments`.

## Val och avvägningar
- **Raderna sparas, bara numren tas bort.** Utbetalningens steg pekar på kontot, och utbetalningen är räkenskapsinformation som sparas i sju år.
- **En utbetalning som väntar på uppgifter stoppar inte raderingen.** Det finns inget nummer att radera. Ordern väntar kvar och kan betalas till nya uppgifter.
- **Krokar i stället för en händelse från partsmodulen.** Med en händelse hade raderingen hänt senare och utan möjlighet att säga nej. Här kan `payments` stoppa ett godkännande medan pengar är på väg.
- **En trigger i stället för bara rätten att uppdatera.** Rätten gäller hela kolumnen. Testet för databasen visade att den annars hade tillåtit att ett nummer byttes ut.

## Att känna till
- **Gallring av betaluppgifter som inte använts på några år** (ADR 0040, punkt 11) är inte byggd. Bara radering med parten finns.
- **Klinikers betaluppgifter** raderas inte här. En klinik är inte en part.

## Filer
- `modules/payments/src/index.ts`, `postgres.ts`, `test/payouts.test.ts`, `test-suites/payments-store.ts`, `test-db/payments-store.test.ts`
- `modules/parties/src/index.ts`, `test/party-service.test.ts`
- `modules/api/src/composition.ts`, `scripts/reapply-erasures.ts`
- `db/migrations/0066_payments_payee_erasure.sql`
