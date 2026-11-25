# Inbetalning

Pengar kommer in på bolagets konto via en betaltjänst. De kopplas till rätt betalare och faktura, och det som inte går att koppla väntar på en person.

**Roller:** betaltjänsten aviserar. `billing` kopplar. Ekonomiavdelningen (`billing-clerk`) kopplar det som är kvar.

## Flödet

1. **Betaltjänsten aviserar en inbetalning** till Petvold, signerad, eller så läses bankens fil (`camt.054`) in. Den sparas en gång, och händelsen `payment.succeeded` skickas.
2. **Med en fakturas OCR eller RF** kopplas inbetalningen till fakturans betalarkonto. Den betalar först den fakturan, sedan kontots äldsta förfallna faktura, och det som blir över blir ett tillgodohavande.
3. **Utan en användbar referens** hamnar inbetalningen i kön för okopplade inbetalningar. En handläggare kopplar den till ett konto eller en faktura.
4. **En faktura som blir helt betald** ger `invoice.paid`. Varje koppling ger `payment.matched`.

## Regler

| Id | Regel | Källa | Inställning |
| --- | --- | --- | --- |
| BET-01 | En avisering godtas bara med giltig signatur och en tidsstämpel som inte är mer än fem minuter fel. | ADR 0017 | Betaltjänstens hemlighet |
| BET-02 | En inbetalning sparas en gång per betaltjänst och id, hur många gånger aviseringen än kommer. Samma id med annat innehåll avvisas. | ADR 0017, punkt 4 | – |
| BET-03 | Ett fel i en inbetalning avvisar hela aviseringen, så att betaltjänsten skickar den igen när felet är rättat. | ADR 0017 | – |
| BET-04 | En inbetalning med en fakturas referens, i fakturans marknad och valuta, betalar först den fakturan. | ADR 0040, förtydligande 2026-11-23 | – |
| BET-05 | Det som blir över går till kontots äldsta förfallna faktura först, vid samma dag i id-ordning. Ingen faktura får mer än det som är obetalt på den. | ADR 0040, punkt 6 | – |
| BET-06 | Det som ingen faktura behöver blir betalarens tillgodohavande. | ADR 0040, punkt 6 | – |
| BET-07 | En inbetalning utan referens, med en okänd referens eller i en annan valuta väntar bland de okopplade. | ADR 0040, punkt 6 | – |
| BET-08 | En okopplad inbetalning kopplas en gång, av en person med `billing:write`, till ett konto eller en faktura i samma marknad och valuta. | ADR 0040, punkt 6 och 10 | – |
| BET-09 | Inget av det ändrar fakturan. Det betalda och obetalda räknas ut från det inbetalningarna betalat och från kreditnotorna. | ADR 0040, punkt 5 | – |
| BET-10 | Betalas en faktura som är uppsagd för obetald premie innan uppsägningen fått verkan, återkallas uppsägningen (se OBET-05). | FAL 5 kap. 2 § | – |
| BET-11 | En bankfil läses in av en inloggad person eller integration, hela eller ingenting, och sparas med vem som läste in den, när och filens kontrollsumma. Samma fil igen ger inga nya inbetalningar. | ADR 0040, punkt 12, ADR 0018 | `PETVOLD_BANK_FILE_ACCOUNTS` |
| BET-12 | Kunden kan betala en faktura på en betalsida hos en betaltjänst, till exempel med kort eller Swish via Stripe. Sidan gäller det som är kvar att betala, med fakturans referens, i en timme. Betalningen kopplas med referensen som andra inbetalningar. | ADR 0040, punkt 12 | `PETVOLD_STRIPE_SECRET_KEY` |

## Exempel

Anna har två fakturor, december och januari på 400 kr var. Hon betalar 900 kr med januaris OCR. Januari betalas först (BET-04), sedan december (BET-05), och 100 kr blir ett tillgodohavande (BET-06).

## Mer

- [Premier och betalningar](../funktion/premier.md#koppling-till-fakturorna): kön, kopplingen och API:t
- [Kreditering och tillgodohavanden](kreditering-och-tillgodohavanden.md): vad som händer med tillgodohavandet
