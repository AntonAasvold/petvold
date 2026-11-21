# Premier och betalningar

Hur Petvold delar en terms premie i delbetalningar, fördelar en betalning och räknar ut vad ett avslut betyder i pengar (ADR 0040).

**Läge:** räkningen finns i `billing-core` (steg 1 av 8). Modulen `billing` gör betalarkonton och premieplaner av policyhändelserna (steg 2a) och fakturor med faktureringskörningen (steg 2b). Fakturan som meddelande till kunden, inbetalningar och ändringar mitt i termen kommer i nästa steg.

## Betalarkonto och premieplan

När en policy tecknas (`policy.issued`) eller förnyas (`policy.renewed`) gör `billing` en premieplan för termen:

- **Betalarkontot** är försäkringstagarens, ett per marknad och valuta. Det skapas med den första planen, och senare policyer hamnar på samma konto. Betalsättet är faktura tills betalningsmodulen finns.
- **Intervallet** är produktens förval (`billing.defaultPaymentInterval`, se [Produktkonfiguration](produktkonfiguration.md#produkter-och-produktversioner)). Vid förnyelse behålls förra termens intervall om produkten fortfarande tillåter det, och annars gäller förvalet. Kundens eget val vid tecknandet kommer i steg 2c.
- **Den första premien** räknas från den dag policyn tecknades, eftersom försäkringsbrevet och avin går ut samtidigt. I Sverige förfaller den fjorton dagar senare, men aldrig före termens början.
- **Skatten** kommer från marknadens regler (`BILLING_MARKET_RULES`). Sverige har ingen skatt på premien. En marknad utan regler ger ett fel som reläet försöker igen, så att ingen plan görs med fel regler.
- Samma händelse två gånger ger bara en plan.

| Anrop | Vad det ger |
| --- | --- |
| `GET /v1/payer-accounts?partyId=…&market=…` | Betalarkonton |
| `GET /v1/payer-accounts/{accountId}` | Ett betalarkonto |
| `GET /v1/premium-plans?policyId=…` eller `?accountId=…` | Premieplanerna med underlaget (`input`) och resultatet (`plan`), äldst först |

Alla tre kräver `billing:read` (rollen `billing-clerk`). Kundportalen (`customer-channel`) ser premieplanerna för sina egna policyer.

## Fakturor

**Faktureringen** är körningen `billing.invoicing` ([Körningar](korningar.md)), som går klockan 04:00 varje dag i varje marknad, efter förnyelsen. Den tar varje delbetalning som inte fakturerats och som förfaller inom planens framförhållning (`billing.invoiceLeadDays`, förval 31 dagar). Allt för samma betalarkonto hamnar på **en faktura**, också när kunden har flera policyer med olika intervall.

- **Fakturans förfallodag** är den tidigaste radens, men aldrig tidigare än lagen tillåter för någon rad (FAL 5 kap. 1 §):
  - **Den första premien** för en ny policy förfaller tidigast fjorton dagar efter fakturan.
  - **En senare premie**, också vid förnyelse, förfaller tidigast en månad efter fakturan.
- **Förvalet 31 dagar** gör att en senare premie normalt förfaller på periodens första dag, eftersom en månad aldrig är längre än 31 dagar. En kortare framförhållning, eller en körning som inte gått på några dagar, flyttar förfallodagen framåt. Den flyttas aldrig bakåt.
- **En delbetalning faktureras bara en gång.** Två körningar samtidigt kan inte fakturera samma delbetalning.
- **En faktura ändras aldrig.** En rättelse blir en kreditnota (steg 5).
- **En provkörning** (`dryRun`) visar vilka fakturor som skulle göras utan att spara något.

**Fakturanumret** tas ur en obruten serie per marknad och år, till exempel `SE-2026-000001` (bokföringslagen 5 kap. 7 §). Numret tas i samma transaktion som fakturan sparas, så en faktura som inte sparas tar inget nummer.

**Betalningsreferensen** gör att en inbetalning kan kopplas till fakturan utan manuellt arbete:

| Marknad | Referens | Exempel för faktura 1 år 2026 |
| --- | --- | --- |
| Sverige | OCR för Bankgirot: fakturans år och nummer, en längdsiffra (referensens längd modulo 10) och en kontrollsiffra enligt Luhn (modulo 10). Banken kan då vägra en referens med en siffra för mycket eller för lite. | `202600000121` |
| EUR-marknader | RF-referens enligt ISO 11649: `RF`, två kontrollsiffror (modulo 97) och fakturans år och nummer | `RF422026000001` |

**Exempel:** Anna tecknar en hundförsäkring den 22 november 2026 som börjar den 25 november och betalas per månad med 400 kr. Faktureringen samma dag gör faktura `SE-2026-000001` på 400 kr. Den förfaller den 6 december, fjorton dagar efter fakturan. Faktureringen den 24 november tar hundens andra månad, som då förfaller om 31 dagar, och den förfaller på sin dag, den 25 december. Det är mer än en månad efter fakturan.

Hade körningen stått still och den andra månaden fakturerats först den 10 december, hade den förfallit den 10 januari, en månad efter fakturan och inte den 25 december.

| Anrop | Vad det ger |
| --- | --- |
| `GET /v1/invoices?accountId=…&policyId=…&market=…` | Fakturor, äldst först |
| `GET /v1/invoices/{invoiceId}` | En faktura med rader, förfallodag och referens |

Händelsen `invoice.issued` går till bolagets system med webhooks ([Webhooks](webhooks.md)), och fakturan går till kunden som meddelandet `invoice` ([Meddelanden](meddelanden.md)). Den ska skickas samma dag som fakturan görs, eftersom tiden att betala räknas därifrån. Kundportalen ser en faktura bara om alla rader gäller dess egna policyer.

## Premieplanen

En term får en premieplan när policyn tecknas eller förnyas. Planen delar termens premie i delbetalningar efter **betalningsintervallet**: år, halvår, kvartal eller månad.

**Perioder:**
- Den första perioden börjar på termens första dag. Varje period är ett intervall i kalendermånader, alltid räknat från termens början. En term som börjar den 31 januari får perioderna 31 januari, 28 februari, 31 mars och så vidare, och dagen glider aldrig.
- Bara den sista perioden kan vara kortare, när termen inte slutar på en gräns. Det händer till exempel när en ny ägare tar över en policy mitt i en term.

**Belopp:**
- Hela perioder kostar lika mycket. Det som blir över efter divisionen läggs på den första delbetalningen, så att summan alltid är exakt termens premie.
- En kortare sista period får sin andel per dag, avrundad nedåt. Resten delas lika på de hela perioderna.
- **Skatt på premien** räknas en gång på hela premien, med satsen från marknadsprofilen, och avrundas halvt uppåt. Den delas på samma sätt som premien. Sverige har ingen sådan skatt.
- **Avgift per delbetalning** (`billing.installmentFee`) tas på varje delbetalning när intervallet är kortare än ett år.

**Förfallodag:** periodens första dag. Den **första premien** för en ny försäkring förfaller tidigast det antal dagar efter att avin skickades som marknaden anger (i Sverige fjorton dagar, FAL 5 kap. 1 §), men aldrig före termens början. Vid förnyelse gäller periodens första dag.

**Exempel:** Bella har en årspremie på 4 934 kr, en term från 1 april 2026 och betalar per månad. Om delningen blev 411,16 kr varje månad skulle 8 öre bli över, så den första månaden kostar 411,24 kr och de elva andra 411,16 kr.

| Exempel | Delbetalningar |
| --- | --- |
| 4 934 kr per år, betalas per kvartal, med skatt 2,5 % och avgift 29 kr | Skatten blir 123,35 kr. Varje kvartal kostar 1 233,50 kr i premie och 29 kr i avgift. Skatten blir 30,86 kr på det första kvartalet och 30,83 kr på de tre andra. |
| 3 920 kr för 15 juni 2026 till 1 april 2027, betalas per kvartal | Tre hela kvartal på 1 230,07 kr, och 15–31 mars (17 av 290 dagar) för 229,79 kr. |

**En plan ändras aldrig.** Varje plan sparar sin beräkningsmodell (`premium-plan.v1`) och en kontrollsumma av underlaget, så att den kan räknas om och jämföras med den sparade (ADR 0018). En ändring blir en ny plan.

## En ändring under termen

En ändring som höjer premien (`policy.changed` med positiv `premiumAdjustment`) läggs på de delbetalningar som inte fakturerats än, lika mycket på var och en, och det som blir över hamnar på den första. Om alla delbetalningar redan är fakturerade blir höjningen en egen faktura. En sänkning blir en kredit.

## Fördelning av en betalning

En betalning går till den skuld som förföll först, och vid samma dag i id-ordning. Ingen post får mer än det som är obetalt på den. Det som blir över efter att allt är betalt blir ett tillgodohavande.

**Exempel:** Två fakturor är obetalda, april 411,24 kr och maj 411,16 kr. En betalning på 500 kr betalar april helt och 88,76 kr av maj.

## Avräkning vid avslut

Ett avslut minskar termens premie med beloppet i `refund` från `policy.cancelled`, och skatten räknas om på det som är kvar. Sedan jämförs det med det som är fakturerat och betalt:

1. Delbetalningar som inte fakturerats tas bort. Deras avgifter tas inte ut.
2. Det som fortfarande ska betalas står kvar på de fakturerade delbetalningarna, den äldsta först. Resten av dem krediteras.
3. Räcker inte de fakturerade delbetalningarna blir skillnaden en ny debitering.
4. Har kunden betalat mer än termen nu kostar blir skillnaden ett tillgodohavande.

Det gäller alltid att det betalda plus det som står kvar plus den nya debiteringen, minus tillgodohavandet, är vad termen nu kostar.

| Kvartalsplan på 4 000 kr | Återbetalning | Resultat |
| --- | --- | --- |
| Två kvartal fakturerade och betalda | 2 500 kr | Termen kostar 1 500 kr. Två kvartal tas bort, och 500 kr blir ett tillgodohavande. |
| Q1 betalt, Q2 fakturerat men obetalt | 2 200 kr | Termen kostar 1 800 kr. 800 kr står kvar på Q2, och 200 kr krediteras. |
| Bara Q1 fakturerat och betalt | 1 200 kr | Termen kostar 2 800 kr. Tre kvartal tas bort, och 1 800 kr blir en ny debitering. |
