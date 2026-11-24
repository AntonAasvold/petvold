# Premie och faktura

När en policy tecknas eller förnyas delas terminens premie i delbetalningar. En körning samlar varje morgon det som snart förfaller på en faktura per betalare och skickar den till kunden.

**Roller:** försäkringstagaren betalar. Körningen `billing.invoicing` fakturerar. Ekonomiavdelningen (`billing-clerk`) följer fakturorna.

## Flödet

1. **En policy tecknas eller förnyas** (`policy.issued`, `policy.renewed`). Försäkringstagaren får ett betalarkonto om hen inte har ett i marknaden och valutan.
2. **En premieplan görs för terminen.** Premien delas efter betalningsintervallet i delbetalningar med period, förfallodag och belopp.
3. **Varje morgon klockan 04:00** samlar faktureringen de delbetalningar som förfaller inom framförhållningen. Det blir en faktura per betalarkonto, också när kunden har flera policyer.
4. **Fakturan** får nummer, betalningsreferens och förfallodag, och händelsen `invoice.issued`.
5. **Kunden får fakturan** som meddelande samma dag.

## Regler

| Id | Regel | Källa | Inställning |
| --- | --- | --- | --- |
| PREM-01 | En betalare per försäkringstagare, marknad och valuta. Alla policyer för samma betalare hamnar på samma faktura, också med olika intervall. | ADR 0040, punkt 2 | – |
| PREM-02 | Intervallet väljs per policy bland de som produkten tillåter (år, halvår, kvartal, månad). Utan val gäller produktens förval. Vid förnyelse behålls intervallet om produkten fortfarande tillåter det. | ADR 0040, punkt 2 | Produktens `billing.paymentIntervals` och `defaultPaymentInterval` |
| PREM-03 | Premien delas i heltal i minsta enhet. Resten efter delningen läggs på den första delbetalningen, så att summan alltid är terminens premie. | ADR 0040, punkt 3 | – |
| PREM-04 | En premieplan ändras aldrig. En ändring blir en ny plan som ersätter den gamla från ett datum. | ADR 0040, punkt 3 | – |
| PREM-05 | Skatt på premie är en egen rad med marknadens sats. Sverige har ingen. | ADR 0040, punkt 3 | Marknadens regler |
| PREM-06 | En delbetalning faktureras när den förfaller inom framförhållningen, och aldrig två gånger. | ADR 0040, punkt 5 | Produktens `billing.invoiceLeadDays`, förval 31 dagar |
| PREM-07 | **Den första premien** för en ny policy förfaller tidigast fjorton dagar efter att fakturan skickades, och aldrig före terminens början. | FAL 5 kap. 1 § första stycket | Marknadens `firstPremiumDays` |
| PREM-08 | **En senare premie**, också vid förnyelse, förfaller tidigast en månad efter att fakturan skickades. | FAL 5 kap. 1 § andra och tredje stycket | Marknadens `laterPremiumMonths` |
| PREM-09 | Fakturans förfallodag är den tidigaste radens, men aldrig tidigare än lagen tillåter för någon rad (PREM-07 och PREM-08). | ADR 0040, rättelse 2026-11-21 | – |
| PREM-10 | Fakturanummer tas ur en obruten serie per marknad och år, till exempel `SE-2026-000001`. Kreditnotor tar nummer ur samma serie. | Bokföringslagen 5 kap. 7 § | – |
| PREM-11 | Fakturan har en betalningsreferens med kontrollsiffra: OCR i Sverige och RF (ISO 11649) i EUR-marknader. | ADR 0040, punkt 5 | Marknadens regler |
| PREM-12 | En faktura ändras aldrig. En rättelse är en kreditnota. | ADR 0040, punkt 5 | – |
| PREM-13 | Fakturan skickas till kunden på sin fakturadag, eftersom tiden att betala räknas från den dag den skickades. Utan bolagets text om vart kunden betalar hamnar den i kön. | FAL 5 kap. 1 §, ADR 0032 | Bolagets text `payment` |

## Exempel

Bella tecknas den 21 november med start den 1 december, 4 800 kr per år och månadsvis betalning. Planen får tolv delbetalningar på 400 kr. Den 21 november tas december med på en faktura som förfaller den 5 december, alltså fjorton dagar senare enligt PREM-07. Januari faktureras den 1 december och förfaller den 1 januari, en månad senare enligt PREM-08.

## Mer

- [Premier och betalningar](../funktion/premier.md#fakturor): hur faktureringen ställs in och läses i API:t
- [Körningar](../funktion/korningar.md): `billing.invoicing`
- [ADR 0040](../adr/0040-premier-fakturor-och-utbetalningar.md): besluten om pengar
