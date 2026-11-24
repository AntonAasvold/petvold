# Kreditering och tillgodohavanden

Premien kan sänkas under terminen, en faktura kan krediteras eller skrivas av, och det kunden betalat för mycket blir ett tillgodohavande. Det används på nästa faktura eller betalas tillbaka.

**Roller:** policymodulen ändrar och avslutar. `billing` krediterar automatiskt. Ekonomiavdelningen (`billing-clerk`) krediterar och skriver av för hand. Ekonomichefen (`billing-manager`) attesterar större belopp.

## Flödet

1. **En ändring, ett avslut eller en överlåtelse** ger en ny premieplan. En lägre premie dras först från det som inte fakturerats, och bara det som inte räcker krediteras.
2. **En handläggare kan kreditera eller skriva av** en faktura. Inom handläggarens gräns görs det direkt. Över gränsen blir det ett förslag som någon annan attesterar.
3. **Ett tillgodohavande** betalar varje morgon kontots obetalda fakturor, den äldsta först. Har kontot inget mer att fakturera betalas det tillbaka.
4. **Kunden kan be** om tillgodohavandet tillbaka. Det betalas ut som en utbetalning.

## Regler

| Id | Regel | Källa | Inställning |
| --- | --- | --- | --- |
| KRED-01 | En högre premie under terminen läggs på delbetalningarna som inte fakturerats. Är allt fakturerat blir den en egen delbetalning. | ADR 0040, punkt 4 | – |
| KRED-02 | En lägre premie dras från delbetalningarna som inte fakturerats, lika mycket på var och en och aldrig under noll. Bara det som inte räcker krediteras. | ADR 0040, beslut 6 (2026-11-21) | – |
| KRED-03 | Vid avslut tas delbetalningar som inte fakturerats bort. Det terminen fortfarande kostar står kvar på fakturorna, och resten krediteras. | ADR 0040, punkt 4 | – |
| KRED-04 | Premie tillbaka räknas per dag, också vid ånger. En produkt kan inte ange en sämre regel. | FAL 5 kap. 6 §, distansavtalslagen 3 kap. 20 § | – |
| KRED-05 | Kreditnotor från en policyhändelse görs automatiskt utan attest, en per faktura, med nummer ur fakturornas serie. | ADR 0040, beslut 6 | – |
| KRED-06 | En kreditnota som en person gör tar högst det som är kvar att kreditera, också på en betald faktura. Det betalda som fakturan då inte behöver blir ett tillgodohavande. | ADR 0040, punkt 5 | – |
| KRED-07 | En avskrivning ger upp högst det som är obetalt. Den är en egen sorts kreditnota, så att bokföringen kan skilja den från en kreditering. | ADR 0040, punkt 10 | – |
| KRED-08 | Inom handläggarens gräns görs kreditnotan eller avskrivningen direkt. Över gränsen blir den ett förslag som någon annan med tillräcklig gräns attesterar. Den som föreslog får aldrig attestera själv. | ADR 0040, punkt 10 | Rollens `creditLimits`: `billing-clerk` 1 000 kr, `billing-manager` 50 000 kr |
| KRED-09 | Vid attesten kontrolleras fakturan igen. Tillåter den inte längre beloppet, till exempel för att kunden betalat, nekas attesten. | ADR 0040, punkt 10 | – |
| KRED-10 | Ett tillgodohavande betalar kontots obetalda fakturor, den äldsta förfallna först. | ADR 0040, punkt 6 | – |
| KRED-11 | Har kontot inget mer att fakturera betalas tillgodohavandet tillbaka. Det gäller när alla delbetalningar är fakturerade och terminen tagit slut, avslutats eller överlåtits. | ADR 0040, punkt 6 | – |
| KRED-12 | Kunden kan be om hela tillgodohavandet eller en del tillbaka, aldrig mer än det som finns. | ADR 0040, punkt 6 | – |

## Exempel

Bella betalar 400 kr i månaden. December och januari är fakturerade och betalda. Hon dör, och policyn avslutas från den 16 januari med 4 195,07 kr tillbaka. Februari till november tas bort (KRED-03), och 195,07 kr av januari krediteras. Det blir ett tillgodohavande som betalas tillbaka nästa morgon (KRED-11), eftersom kontot inte har något mer att fakturera.

## Mer

- [Premier och betalningar](../funktion/premier.md#kreditnotor-och-avskrivningar): kreditnotor, förslag och tillgodohavanden i API:t
- [Behörighet](../funktion/behorighet.md#beloppsgränser-och-fyra-ögon): gränserna
