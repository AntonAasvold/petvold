# Produktkonfiguration

Vad en produkt och en policy styr i skaderegleringen, och hur det ställs in.

> **Läge:** Produktkatalogen byggs i M2. Tills dess finns reglerna som exempeldata i koden (`modules/claims-store-memory/src/fixtures.ts`), och skademotorn läser dem via ett gränssnitt (`RulesPort`). Fälten nedan är de som motorn redan använder. Katalogen kommer att lagra dem, versionera dem och ge ett API för att ändra dem. Den här sidan uppdateras då.

Inställningarna ligger på två ställen:

- **Produktens skaderegler** gäller alla policyer på en produktversion: vad som ersätts, diagnosgrupper och gränsen för automatisk reglering.
- **Policyns villkor** gäller en försäkring: försäkringsbelopp, självrisk, karenstid och undantag. De kommer från produkten när policyn tecknas men kan skilja sig per policy, till exempel om kunden har valt en högre självrisk.

## Produktens skaderegler

Versioneras med produkten, till exempel `SE-HUND-2026.2`. Ett beslut sparar vilken version som användes.

| Fält | Betyder | Exempel (Sverige, hund) |
| --- | --- | --- |
| `rulesVersion` | Reglernas version | `SE-HUND-2026.2` |
| `market` | Marknaden reglerna gäller | `SE` |
| `vatReimbursable` | Ersätts momsen på veterinärfakturan? | `true` |
| `nonReimbursableCategories` | Fakturakategorier som aldrig ersätts | `food` |
| `diagnosisGroups` | Diagnoskod → diagnosgrupp. Styr självriskperioder och hur undantag tolkas. | `ORA-OTIT` → `ora`, `ORT-KORSBAND-V` → `ortopedi-bakben` |
| `autoSettleMax` | Högsta ersättning som beslutas utan handläggare | 1 000 000 (10 000 kr) |

**Diagnosgrupper** är det viktigaste valet. Två diagnoser i samma grupp delar självriskperiod, och ett undantag för en diagnos gör att andra diagnoser i samma grupp granskas. För breda grupper ger fler skador som granskas manuellt. För smala grupper ger kunden fler fasta självrisker.

## Policyns villkor för veterinärvård

| Fält | Betyder | Exempel (Bella) |
| --- | --- | --- |
| `annualLimit` | Försäkringsbelopp per försäkringsår | 6 000 000 (60 000 kr) |
| `waitingPeriodDays` | Karenstid från första tecknandet | 30 dagar |
| `deductible.fixed` | Fast självrisk | 200 000 (2 000 kr) |
| `deductible.fixedPer` | När den fasta självrisken tas ut, se nedan | `period` |
| `deductible.periodDays` | Periodens längd, när `fixedPer` är `period` | 125 dagar |
| `deductible.periodEndsAtRenewal` | Slutar perioden när försäkringsåret slutar? Se nedan. | `false` (standard) |
| `deductible.variableBp` | Rörlig självrisk i baspunkter (2500 = 25 %) | 2500 |
| `deductible.variableBpByAge` | Högre rörlig självrisk från en viss ålder | *(inte satt för Bella)* |

### Modeller för fast självrisk

| `fixedPer` | Fast självrisk tas ut | Vanligt i |
| --- | --- | --- |
| `period` | En gång per period och diagnosgrupp. Perioden börjar på första behandlingsdagen. | Norden |
| `claim` | På varje skada | Flera andra europeiska marknader |
| `policy_year` | En gång per försäkringsår, oavsett diagnos | Vissa produkter |

### Självriskperiod över förnyelse

En period kan vara öppen när försäkringen förnyas. Inställningen `periodEndsAtRenewal` avgör vad som händer då.

Exempel: Bella behandlas för öroninflammation 1 februari 2027, och en period öppnas till 6 juni. Försäkringen förnyas 1 april. 15 april kommer hon tillbaka med samma diagnos, och fakturan är på 4 000 kr.

| | `false` (standard): perioden fortsätter | `true`: perioden slutar vid förnyelsen |
| --- | ---: | ---: |
| Perioden gäller till | 6 juni 2027 | 1 april 2027 |
| Fast självrisk 15 april | 0 kr | 2 000 kr |
| Rörlig självrisk 25 % | 1 000 kr | 500 kr |
| **Ersättning** | **3 000 kr** | **1 500 kr** |

- **Standard är att perioden fortsätter.** En sjukdom ger en fast självrisk, oavsett när förnyelsen sker.
- **Villkoren när perioden öppnas avgör när den slutar.** Om inställningen eller den fasta självrisken ändras vid förnyelsen påverkas bara nya perioder.
- **Den rörliga självrisken räknas alltid per skada** med de villkor som gäller på behandlingsdagen.
- **Försäkringsbeloppet börjar alltid om** vid förnyelsen, oavsett inställningen.

*(Planerat, M3: perioden ska bara fortsätta så länge skyddet är oavbrutet, alltså genom förnyelser men inte över ett avslut, ett uppehåll eller en ny ägare. I dag är perioden knuten till djuret.)*

### Rörlig självrisk efter ålder

Exempel: 20 % som grund, 30 % från 8 år och 40 % från 10 år:

```json
"variableBp": 2000,
"variableBpByAge": [{ "fromAgeYears": 8, "bp": 3000 }, { "fromAgeYears": 10, "bp": 4000 }]
```

Åldern räknas på behandlingsdagen. Det högsta steget som gäller används.

## Undantag (klausuler)

Ett undantag gäller ett enskilt djur, till exempel *hälta höger bakben* från 12 september 2025. Det har en eller flera diagnoskoder och en giltighetstid.

- **Samma diagnoskod** som skadan: avslag.
- **Annan diagnos i samma grupp**: skadan granskas av en handläggare, som avgör om det finns ett samband.

## Två marknader i samma motor

Exempeldata innehåller också en påhittad EUR-marknad (Rex, en hund i `DE`), som visar att samma motor bär andra modeller:

| | Sverige (Bella) | EUR-exempel (Rex) |
| --- | --- | --- |
| Fast självrisk | 2 000 kr per period om 125 dagar | 50 EUR per skada |
| Moms ersätts | Ja | Nej |
| Rörlig självrisk | 25 % | 20 %, 30 % från 8 år |
| Automatisk reglering upp till | 10 000 kr | 500 EUR |

## När katalogen finns *(planerat, M2)*

- Produkter och regler versioneras. En ny version gäller nya och förnyade policyer från ett datum. Gamla beslut behåller sin version.
- Ändringar görs via API och granskas innan de publiceras.
- Referensdata (arter, raser, diagnoskoder, fakturakategorier) med översättningar.
