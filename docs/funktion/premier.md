# Premier och betalningar

Hur Petvold delar en terms premie i delbetalningar, fördelar en betalning och räknar ut vad ett avslut betyder i pengar (ADR 0040).

**Läge:** räkningen är byggd som en ren funktion i `billing-core` (steg 1 av 8). Fakturor, betalarkonton och inbetalningar kommer i nästa steg, och fram till dess syns ingenting av detta i API:et.

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
