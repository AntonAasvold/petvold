# Testprodukter (PR #182)

**Datum:** 2026-11-28 **ADR:** 0009, 0021, 0023, 0030, 0031, 0032 **Moduler:** `catalog` (seed), `api` (seed och skript)

## Vad
Fyra produkter för att prova ett säljflöde på webben från början till slut: Hund Extra, Hund Mini, Katt Extra och Katt Enkel. Varje produkt har egna serier för skaderegler, tariff och prisvillkor. Teckningsreglerna är en serie per art. `npm run catalog:seed` lägger till dem i en installation som redan har data, till exempel demon.

## Hur det fungerar
- **`modules/catalog/seed/products.json`** har de fyra nya produkterna. **`modules/api/seed/rule-sets.json`** har de 14 serierna som `{ series, calculationModel, content }`.
- **`seedInstallation`** publicerar serierna. Den skapar sedan varje produkt som utkast, skickar den till granskning och låter installationen publicera den (fyra ögon) genom `ProductService`. Tidigare skrevs produkterna direkt i lagringen. Nu körs granskningens kontroller, så en tariff utan faktor för en självrisk, eller teckningsregler utan åldersgräns för en art, stoppar seeden.
- **`modules/api/scripts/catalog-seed.ts`** visar vad som saknas och lägger till det med `--apply`. Den kör samma `seedInstallation`, som hoppar över det som finns.

## Val och avvägningar
- **Neutrala namn, publik källa.** Strukturen följer publika uppgifter om självrisker, självriskperiod och ålder, och källorna står i [Testprodukter](../funktion/testprodukter.md#källor). Premier, zoner, rasgrupper och skaderegler är påhittade (ADR 0009).
- **Nya teckningsserier i stället för att ändra `SE-HUND-UW`.** Den har 42 dagar och högst 9 år, och `SE-HUND-PLUS` och testerna bygger på det. Hund Mini delar `SE-HUND-EXTRA-UW` med Hund Extra.
- **Karenstid 30 dagar**, som de andra exempelprodukterna, fast den publika är 20 dagar. Fast självrisk 5 000 kr är inte med.
- **Katt Enkel har ingen kampanj**, eftersom den publika valprabatten inte gäller den.

## Att känna till
- `npm run dev` med `tsx watch` kör seeden igen när `seed.ts` ändras. De nya produkterna kom därför in i den lokala databasen bredvid data från tidigare, och det visar att vägen för en installation med data fungerar.
- Skriptet behöver samma inställningar som servern: databaserna och nycklarna för webhooks och dokument.

## Filer
- `modules/catalog/seed/products.json`, `modules/api/seed/rule-sets.json`, `modules/api/src/seed.ts`, `modules/api/scripts/catalog-seed.ts`, `package.json`, `scripts/check-language.ts`
- `modules/api/test/test-products.test.ts`
- `docs/funktion/testprodukter.md`, `docs/teknik/demo.md`, `docs/README.md`, `CLAUDE.md`
