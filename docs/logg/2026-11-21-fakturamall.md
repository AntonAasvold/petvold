# Mall för fakturan (PR #134)

**Datum:** 2026-11-21 **ADR:** 0038, 0040 **Moduler:** `documents`, back office

## Vad
Petvold kan göra fakturans PDF. I en marknad med `documentMaker: petvold` gör reläet PDF:en när meddelandet `invoice` skapas, på samma sätt som för skadebesked och försäkringsbrev.

## Hur det fungerar
- `invoice` i `modules/documents/src/templates/index.ts` visar:
  - en rad överst om vad kunden ska betala och när
  - en ram med belopp, förfallodag, referens och vart kunden betalar (`payment` från bolagets inställningar)
  - fakturanummer och fakturadatum
  - en specifikation med policy, period, avgift och skatt när de finns, och belopp
- Kolumnerna för skatt och avgift visas bara när någon rad har ett belopp där.
- Perioden visar den sista dagen, eftersom planens slut inte räknas in: 1 december till 31 december, inte till 1 januari.
- Referensens rubrik följer typen: OCR-nummer, eller Referens för RF.
- `petvoldTemplates` i `communications` läser listan `TEMPLATES`. Mallen gör alltså att fakturor får `documentMaker: petvold` utan någon annan ändring.

## Val och avvägningar
- **Policyns id och inte djurets namn i specifikationen.** Meddelandets innehåll har bara policyerna, och att läsa djuren skulle kräva att `notice-pdf.ts` läste policyer. Det kan komma om bolagen vill ha det.
- **Ingen text om obetald premie.** FAL 5 kap. 2 § kräver den i uppsägningen, inte i fakturan. Den kommer med steg 4, obetald premie.
- **Texterna** är nya nycklar i båda språkkatalogerna. Kontrollsumman räknas på hela katalogen, så också de andra mallarnas kontrollsummor ändras. Versionen är densamma, och ett sparat dokument har kvar sin gamla kontrollsumma.

## Att känna till
- Fakturan har ingen streckkod eller QR-kod för betalning. Det är något att lägga till om bolagen vill.

## Filer
- `modules/documents/src/templates/index.ts`, `texts-sv.ts`, `texts-en.ts`
- `modules/documents/test/templates.test.ts`, `modules/api/test/documents.test.ts`
