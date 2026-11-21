# Testerna och arbetssättet: egenskapstest för faktureringen och lagens månad (PR #132)

**Datum:** 2026-11-21 **ADR:** 0040 **Moduler:** `billing`, `catalog`, `api`, tester, dokumentation

## Vad
- Faktureringen har ett egenskapstest. Det hittade ett fel mot lagen, som är rättat.
- Två tester som måste ändras för hand vid varje migration eller modul uppdaterar sig nu själva.
- `status.md` är kortad.
- Varje PR behöver uppdatera färre dokument.

## Hur det fungerar
**Egenskapstestet** (`modules/billing/test/invoicing.property.test.ts`):
- slumpar ett till fyra policyer med olika intervall, dagar och betalare
- kör faktureringen med uppehåll på 1–30 dagar mellan körningarna, alltså också körningar som inte gått på ett tag
- kontrollerar varje gång:
  - ingen rad förfaller tidigare än lagen tillåter
  - ingen delbetalning faktureras två gånger
  - nummerserien har inga luckor
  - summorna stämmer
  - allt inom framförhållningen är fakturerat

**Felet:** FAL 5 kap. 1 § andra och tredje stycket säger att premien för en senare premieperiod, och vid förnyelse, inte behöver betalas tidigare än en månad efter att kravet skickades. Faktureringen fakturerade 20 dagar före förfallodagen och lät förfallodagen stå kvar. Efter ett uppehåll kunde en faktura till och med förfalla innan den skickades.

**Rättelsen:**
- Varje rad har nu en undre gräns: fjorton dagar efter fakturan för en ny policys första premie, och `laterPremiumMonths` (1) månader för de andra. Fakturan förfaller aldrig före någon rads gräns.
- Förvalet för framförhållningen är 31 dagar. Då förfaller en senare premie på sin dag när körningen går varje dag, eftersom `addMonths(d, 1)` aldrig är mer än 31 dagar efter `d`.

**De sköra testerna:**
- `db/test/claims-schema.test.ts` jämför de körda migreringarna med filerna i `db/migrations/`.
- `composition.test.ts` jämför lagringarna med `DATABASES`.

## Val och avvägningar
- **Testet provades mot den gamla koden.** Med uppehåll på högst 12 dagar fångade det inte felet från PR #131. Med upp till 30 dagar fångar det både det felet och felet med lagens månad.
- **31 och inte 35 dagar.** Med 35 dagar skulle en månadsbetalares första faktura ofta få två månader.
- **ADR 0040 fick en rättelse** i stället för en ny ADR, eftersom ADR:en redan säger att lagens regler ligger i marknadsprofilen. Det var regeln för senare premier som saknades.
- **Dokumentation:** funktion och teknik uppdateras där ändringen berör dem, inte i varje PR. Status har högst tre rader per PR, och byggloggen är stället för detaljer.

## Att känna till
- Planer som redan sparats med 20 dagars framförhållning behåller det, men förfallodagen flyttas ändå enligt lagen.

## Filer
- `modules/billing/test/invoicing.property.test.ts`
- `modules/billing/src/index.ts` (`laterPremiumMonths`, `minDue`)
- `docs/adr/0040-premier-fakturor-och-utbetalningar.md` (Rättelse 2026-11-21)
- `CLAUDE.md`, `docs/arbetssatt.md`
