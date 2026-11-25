# Pengar, steg 7b: bankfiler ut (PR #NN)

**Datum:** 2026-11-25 **ADR:** 0040 punkt 8, 11 och 12 **Moduler:** `payments`, `api`, `apps/backoffice`

## Vad
Utbetalningar kan gå till banken som `pain.001.001.03`. Bankens `camt.054` bekräftar dem som betalda eller returnerade. Filen görs och hämtas under **Pengar** eller av en integration.

## Hur det fungerar
1. **`BankFileProvider` betalar ut** när `debtorName` är inställt.
   - `payout` svarar `pending`, så utbetalningen väntar som skickad.
   - `payoutFile` gör filen med `buildPain001`, som är ren.
2. **`PaymentsService.makePayoutFile`** samlar de skickade utbetalningarna för adaptern, marknaden och valutan som inte finns i någon fil. Varje mottagares konto tas från utbetalningens senaste steg och namnet från porten `payeeNames`. Filen sparas som `PayoutFile` med innehåll och kontrollsumma, i migration 0069.
3. **`parseCamt054` läser också uttag och returer:**
   - Ett bokfört uttag med en `EndToEndId` blir `PayoutConfirmation` med utfallet `paid`.
   - En transaktion med `RtrInf` blir `failed` med orsakskoden.
   - Andra uttag är inte Petvolds.
4. **`receiveWith`** skickar bekräftelserna till `confirm`. Den flyttar bara en skickad utbetalning hos samma adapter, och en upprepning ändrar inget. `settle` skriver steget och `payout.paid` eller `payout.failed`, på samma sätt som `send` gör för en adapter som svarar direkt.
5. **`erasePayee`** tömmer också filerna med utbetalningar till parten. En trigger tillåter bara att innehållet töms, en gång.
6. **API:t:**
   - `POST /v1/payout-files` och `GET /v1/payout-files/{id}/file` kräver den nya rättigheten `payments:export`.
   - `GET /v1/payout-files` kräver `payments:read`.
7. **Back office:** kortet **Utbetalningsfiler** under Bankfiler gör en ny fil och hämtar den.

## Val och avvägningar
- **En egen rättighet för filerna ut.** De innehåller namn och kontonummer. Den som får läsa in bankens avisering behöver inte kunna hämta dem.
- **Filen sparas i stället för att göras om.** Betaluppgifter och namn kan ändras eller raderas, och då hade samma fil inte gått att göra igen. Därför töms den vid radering i stället.
- **Namnet hämtas när filen görs**, genom en port till partsmodulen. `payments` sparar inga namn.
- **409 utan väntande utbetalningar** har ett eget besked i back office. Det generella beskedet för 409 säger att någon annan har ändrat något, och det stämmer inte här.

## Att känna till
- **`EndToEndId` får vara 35 tecken.** Den första versionen tillät 31 och missade därför verkliga id med 32 tecken. API-testet hittade felet, och nu finns ett enhetstest med ett verkligt id.
- **Ingen bank har prövat filerna.** Bankernas tillämpningsanvisningar kan kräva till exempel `PmtTpInf`, `ChrgBr` eller BIC för avsändaren.
- **En klinik** står med sitt id som namn tills kliniker har namn i Petvold.
- **Dev-servern betalar ut med låtsasbanken**, eftersom den kommer först. Bankfilens utbetalningar prövas i testerna.

## Filer
- `modules/payments/src/bank-file.ts`, `index.ts`, `postgres.ts`, `test/bank-file.test.ts`, `test-suites/payments-store.ts`, `test-db/payments-store.test.ts`
- `modules/api/src/app.ts`, `permissions.ts`, `composition.ts`, `server.ts`, `openapi.yaml`, `test/payout-files.test.ts`
- `apps/backoffice/src/views/money-view.ts`, `e2e/bank-files.spec.ts`
- `db/migrations/0069_payments_payout_files.sql`
