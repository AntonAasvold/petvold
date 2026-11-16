# Produktkonfiguration

Vad en produkt och en policy styr i skaderegleringen, och hur det ställs in.

> **Läge:** Produkter och produktversioner finns i modulen `catalog` (se [Produkter och produktversioner](#produkter-och-produktversioner)). Produktens skaderegler är versionerade regeluppsättningar i modulen `decisioning`, och produktversionen pekar på deras serie. Båda ändras via API och publiceras med fyra ögon.

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

## Regeluppsättningar

Produktens skaderegler (tabellen ovan) är en **regelserie**, till exempel `SE-HUND-VV`, med numrerade versioner (ADR 0021). Varje version har innehållet, beräkningsmodellen (`vet-care.v1`) och ett datum den gäller från.

**Livscykel:**

| Steg | Anrop | Rättighet | Gör |
| --- | --- | --- | --- |
| Utkast | `POST /v1/rule-sets/{serie}/versions` | `rules:write` | Skapar nästa version som utkast. Utkastet kan ändras med `PUT .../versions/{v}`. |
| Granskning | `POST .../versions/{v}/submissions` | `rules:write` | Låser innehållet och räknar ut kontrollsumman. |
| Tillbaka | `POST .../versions/{v}/returns` | `rules:publish` | Skickar tillbaka till utkast, med en motivering. |
| Publicering | `POST .../versions/{v}/publications` | `rules:publish` | En annan person än den som skickade till granskning. Versionen ändras aldrig efter detta. |
| Avveckling | `POST .../versions/{v}/retirements` | `rules:publish` | Används inte längre för nya bedömningar. Kräver en motivering. |

**Vilken version en skada får:** den publicerade version som har det senaste `effectiveFrom` som inte ligger efter behandlingsdatumet. Utkast och avvecklade versioner används aldrig. Två publicerade versioner i samma serie kan inte gälla från samma datum. Saknas publicerade regler för behandlingsdatumet svarar skademotorn `409`.

**Exempel:** version 1 gäller från 1 januari 2026 med `autoSettleMax` 10 000 kr. Version 2 gäller från 1 juni med 1 000 kr. En öroninflammation 4 juni på 1 500 kr bedöms då med version 2 och går till handläggare. Samma skada behandlad 30 maj hade bedömts med version 1 och beslutats automatiskt.

**Alla serier:** `GET /v1/rule-sets` (rättighet `rules:read`) listar varje serie med vad den innehåller (`claims-rules`, `tariff`, `price-terms` eller `underwriting`, se [Teckning](teckning.md)) och versionernas status.

**Simulering före publicering:** `POST /v1/rule-sets/{serie}/versions/{v}/simulations` med `{ "from": …, "to": … }` (rättighet `rules:simulate`). Versionens regler, vanligtvis ett utkast, körs mot de sparade underlagen för beslut i perioden. Det gäller varje ärendes senaste beslut, från samma serie och inom anroparens omfång. Inget sparas eller bokförs. Svaret visar:

| Fält | Betyder |
| --- | --- |
| `decisions` | Hur många beslut som simulerades |
| `changed` | Hur många som hade fått ett annat förslag, läge eller belopp |
| `modeChanged` | Hur många som hade flyttats mellan automatiskt och manuellt (`autoToManual`, `manualToAuto`) |
| `totals` | Beslutad och simulerad ersättning per valuta |
| `items` | De beslut som ändras (högst 200), med belopp före och efter |

**Exempel:** ett utkast sänker `autoSettleMax` från 10 000 kr till 1 000 kr. Simuleringen mot november visar att 1 av 2 beslut ändras: öroninflammationen på 1 500 kr hade gått till handläggare (`autoToManual: 1`), men beloppet är detsamma. Ett annat utkast som ersätter foder höjer korsbandsoperationens ersättning med 315 kr (25 % rörlig självrisk på 420 kr).

Varje beslut simuleras för sig, med den självriskperiod och det förbrukade belopp det hade. Följdeffekter mellan skador, till exempel att en ändrad självriskperiod påverkar nästa skada, simuleras inte. Ett beslut som avvek från förslaget behåller sitt utfall.

**Spårbarhet:** bedömningen visar `rulesVersion` (till exempel `SE-HUND-VV@2`) och `rulesChecksum`. Hela regelinnehållet sparas i beslutets underlag, så ett gammalt beslut räknas om med exakt de regler det fattades med, även efter att versionen avvecklats.

## Produkter och produktversioner

En produktversion säger vad som kan säljas och med vilka val (ADR 0023). Id:t är `<produkt>@<version>`, till exempel `SE-HUND-VV-LIV@2026.2`, och det är detta id som policyn sparar.

| Fält | Betyder | Exempel |
| --- | --- | --- |
| `market`, `currency` | Marknad och valuta | `SE`, `SEK` |
| `species` | Arter ur [referensdatan](referensdata.md) | `["dog"]` |
| `names` | Namn per språk | `{ "en": "Dog insurance, vet care and life", "sv": "Hundförsäkring, veterinärvård och liv" }` |
| `ruleSeries` | Regelserien skador bedöms med | `SE-HUND-VV` |
| `tariffSeries` | Tariffserien priset räknas med ([Pris](pris.md)). Utelämnad: premien anges för hand. | `SE-HUND-TARIFF` |
| `priceTermsSeries` | Prisvillkoren, alltså rabatter efter grundpriset. Bara med `tariffSeries`. | `SE-HUND-TERMS` |
| `underwritingSeries` | Teckningsreglerna för nya policyer ([Teckning](teckning.md)). Då tecknas policyn med en ansökan. Utelämnad: policyn tecknas direkt, utan frågor. Vid granskningen måste en version vara i kraft när försäljningen börjar och ha åldersgränser för varje art. | `SE-HUND-UW` |
| `salesFrom`, `salesTo` | Säljperiod, där `salesTo` är första dagen den inte säljs. Utan `salesTo` säljs den tills vidare. | `2026-01-01` |
| `vetCare.annualLimits` | Valbara försäkringsbelopp | 30 000, 60 000 och 120 000 kr |
| `vetCare.deductibles` | Valbara självrisker, var och en med kod, namn och villkor (se [Policyns villkor](#policyns-villkor-för-veterinärvård)) | `standard`: 2 000 kr per period och 25 %. `high`: 4 000 kr per period och 25 %. |
| `vetCare.defaultAnnualLimit`, `defaultDeductible` | Standardval | 60 000 kr, `standard` |
| `vetCare.waitingPeriodDays` | Karenstid | 30 dagar |
| `policy.midTermCancellation` | Kundens uppsägning under termen (ADR 0029). `term-end`: bindningstiden ut, och policyn upphör när termen slutar. `immediate`: dagen efter uppsägningen, med premien för resten av termen tillbaka. Uppsägning när behovet faller bort och ånger är alltid tillåtna. | `term-end` (förval) |
| `policy.termMonths` | Termens längd i månader, vid tecknande och varje förnyelse. Marknaden sätter taket, i Sverige 12 (FAL 3 kap. 2 §). | 12 (förval) |
| `policy.renewalLeadDays` | Dagar före förfallodagen som förnyelsen körs, 1–120 och kortare än termen. Om pris eller villkor ändras vid förnyelsen bör kunden få besked mer än en månad före förfallodagen. | 45 (förval) |
| `policy.transferAcceptanceDays` | Dagar som en ny ägare har på sig att godkänna en överlåten policy | 30 (förval) |

Inställningarna under `policy` kan utelämnas, och då gäller förvalen. De låses med resten av innehållet när versionen publiceras.

**Livscykel:**

| Steg | Anrop | Rättighet | Gör |
| --- | --- | --- | --- |
| Utkast | `POST /v1/products/{produkt}/versions` med `version`, `content`, `salesFrom` | `catalog:write` | Skapar ett utkast. Det kan ändras med `PUT .../versions/{v}`. |
| Granskning | `POST .../versions/{v}/submissions` | `catalog:write` | Låser innehållet. Arterna måste vara aktiva, och regelserien måste ha en publicerad version som gäller när försäljningen börjar. |
| Tillbaka | `POST .../versions/{v}/returns` | `catalog:publish` | Tillbaka till utkast, med motivering |
| Publicering | `POST .../versions/{v}/publications` | `catalog:publish` | En annan person än den som skickade till granskning. Ingen annan version av produkten får säljas under samma period. |
| Avsluta försäljning | `POST .../versions/{v}/sales-ends` med `salesTo` och `reason` | `catalog:publish` | Tidigast i dag och bara tidigare än ett befintligt slutdatum |

En publicerad version ändras aldrig utom slutdatumet för försäljningen. Policyer som redan har versionen behåller den, och skademotorn hittar fortfarande dess regelserie.

**Läsa:**
- `GET /v1/products` ger alla produkter med deras versioner och status (rättighet `catalog:read`), till exempel för en lista i ett gränssnitt.
- `GET /v1/products/on-sale?date=2026-11-15&market=SE&species=dog` ger versionerna som säljs den dagen. Det är högst en per produkt.
- `GET /v1/products/{produkt}/versions/{v}/vet-care-terms?annualLimit=3000000&deductible=high` ger de villkor en policy får med kundens val. Ett val som utelämnas ger standardvalet. Ett val som inte finns i produkten ger `422`.

**Exempel:** version `2026.2` säljs från 1 januari 2026. Version `2027.1` med högre självrisk ska börja säljas 1 januari 2027. Den som publicerar avslutar först försäljningen av `2026.2` till `2027-01-01` och publicerar sedan `2027.1` med `salesFrom` `2027-01-01`. Bella, som har `2026.2`, får fortfarande sina skador bedömda med regelserien `SE-HUND-VV`.

**Så hittar skademotorn reglerna:** policyns produktversion ger regelserien, och regelserien ger den version som gäller på behandlingsdatumet. Om produktversionen inte finns eller inte är publicerad svarar skademotorn `409`.

*Inte byggt än:* andra moment än veterinärvård, och pris (M4).
