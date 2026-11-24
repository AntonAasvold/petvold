# Bokföring

Varje händelse som rör pengar bokförs som en verifikation med dubbel bokföring. Varje morgon stängs gårdagen och lämnas till bolagets ekonomisystem.

**Roller:** `accounting` bokför. Körningen `accounting.day-close` stänger dagarna. Redovisningen (`accountant`) läser och ställer in kontoplanen.

## Flödet

1. **En händelse med pengar** (faktura, kreditnota, inbetalning, koppling, återbetalning, utbetalningsorder och utbetalning) blir en verifikation.
2. **Verifikationen** får nummer ur en obruten serie och en bokföringsdag. Debet och kredit går ihop.
3. **Varje morgon klockan 06:00** stängs dagarna före i dag, i ordning. Varje stängd dag får summor och en kontrollsumma, och `accounting.day_closed` skickas.
4. **Bolagets ekonomisystem** hämtar dagens fil som CSV, med kontona enligt kontoplanen.

## Regler

| Id | Regel | Källa | Inställning |
| --- | --- | --- | --- |
| BOK-01 | Varje händelse som rör pengar blir en verifikation, en gång. Debet och kredit går alltid ihop. | ADR 0040, punkt 9, bokföringslagen 5 kap. | – |
| BOK-02 | Verifikationer numreras i en obruten serie per marknad och år. | Bokföringslagen 5 kap. | – |
| BOK-03 | En verifikation ändras aldrig. En rättelse är en ny verifikation. | Bokföringslagen 5 kap. 5 § | – |
| BOK-04 | En inbetalning bokförs först mot okopplade inbetalningar, och flyttas till premiefordran när den kopplats till en betalare. | ADR 0040, förtydligande 2026-11-24 | – |
| BOK-05 | Ett tillgodohavande är ett negativt saldo på premiefordran per betalare. Bolaget kan flytta det till skuld i sitt ekonomisystem. | ADR 0040, förtydligande 2026-11-24 | – |
| BOK-06 | En avskrivning bokförs som kundförlust, en kreditnota som minskad premieintäkt. | ADR 0040, punkt 10 | – |
| BOK-07 | Varje rad för premie bär perioden den gäller, så att premien kan periodiseras i bolagets ekonomisystem. | ADR 0040, punkt 9 | – |
| BOK-08 | Dagarna stängs i ordning, ingen hoppas över, också dagar utan verifikationer. | ADR 0040, punkt 9 | Körningen `accounting.day-close`, 06:00 |
| BOK-09 | En stängd dag ändras aldrig. En verifikation för en stängd dag bokförs på första öppna dag, med sin egen dag sparad. | ADR 0040, punkt 9 | – |
| BOK-10 | Dagens fil görs av dagens verifikationer och kontoplanen som gällde vid stängningen, och kontrolleras mot kontrollsumman. En ny kontoplan ändrar inte en stängd dag. | ADR 0040, punkt 9 | Kontoplanen, `accounting:configure` |
| BOK-11 | Periodisering, avsättningar och rapporter till tillsynen görs i bolagets ekonomisystem, inte i Petvold. | ADR 0040, punkt 9 | – |
| BOK-12 | Verifikationer, fakturor och betalningar sparas i sju år och raderas inte vid en begäran om radering. | Bokföringslagen 7 kap. 2 §, GDPR artikel 6.1 c och 17.3 b | – |

## Mer

- [Bokföring](../funktion/bokforing.md): kontona, filen och API:t
- [Körningar](../funktion/korningar.md): `accounting.day-close`
