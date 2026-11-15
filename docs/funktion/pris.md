# Pris

Premien räknas med en **tariff** (ADR 0030). En tariff är tabeller som publiceras med fyra ögon, på samma sätt som skaderegler. Den ger grundpriset. Rabatter läggs på efter grundpriset som prisvilkor (kommer i ett senare steg).

Den här första delen innehåller prisfunktionen och tariffserierna. Prisindikation, prisvilkor och pris vid tecknande, ändring och förnyelse kommer i nästa steg. Till dess anges premien för hand.

## Så räknas grundpriset

1. **Grundpremie** per art och försäkringsbelopp, för ett år.
2. Gånger **faktorer**:

| Faktor | Från | Exempel |
| --- | --- | --- |
| Ålder | Djurets ålder i hela år på termens första dag. Det högsta åldersbandet som inte är över åldern gäller. | 7 år ger 1,3 |
| Ras | Rasens riskgrupp. En ras som saknas eller är okänd får förvald grupp. | Labrador i grupp B ger 1,1 |
| Självrisk | Det valda självriskalternativet | `high` ger 0,85 |
| Ort | Zon efter försäkringstagarens postnummer, där det längsta matchande prefixet gäller. Inget postnummer ger förvald zon. | `1` (Stockholm) ger 1,15 |

3. Minst **lägsta premie**.
4. **Avrundat** till en jämn summa, till exempel hela kronor, halvt uppåt.
5. **Termens premie** är årspremien per dag gånger termens dagar.

All räkning sker med heltal, och avrundning sker bara på slutet, så priset blir detsamma varje gång det räknas om. Svaret listar varje steg (`breakdown`), så att priset kan förklaras.

**Exempel:** Bella är en labrador som är 7 år när termen börjar 1 april 2026. Hon har försäkringsbelopp 60 000 kr och standardsjälvrisk, och ägaren bor på postnummer 111 22.

| Steg | Belopp |
| --- | --- |
| Grundpremie, hund och 60 000 kr | 3 000 kr |
| × 1,3 (7 år) | 3 900 kr |
| × 1,1 (ras, grupp B) | 4 290 kr |
| × 1,0 (standardsjälvrisk) | 4 290 kr |
| × 1,15 (zon storstad) | 4 933,50 kr |
| Avrundat till hela kronor | **4 934 kr om året** |

## Vad priset sparar

Priset sparar inte postnumret, bara zonen (GDPR artikel 5.1 c). Svaret har:
- `facts` med ålder, riskgrupp, zon och dagar
- tariffens version och kontrollsumma
- `inputHash`

Samma uppgifter ger samma `inputHash`.

## Tariffens fält

En tariffversion skapas med `POST /v1/rule-sets/{serie}/versions` och `calculationModel: "tariff.v1"`. Den har samma livscykel som skaderegler (se [Produktkonfiguration](produktkonfiguration.md#regeluppsättningar)). En serie innehåller antingen tariffer eller skaderegler, aldrig båda.

| Fält | Betyder |
| --- | --- |
| `market`, `currency` | Marknad och valuta |
| `basePremiums` | `species`, `annualLimit` och `amount` per år, i öre |
| `ageBands` | `species`, `fromYears` och `bp`. Varje art måste ha ett band från 0 år. |
| `breedGroups`, `defaultBreedGroup`, `breedGroupFactors` | Ras till riskgrupp, förvald grupp, och faktor per grupp |
| `deductibleFactors` | Faktor per självriskalternativ i produkten |
| `zones`, `defaultZone`, `zoneFactors` | Postnummerprefix till zon, förvald zon, och faktor per zon |
| `minimumAnnual` | Lägsta premie per år |
| `roundTo` | Avrundning, till exempel `100` för hela kronor |

Faktorer anges i baspunkter, där 10 000 betyder 1,0.

*Inte byggt än:* prisindikation, prisvilkor (rabatter), pris vid tecknande, ändring och förnyelse, manuellt pris, skatt per marknad, och simulering av tariffer.
