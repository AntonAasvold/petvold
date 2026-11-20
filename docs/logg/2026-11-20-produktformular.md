# Formulär för produkter och skaderegler (PR #109)

**Datum:** 2026-11-20 **ADR:** 0021, 0023, 0035 **Moduler:** apps/backoffice

## Vad
En produktversion och en version av skaderegler redigeras i ett formulär i stället för som JSON. Det går fortfarande att växla till JSON, och tariffer, prisvillkor och teckningsregler redigeras som JSON som förut.

## Hur det fungerar
1. **`product-form.ts`** är rena funktioner:
   - `productFormFrom` gör om innehållet till fält som text: belopp i hela enheter, procent i stället för baspunkter och listor med semikolon.
   - `productContentFrom` gör om fälten till innehåll, ovanpå innehållet formuläret började från. Dokumenten och fält som formuläret inte känner till finns alltså kvar.
   - `productFormProblems` säger vad som saknas eller är fel, som id:n för besked.
   - Skaderegler har samma tre funktioner, och `isClaimsRules` avgör om innehållet är skaderegler.
2. **`<pv-product-content>` och `<pv-rules-content>`** i `components/content-forms.ts` håller formuläret och ger innehållet med `result()`. Arterna kommer från referensdatan.
3. **`<pv-versions-panel>`:**
   - **Läget:** formuläret är förvalt när det finns ett. Växlingen till JSON går genom formulärets resultat, och tillbaka genom den tolkade JSON:en, så att inget går förlorat.
   - **Spara:** innehållet tas från det läge som visas.
   - **En vald version** visar en sammanfattning, och JSON:en går att fälla ut.

## Val och avvägningar
- **Innehållet går fram och tillbaka utan förlust.** Testet för en produkt med dokument, två självrisker, steg efter ålder och inställningar visar att innehållet blir detsamma efter vägen genom formuläret. Ett formulär som tappade fält skulle ändra en produkt utan att någon sett det.
- **Semikolon mellan belopp och åldersteg,** eftersom kommatecken kan vara decimaltecken i svenska belopp.
- **Belopp i reglerna har två decimaler.** Skaderegler har ingen valuta, bara marknad, och alla marknader Petvold känner har valutor med två decimaler.
- **Tariffer, prisvillkor och teckningsregler får inga formulär än.** De är tabeller och regler i flera nivåer, och ett bra formulär för dem är ett eget arbete.

## Att känna till
- **Namn** visas för de språk innehållet har, plus svenska och engelska. Ett tomt namn tas bort.
- **Ett formulär med fel** går inte att växla till JSON förrän felet är rättat. Annars skulle JSON:en sakna det man skrivit.

## Filer
- `apps/backoffice/src/product-form.ts` (ny), `src/components/content-forms.ts` (ny), `src/components/versions-panel.ts`, `src/views/catalog-views.ts`, `src/views/labels.ts`, `src/locales/sv.ts`
- `apps/backoffice/test/product-form.test.ts` (ny), `e2e/catalog.spec.ts`
