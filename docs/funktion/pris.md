# Pris

Premien räknas med en **tariff** (ADR 0030). En tariff är tabeller som publiceras med fyra ögon, på samma sätt som skaderegler. Den ger grundpriset. Rabatter läggs på efter grundpriset som **prisvilkor**.

Prisfunktionen, tariffer, prisvilkor, produktens koppling till dem, prisindikationen och priset vid tecknande, ändring och förnyelse är byggda.

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

## Prisvilkor: rabatter efter grundpriset

Prisvilkoren är en egen serie (`calculationModel: "price-terms.v1"`), med samma livscykel och fyra ögon som tariffen. De kan därför ändras utan att tariffen ändras, till exempel för en kampanj. Produkten pekar på dem med `priceTermsSeries`.

| Fält | Betyder |
| --- | --- |
| `groupDiscounts` | Rabatt för en policy i en grupp (ADR 0007), med `kind` (`litter`, `household` eller `any`), `fromMember` (2 betyder andra djuret och senare) och `bp`. Den bästa rabatt som passar gäller. |
| `campaigns` | Kampanjkoder med `code`, `validFrom`, eventuellt `validTo` (för termer som börjar före den dagen), `bp` och `newPoliciesOnly` (gäller inte vid förnyelse) |
| `maxTotalDiscountBp` | Tak för alla rabatter tillsammans |

Rabatterna räknas i baspunkter av grundpriset (1 000 = 10 %). En grupprabatt och en kampanj läggs ihop, men aldrig över taket. Priset blir aldrig lägre än tariffens lägsta premie. Efter rabatterna avrundas priset igen.

**Exempel:** Bellas grundpris är 4 934 kr. Med kampanjkoden `PUPPY2026` (20 %) blir det 3 947,20 kr, avrundat till 3 947 kr. Om hon också var tredje djuret i en kull skulle 15 % + 20 % = 35 % begränsas till taket 30 %.

## Produktens tariff

Produktversionen pekar på en tariffserie med `tariffSeries`. När versionen skickas till granskning kontrolleras att en tariffversion gäller när försäljningen börjar. Tariffen ska också täcka produkten:
- samma marknad och valuta
- en grundpremie för varje art och varje försäkringsbelopp i produkten
- åldersband för varje art
- en faktor för varje självriskalternativ

Om något saknas blir svaret `422` med en lista. En produkt utan `tariffSeries` prissätts för hand. En produkt kan ha `priceTermsSeries` bara om den har en tariff, och prisvillkoren ska gälla när försäljningen börjar och vara för samma marknad och valuta.

## Prisindikation

`POST /v1/quotes` (rättigheten `policies:quote`) räknar vad en policy skulle kosta, med samma tariff och funktion som tecknandet kommer att använda. Ingenting sparas.

```http
POST /v1/quotes
{
  "market": "SE", "productVersion": "SE-HUND-BAS@2026.1", "startDate": "2026-12-01",
  "animalId": "ani_bella", "policyholderPartyId": "pty_owner001",
  "vetCare": { "annualLimit": 6000000, "deductible": "standard" }
}
```

- **Djuret:** ange ett registrerat djur (`animalId`) eller uppgifterna (`animal` med `species`, `breed` och `birthDate`).
- **Orten:** ange försäkringstagaren (`policyholderPartyId`), så hämtas postnumret från adressen, eller `postalCode` direkt. Utan någon av dem gäller tariffens förvalda zon.
- **Kundens egen portal,** och andra roller bundna till försäkringar eller kliniker, anger uppgifterna och postnumret direkt. De får inte läsa djur och parter.
- **Grupp:** ange `groupId` för en grupp som djuret skulle gå med i. Då blir djuret nästa medlem. En kundportal anger i stället `group` med `kind` och `memberNo`.
- **Kampanj:** `campaignCode`. En kod som inte gäller ger `422`.
- **Svaret** har termens datum, de valda villkoren och priset med `breakdown`. Där syns grundpriset (`basePremium`) och priset efter rabatter (`annualPremium`) var för sig. Postnumret finns aldrig i svaret, bara zonen.
- **En produkt utan tariff** ger `409`.

## Priset på policyn

För en produkt med tariff räknas premien av Petvold när en policy tecknas, ändras eller förnyas. Samma funktion används som för prisindikationen.
- **Tecknande:** djurets uppgifter kommer från djurregistret och postnumret från försäkringstagarens adress. Med `groupId` går policyn med i gruppen från start och får grupprabatt. `campaignCode` ger kampanjrabatt.
- **Ändring under termen:** hela termen prissätts med de nya valen och djurets ålder vid termens början. Kampanjer gäller inte vid ändring.
- **Förnyelse:** tariffen och prisvillkoren som gäller på förnyelsedagen, djurets nya ålder och policyns plats i en grupp. Kampanjer med `newPoliciesOnly` gäller inte. Om priset inte går att räkna listas policyn under `needsDecision` med orsaken `price-not-available`.
- **Underlaget sparas** på termen (`pricing`) och på en ändring: priset med `breakdown`, tariffens och prisvillkorens versioner, `inputHash` och indata med zonen i stället för postnumret.
- **Manuellt pris:** en premie som skiljer sig från tariffens kräver rättigheten `policies:price-override` (rollen `underwriter`) och `priceOverride.reason`. Det beräknade priset sparas bredvid (`pricing.override.computedPremium`). En premie som är lika med tariffens behöver ingen motivering.
- **En produkt utan tariff** kräver premien från anroparen, som tidigare.

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

*Inte byggt än:* skatt per marknad, och simulering av tariffer och prisvilkor mot sparade priser.
