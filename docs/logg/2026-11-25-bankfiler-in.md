# Pengar, steg 7a: bankfiler in (PR #166)

**Datum:** 2026-11-25 **ADR:** 0040 punkt 12, 0017, 0018 **Moduler:** `payments`, `api`, `apps/backoffice`

## Vad
Bankens avisering av inbetalningar, ISO 20022 `camt.054`, läses in. Det görs av en person under **Pengar** eller av en integration med `POST /v1/payment-files`. Inbetalningarna går samma väg som från låtsasbanken: `payment.succeeded`, och sedan kopplas de till fakturan med OCR eller RF.

## Hur det fungerar
1. **`modules/payments/src/bank-file.ts`:**
   - `parseCamt054` är ren. Den går igenom `Ntfctn` → `Ntry` → `NtryDtls/TxDtls` och tar varje bokförd insättning (`CRDT`, `BOOK`).
   - Kontot (`Acct/Id/IBAN` eller `Othr/Id`) ska vara ett av bolagets. Det jämförs utan mellanslag och bindestreck.
   - Beloppet tas från transaktionen (`Amt` eller `AmtDtls/TxAmt/Amt`), annars från posten. Det räknas om till minsta enhet med `minorUnits`, som vägrar fler decimaler än valutan har.
   - Referensen är den första `RmtInf/Strd/CdtrRefInf/Ref`.
   - Inbetalningens id är `AcctSvcrRef`. Därför ger samma fil två gånger inga dubbletter.
2. **`BankFileProvider`** har `uploadOnly`. `PaymentsService.receive`, som den öppna vägen för aviseringar använder, vägrar en sådan adapter. Bara `importFile` når den.
3. **`importFile`** läser filen och sparar `PaymentFile`: kontrollsumma, storlek, vem, när, antal nya och redan kända, och de nya inbetalningarnas id. Migration 0068 gör tabellen, bara insert.
4. **API:t** har `POST /v1/payment-files` (multipart, delen `file`, högst 10 MB, idempotent) och `GET /v1/payment-files`. Rättigheten är `payments:import`. `billing-clerk` och den nya rollen `bank-file-job` har den.
5. **Back office** har fliken **Bankfiler** under Pengar, med uppladdning och listan.
6. **Installationen** ställer in kontona med `PETVOLD_BANK_FILE_ACCOUNTS`. Dev-servern har det påhittade bankgirot `5050-1055`.

## Val och avvägningar
- **`fast-xml-parser` 5.12.0** (MIT, publicerad 2026-11-03), installerad med `--before`, så att också dess sju beroenden (MIT) är minst två veckor gamla. En egen XML-tolk hade varit mer kod att granska för säkerhet än ett känt bibliotek.
- **`processEntities: false`.** Entiteter i en `DOCTYPE` expanderas inte. Ett test visar att en egen entitet blir kvar som text och därmed ingen referens. Det skyddar mot "billion laughs" och liknande angrepp.
- **Hela filen eller ingenting**, som för aviseringar. En fil som delvis lästs in är svårare att rätta än en som avvisats.
- **Multipart och inte rå XML i kroppen**, på samma sätt som dokumenten. Kontraktet beskriver det redan, och back office laddar upp på samma sätt.
- **Filerna själva sparas inte**, bara kontrollsumman. Banken har originalet, och en fil med personuppgifter i Petvold hade krävt gallring.

## Att känna till
- **Testfilerna** i `modules/payments/test/files/` är påhittade och följer meddelandedefinitionen på iso20022.org. Ingen bank har prövat dem. En verklig bank kan lägga referensen i andra fält, till exempel bara `Ustrd`. Då hamnar inbetalningen bland de okopplade.
- **Uttag (`DBIT`) i filen** läses inte än. De blir bankens bekräftelse på utbetalningar i steg 7b.

## Filer
- `modules/payments/src/bank-file.ts`, `index.ts`, `postgres.ts`, `test/bank-file.test.ts`, `test/files/`, `test-suites/payments-store.ts`
- `modules/api/src/app.ts`, `permissions.ts`, `composition.ts`, `server.ts`, `dev-server.ts`, `openapi.yaml`, `test/payment-files.test.ts`
- `apps/backoffice/src/views/money-view.ts`, `money-logic.ts`, `e2e/bank-files.spec.ts`
- `db/migrations/0068_payments_files.sql`
