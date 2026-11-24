# Pengar, steg 8d: bokföringen i back office (PR #NN)

**Datum:** 2026-11-24 **ADR:** 0040, 0035, 0020 **Moduler:** `apps/backoffice`, `accounting`, `api`

## Vad
- **Bokföring** i menyn har fyra flikar:
  - **Dagsavslut:** med summor, kontrollsumma och fil
  - **Saldon**
  - **Verifikationer:** med raderna
  - **Kontoplan:** med versioner
- **Rättat:** det första dagsavslutet kunde hoppa över en dag.
- **`dev-all`** har nu alla roller.

## Hur det fungerar
1. `src/accounting-logic.ts` är ren och testad:
   - `ACCOUNT_KINDS`
   - `withAccount`, som sätter, ändrar eller tar bort ett konto i en ny karta
   - `chartProblems`, som följer kontraktets mönster för nummer och namn
   - `unmappedKinds`, `balanced` och `dayFileName`
2. `src/views/accounting-view.ts` (`<pv-accounting>`, `/accounting`):
   - Flikarna läser `GET /v1/day-closes`, `/v1/account-balances`, `/v1/verifications` och `/v1/settings/chart-of-accounts` (med versionerna), filtrerat på marknad och period.
   - Filen hämtas med `parseAs: 'text'` och sparas som en `Blob`. Länken till filen kräver token, så en vanlig `<a href>` går inte.
   - Kontoplanen sparas med `basedOnVersion`, så två samtidiga ändringar ger `409`.
3. Menyposten ligger efter **Pengar** och kräver `accounting:read`.

## Felet i dagsavslutet
`closeDays` tog den första verifikationen i nummerordning som startdag när ingen dag ännu var stängd. Testet i webbläsaren hittade felet:
- Exempeldatan bokför i dag.
- En inbetalning med gårdagens bokföringsdag får därför ett högre nummer.
- Startdagen blev i dag, och gårdagen stängdes aldrig.

Samma sak kan hända i drift: en bankfil för i går som kommer efter dagens första händelse, innan den första stängningen. Nu börjar den första stängningen vid den tidigaste bokföringsdagen. Ett enhetstest i `day-close.test.ts` fallerar utan rättelsen.

## Val och avvägningar
- **Kontoplanen redigeras som en tabell per marknad**, och sparas för alla marknader på en gång som en ny version. Det är så API:t tar den.
- **Ingen egen sida för en verifikation.** Raderna får plats i kortet till höger, och redovisningen söker sällan efter en enskild verifikation.
- **`dev-all` får `billing-manager` och `accountant`.** Den ska ha alla roller som back office använder, och utan dem gick det inte att läsa bokföringen med den.

## Att känna till
- **Återkrav som kö** finns inte än. API:t har inget förslag till återkrav, som är en öppen fråga i ADR 0040. Det står kvar i färdplanen.
- **Testet i webbläsaren** bokför en inbetalning i går via låtsasbanken innan körningen, så att det finns en dag att stänga.

## Filer
- `apps/backoffice/src/accounting-logic.ts`, `views/accounting-view.ts`
- `apps/backoffice/test/accounting-logic.test.ts`, `e2e/accounting.spec.ts`
- `modules/accounting/src/index.ts`, `test/day-close.test.ts`
- `modules/api/src/demo-tokens.ts`
