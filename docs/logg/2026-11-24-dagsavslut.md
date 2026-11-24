# Pengar, steg 6b: dagsavslut och kontoplan (PR #153)

**Datum:** 2026-11-24 **ADR:** 0040 **Moduler:** `accounting`, `api`, `webhooks`

## Vad
Varje dag stängs och lämnas till bolagets ekonomisystem som en CSV-fil och händelsen `accounting.day_closed`. Kontoplanen översätter Petvolds kontoslag till bolagets kontonummer, och den har versioner.

## Hur det fungerar
1. **Körningen `accounting.day-close`** (06:00) anropar `AccountingService.closeDays`. Den stänger dag för dag, från dagen efter den senast stängda, eller den första med en verifikation, till och med i går.
2. **`store.closeDay`** tar ett lås per marknad. Det kontrollerar att dagen är nästa att stänga och läser dagens verifikationer. Sedan sparar den stängningen och händelsen i samma transaktion.
3. **`store.add`** tar samma lås. Är verifikationens dag redan stängd bokförs den på första öppna dag, och dess egen dag sparas som `eventDate`. Numret tas ur serien för bokföringsdagens år.
4. **Stängningen sparar** summorna (`dayTotals`), kontoplanens version och SHA-256 av filen (`dayCsv`). `dayFile` gör filen igen av verifikationerna och versionen, och kontrollerar den mot summan.

## Val och avvägningar
- **Filen sparas inte, den görs igen.** Verifikationerna och kontoplanens versioner ändras aldrig, så samma fil kan alltid göras igen. Kontrollsumman visar att den blev densamma. Det slipper ett arkiv för filer, och en ny version av kontoplanen påverkar inte en stängd dag.
- **Låset per marknad** gör att en verifikation aldrig hamnar i en dag som just stängts. `pg_advisory_xact_lock` kräver inga rättigheter att ändra rader.
- **Varje dag stängs, också tomma.** Då syns att ingen dag hoppats över, och `accounting.day_closed` kommer varje dag.
- **CSV med komma och decimalpunkt** (RFC 4180) går att läsa in i alla ekonomisystem. SIE 4 kommer när en installation behöver det, som ADR:en säger.
- **Konventionen för API:t** fick `{market}` och `{day}` som naturliga nycklar, och filen heter `/file` i stället för `.csv`.

## Att känna till
- Perioder som stängs för hand, med `accounting:close`, finns inte än. En stängd dag är redan oföränderlig.
- Saknar kontoplanen ett kontoslag står slaget i filen, och stängningen listar det i `unmapped`.
- I demon stängs varje dag av nattens körningar, eftersom testdatan kör schemaläggaren dag för dag.

## Filer
- `modules/accounting/src/close.ts`, `index.ts` och `postgres.ts`, och `db/migrations/0065_accounting_day_close.sql`
- `modules/api/src/jobs.ts`, `app.ts`, `composition.ts`, `permissions.ts` och `conventions.ts`
- `modules/accounting/test/day-close.test.ts` och `modules/api/test/accounting.test.ts`
