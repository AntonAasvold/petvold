# Testprodukter

Fyra produkter i exempeldatan gör det möjligt att prova ett säljflöde på webben från början till slut: produkter till salu, prisindikation, hälsofrågor och ansökan. De finns i varje installation som startar från exempeldatan, och kan läggas till i en installation som redan har data (se [Lägga till dem i en installation med data](#lägga-till-dem-i-en-installation-med-data)).

Strukturen följer hur svenska djurförsäkringar säljs i dag, enligt publika källor: en fast och en rörlig självrisk, en självriskperiod på 135 dagar, och teckning från fyra veckors ålder utan övre åldersgräns. Premierna, rasgrupperna, zonerna och skadereglerna är påhittade (ADR 0009).

## Produkterna

| Produkt | Art | Försäkringsbelopp | Självrisker | Förval |
| --- | --- | --- | --- | --- |
| `SE-HUND-EXTRA@2026.1` *Hund Extra* | hund | 30 000, 60 000, 120 000 kr | fast 1 600, 2 700 eller 3 600 kr, och rörlig 15 eller 25 %: sex val | 60 000 kr, `f2700-v15` |
| `SE-HUND-MINI@2026.1` *Hund Mini* | hund | 30 000, 60 000 kr | 2 700 eller 3 600 kr, och 25 % | 30 000 kr, `f2700-v25` |
| `SE-KATT-EXTRA@2026.1` *Katt Extra* | katt | 30 000, 60 000, 120 000 kr | samma sex val som Hund Extra | 60 000 kr, `f2700-v15` |
| `SE-KATT-ENKEL@2026.1` *Katt Enkel* | katt | 15 000, 30 000 kr | låst: 1 200 kr och 25 % (`fixed`) | 30 000 kr |

- **Självriskernas koder** är `f<fast i kronor>-v<rörlig i procent>`, till exempel `f3600-v25`. Varje självrisk har en period på 135 dagar.
- **Förvald självrisk** är 2 700 kr och 15 %, som i det publika räkneexemplet.
- **Alla fyra** har en karenstid på 30 dagar, termer på tolv månader, start högst 90 dagar fram och avslut med omedelbar verkan. De har också placeholder-dokument på svenska: villkor, förköpsinformation och IPID.

## Serierna

| Produkt | Skaderegler | Tariff | Prisvillkor | Teckningsregler |
| --- | --- | --- | --- | --- |
| Hund Extra | `SE-HUND-EXTRA-VV` | `SE-HUND-EXTRA-TARIFF` | `SE-HUND-EXTRA-TERMS` | `SE-HUND-EXTRA-UW` |
| Hund Mini | `SE-HUND-MINI-VV` | `SE-HUND-MINI-TARIFF` | `SE-HUND-MINI-TERMS` | `SE-HUND-EXTRA-UW` |
| Katt Extra | `SE-KATT-EXTRA-VV` | `SE-KATT-EXTRA-TARIFF` | `SE-KATT-EXTRA-TERMS` | `SE-KATT-UW` |
| Katt Enkel | `SE-KATT-ENKEL-VV` | `SE-KATT-ENKEL-TARIFF` | `SE-KATT-ENKEL-TERMS` | `SE-KATT-UW` |

- **Skaderegler:** moms ersätts. Extra ersätts automatiskt upp till 15 000 kr. Mini och Enkel ersätts automatiskt upp till 8 000 kr, och ersätter inte heller tandrengöring (`dental-cleaning`).
- **Tariff:**
  - Grundpremie per försäkringsbelopp.
  - Ålder från 0 år.
  - Rasgrupper A, B och C för hund, och A och B för katt.
  - En faktor per självrisk: en lägre självrisk ger en högre premie.
  - Zoner efter postnummer: `1` och `41` stad, `411` centrum, annars landsbygd.
  - Hela kronor.
- **Prisvillkor:**
  - 10 % från det andra djuret i en grupp, och 15 % i en kull.
  - Kampanjkoden `PUPPY30` för hund och `KITTEN30` för katt ger 30 % det första året, bara för nya försäkringar.
  - Katt Enkel har ingen kampanj. Där är taket 15 %, annars 50 %.
- **Teckningsregler:** från 28 dagar och utan övre åldersgräns. Tre frågor:
  - `previous-illness` besvaras med diagnoser. En hjärtsjukdom (`CAR-MITRAL`, `CAR-DCM`) avslås för hund. Hjärtsjukdom (`CAR-HCM`) eller kronisk njursjukdom (`URO-CKD`) avslås för katt. Annan sjukdom ger ett förbehåll.
  - `ongoing-symptoms` skickas till en person.
  - `ongoing-treatment` skickas till en person.

Det befintliga `SE-HUND-UW` har kvar sina gränser, 42 dagar och högst 9 år, eftersom exempelprodukten `SE-HUND-PLUS` och testerna bygger på dem.

## Prova lokalt

Med `npm run dev` på `localhost:8787` och token `dev-all`:

```
# Produkterna till salu för katt
curl -s 'http://localhost:8787/v1/product-versions?onSale=2026-12-01&market=SE&species=cat' -H 'authorization: Bearer dev-all'

# Hälsofrågorna
curl -s 'http://localhost:8787/v1/application-questions?productVersion=SE-KATT-EXTRA@2026.1&species=cat&date=2026-12-01' -H 'authorization: Bearer dev-all'

# Prisindikation för en labradorvalp i Göteborg med 3 600 kr och 25 %
curl -s -X POST http://localhost:8787/v1/quotes -H 'authorization: Bearer dev-all' -H 'content-type: application/json' -H 'idempotency-key: quote-example-1' \
  -d '{"market":"SE","productVersion":"SE-HUND-EXTRA@2026.1","startDate":"2026-12-01","animal":{"species":"dog","breed":"dog-labrador-retriever","birthDate":"2026-09-01"},"postalCode":"41120","vetCare":{"annualLimit":6000000,"deductible":"f3600-v25"},"campaignCode":"PUPPY30"}'
```

**Grundpremien blir 5 360 kr:** 5 200 kr × 0,9 för ålder under 3 år × 1,15 för labrador i grupp B × 0,83 för `f3600-v25` × 1,2 för postnummer 411. Med `PUPPY30` blir det 3 752 kr det första året.

**En ansökan** (`POST /v1/applications`) behöver:
- en part och ett djur
- svar på alla tre frågorna
- `acceptance.documents` med de dokument som produkten listar: typ, språk och `sha256`

Svaret nej på alla frågor ger `accepted` och en policy. Ja på `ongoing-symptoms` ger `referred`. `modules/api/test/test-products.test.ts` visar hela flödet.

## Lägga till dem i en installation med data

Seeden lägger bara till det som saknas och ändrar aldrig något som finns. Produkterna går genom granskningen som alla andra, så en serie som inte täcker en produkt stoppar den.

```
npm run catalog:seed            # visar vad som saknas
npm run catalog:seed -- --apply # lägger till det
```

I demon, se [Demon](../teknik/demo.md#nya-produkter-och-regler-med-datan-kvar).

## Källor

- **Självrisker:** fast 1 600, 2 700 och 3 600 kr, och rörlig 15 och 25 % för hund och katt. [agria.se, Självrisk på djurförsäkring](https://www.agria.se/forsakring/sjalvrisk/). Där finns också 5 000 kr, som inte är med här.
- **Självriskperiod:** 135 dagar. [agria.se, villkor Hund från 2026-04-01](https://www.agria.se/dokument/villkor/hund/hundforsakring/).
- **Ålder och valprabatt:** teckning från fyra veckor utan övre åldersgräns, och 30 % det första året. [agria.se, Hundförsäkring](https://www.agria.se/hundforsakring/).
- **Karenstid:** den publika karenstiden är 20 dagar ([agria.se, Karenstid](https://www.agria.se/forsakring/karenstid-for-din-djurforsakring/)). Testprodukterna har 30 dagar, som de andra exempelprodukterna.
