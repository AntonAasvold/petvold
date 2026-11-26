# Formulär för tariffer och prisvillkor (PR #NN)

**Datum:** 2026-11-26 **ADR:** 0030, 0021, 0035 **Moduler:** `apps/backoffice`

## Vad
En tariff och prisvillkor redigeras i ett formulär i stället för JSON, på samma sätt som produkter och skaderegler.

## Hur det fungerar
- **`src/pricing-form.ts`** är ren och testad. Den gör om innehåll till formulär och tillbaka, och kontrollerar formuläret.
  - Belopp visas i kronor med `toMajorText` och `toMinorUnits`, faktorer som decimaltal (11 500 baspunkter blir 1.15) och rabatter i procent.
  - Listor skrivs som rader med semikolon, till exempel `dog; 60000; 3000`. Tabeller skrivs som `nyckel = värde`, som diagnosgrupperna.
  - Det som formuläret inte visar finns kvar.
- **`<pv-tariff-content>` och `<pv-price-terms-content>`** i `content-forms.ts`. Versionspanelen väljer formulär efter innehållet med `formKind` och visar en sammanfattning för varje sort.
- **Kontrollerna** säger till exempel att en zon eller rasgrupp saknar faktor, att en art saknar åldersband från 0 år, eller att en kampanj slutar före sin start.

## Val och avvägningar
- **Rader i en textruta och inte en tabell med fält.** Det är samma sätt som diagnosgrupperna, går fort att skriva och klistra in, och tabellerna är korta. JSON finns kvar för den som vill.
- **Testet jämför med exempeltariffen i `pricing-core`**: formulär och tillbaka ger exakt samma innehåll.

## Filer
- `apps/backoffice/src/pricing-form.ts`, `components/content-forms.ts`, `components/versions-panel.ts`, `views/labels.ts`, `locales/sv.ts`
- `apps/backoffice/test/pricing-form.test.ts`, `e2e/catalog.spec.ts`
