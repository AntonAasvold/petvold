# Policyer

En policy försäkrar ett djur. Den har en försäkringstagare, en produkt och hela sin historik. Besluten bakom finns i ADR 0006, 0007 och 0029.

Policyer kan tecknas, ändras, förnyas, överlåtas och avslutas, och ett avslut kan återkallas. När ett djur säljs eller dör i djurregistret får policyn ett förslag.

## Vad en policy har

| Del | Betyder | Ändras |
| --- | --- | --- |
| Policy | `id`, marknad, djur och `inceptionDate` (första dagen, som karenstiden räknas från) | Aldrig |
| Term | En försäkringstid, högst ett år, med produktversion, valt försäkringsbelopp och självrisk, villkor för veterinärvård och premie | Aldrig. En ändring under termen sparas som en egen rad på termen, och en förnyelse ger en ny term. |
| Version | Försäkringstagare och status för en giltighetstid, och när den blev känd | Ersätts av nya versioner, men finns kvar i historiken |
| Transaktion | Varje ändring, med steg, vem och när | Aldrig |

## Två tidsaxlar

Varje version har två tidsaxlar:
- **giltighetstid:** de dagar den gäller
- **registreringstid:** när Petvold fick veta det

Därför går det alltid att svara på vad som gällde en viss dag, och vad som var känt vid en viss tidpunkt. Skademotorn bedömer en skada mot den version som gällde på behandlingsdagen. Historiken visar också ändringar som registreras i efterhand, till exempel ett byte av försäkringstagare som gäller från ett tidigare datum (ADR 0029).

## Teckna en policy

`POST /v1/policies` med djur, försäkringstagare, produktversion, startdag, val, premie och kundens godkännande (`acceptance`).

En produkt med teckningsregler (`underwritingSeries`) tecknas inte så. Den kräver en ansökan med svar på hälsofrågorna, `POST /v1/applications`, och `POST /v1/policies` svarar `422`. Se [Teckning](teckning.md#ansökan).

Petvold kontrollerar att:
- djuret finns i marknaden och lever
- försäkringstagaren finns i marknaden och inte är begränsad eller anonymiserad (ADR 0028)
- produktversionen säljs på startdagen, i marknaden och för djurets art
- valen finns i produkten. Ett utelämnat val ger produktens förval.
- premien är i produktens valuta
- godkännandet har en kanal och en tid som inte ligger i framtiden
- **startdagen inte ligger före dagen för tecknandet**
- **djuret inte redan har en policy** för någon av dagarna (`409`)

Termens längd kommer från produkten (`policy.termMonths`, förval 12 månader). Den får inte vara längre än marknaden tillåter, i Sverige ett år (FAL 3 kap. 2 §). Transaktionen går igenom stegen utkast, prissatt, riskbedömd och utfärdad. **Premien** räknas med produktens tariff ([Pris](pris.md#priset-på-policyn)). För en produkt utan tariff anger anroparen den. Steget riskbedömd visar om teckningsregler prövades och vilken version som godkände.

**Kundens godkännande (ADR 0031).** `acceptance` har kanalen (till exempel `web`, `app`, `phone` eller `paper`), en referens om kanalen har en, till exempel ett sessions-id eller en signering, och tiden då kunden godkände. Petvold lägger till tiden då anropet kom fram, och sparar godkännandet på transaktionen (`issue.acceptance`). Tiden från kanalen får ligga högst fem minuter efter Petvolds klocka, eftersom klockorna kan skilja sig åt. Godkännandet gäller produktversionen och priset i svaret. Förköpsinformationen och villkoren som visades sparas när dokument finns (F2).

## Ändra val under termen

`POST /v1/policies/{id}/changes` med `from`, nya val (`vetCare.annualLimit` och `vetCare.deductible`), `premium` och `reason`. Kunden kan till exempel byta till högre självrisk eller ett högre försäkringsbelopp mitt i året.
- **Från i dag eller senare**, aldrig bakåt i tiden.
- **Bara i den senaste termen.** Om policyn redan har förnyats görs ändringen från den nya termens början.
- **Valen ska finnas i termens produktversion.**
- **Premien gäller en hel term med de nya valen.** Dagarna som är kvar räknas med den nya premien, och `change.premiumAdjustment` visar vad ändringen kostar (positivt) eller ger tillbaka (negativt) för resten av termen. Premien anges av anroparen tills tariffen finns (M4).
- **Termen ändras inte.** Ändringen sparas med termen, och versionerna från ändringsdagen pekar på den. Skademotorn bedömer skador före dagen med de gamla valen och skador från dagen med de nya.
- **Förnyelse** behåller de ändrade valen och premien.
- **Avslut senare** räknar premien tillbaka med den premie som gällde för varje dag.

**Exempel:** Anna betalar 3 650 kr om året. 1 juni byter hon till högre självrisk för 2 920 kr om året. 183 av termens 365 dagar är kvar, så hon får tillbaka 366 kr.

## Förnyelse

En policy förnyas på samma villkor om ingen har sagt upp den (FAL 3 kap. 4 §).

**Förnyelsekörningen** (`POST /v1/renewal-runs`, rättigheten `policies:renew`) är tänkt att köras varje dag med rollen `renewal-job`. Den går igenom policyer vars term slutar inom produktens `renewalLeadDays` (förval 45 dagar) och skapar nästa term för var och en:
- Termen börjar dagen den förra slutar och är `termMonths` lång.
- Produktversionen är den version av samma produkt som säljs den dagen.
- Försäkringsbeloppet och självrisken är samma som förut.
- Premien är samma som förut, tills tariffen finns (M4).
- `inceptionDate` ändras inte, så karenstiden börjar inte om.

Med `"dryRun": true` visas vad som skulle hända utan att något sparas.

**Det som inte förnyas:**
- **Avslutade policyer.** Policyer med ett avslut som gäller vid termens slut, till exempel kundens uppsägning med bindningstiden ut, räknas under `cancelled`.
- **Policyer som behöver ett beslut.** De listas under `needsDecision` med orsak:

| Orsak | Betyder |
| --- | --- |
| `product-not-on-sale` | Ingen version av produkten säljs på förnyelsedagen |
| `option-not-offered` | Den nya versionen saknar försäkringsbeloppet eller självrisken |
| `species-not-covered` | Den nya versionen gäller inte djurets art |
| `term-too-long` | Den nya versionens term är längre än marknaden tillåter |
| `animal-died` | Djuret har dött |
| `policyholder-unavailable` | Försäkringstagaren finns inte, är begränsad eller anonymiserad |

**Förnya för hand:** `POST /v1/policies/{id}/renewals`, med `productVersion` och `premium` om de ska vara andra än förvalen. Den används för policyer som körningen har listat under `needsDecision`.

**Uppsägning efter förnyelsen:** om kunden säger upp till termens slut efter att förnyelsen har körts, avslutas den nya termen från början och hela dess premie betalas tillbaka.

**Exempel:** Rex policy gäller till 1 december 2027. Den 17 oktober, 45 dagar före, förnyar körningen den till 1 december 2028 med den produktversion som säljs då. Om Anna redan har sagt upp till termens slut, förnyas den inte.

## När djuret säljs eller dör

Djurregistret skickar händelser när ett djur byter ägare (`animal.ownership_changed`) och när det dör (`animal.died`). Policymodulen gör om dem till **förslag** för den policy som gäller den dagen. En händelse som kommer två gånger ger bara ett förslag.

**Försäljning: förslag om överlåtelse (ADR 0029).** Samma policy byter försäkringstagare från försäljningsdagen, när den nya ägaren har godkänt villkoren.
- Förslaget har en **sista dag** (`deadline`): försäljningsdagen, eller i dag om den är senare, plus produktens `transferAcceptanceDays` (förval 30 dagar).
- **Godkänn:** `POST /v1/policy-proposals/{id}/acceptances` med `channel` (till exempel `web` eller `phone`) och eventuellt `reference`, till exempel en signering.
  - Policyn får nya versioner. Den förra ägaren står som försäkringstagare före försäljningsdagen, och den nya från den dagen.
  - Historiken visar båda, och med `knownAt` syns vad som var känt före bytet.
  - Karenstid, självriskperioder och förbrukat försäkringsbelopp följer policyn.
  - Premien för dagarna efter försäljningen flyttas: den förra ägaren får tillbaka den, och den nya ska betala den (M5).
- **Avböj:** `POST /v1/policy-proposals/{id}/rejections` med `reason`. Policyn avslutas från försäljningsdagen, eftersom behovet föll bort då.
- **Ingen svarar:** `POST /v1/proposal-expiry-runs`, som är tänkt att köras varje dag, avslutar policyer vars förslag inte godkändes senast sista dagen.

**Dödsfall: förslag om avslut.**
- **Godkänn:** policyn avslutas från dödsdagen, med premie tillbaka.
- **Avböj:** om dödsfallet registrerades på fel djur ändras inget.

`GET /v1/policy-proposals?status=pending` visar obesvarade förslag, äldst först.

**Exempel:** Anna säljer Rex till Bo 1 juni 2027 och registrerar det 10 juni. Policyn får ett förslag med sista dag 10 juli. Bo godkänner villkoren på webben 12 juni. Bo är då försäkringstagare från 1 juni, och premien för 1 juni till 1 december flyttas från Anna till Bo.

## Grupper för kull och hushåll

En **grupp** samlar policyer för en kull eller ett hushåll (ADR 0007). Gruppen har en försäkringstagare, som har alla medlemmarnas policyer så länge de är med. Senare får gruppen en gemensam faktura (M5) och grupprabatt (M4). Gruppen påverkar aldrig skaderegleringen, eftersom varje djur har sin egen policy.

- **Skapa:** `POST /v1/policy-groups` med `market`, `kind` (`litter` eller `household`) och `holderPartyId`. En kull har också `litterId` ur djurregistret.
- **Lägga till:** `POST /v1/policy-groups/{id}/members` med `policyId` och eventuellt `from`. Förval är i dag, eller policyns start om den är senare.
  - Gruppens försäkringstagare måste ha policyn den dagen.
  - En policy är med i en grupp i taget (`409`).
- **Ta bort:** `POST /v1/policy-groups/{id}/members/{policyId}/ends` med `reason` och eventuellt `to`.
- **När djuret säljs** och den nya ägaren tar över policyn lämnar policyn gruppen från försäljningsdagen. Det sker i samma transaktion som överlåtelsen. Den nya ägaren kan sedan lägga policyn i en egen grupp.
- **Historiken** syns i `members`, där varje medlemskap har `from` och `to`.

**Exempel:** Kennel Exempel försäkrar en kull på fem valpar och samlar dem i en kullgrupp. När valp 3 säljs 1 mars lämnar den gruppen den dagen, och de andra fyra är kvar.

## Avsluta en policy

`POST /v1/policies/{id}/cancellations` med `reason`, och vid behov `receivedOn` (dagen uppsägningen kom fram, eller skickades av bolaget, förvalt i dag), `effectiveDate` och `note`. Skälet styr från vilken dag policyn upphör. Reglerna kommer från marknadsprofilen, alltså lagen, och från produktens inställning.

| Skäl | Upphör | Regel i Sverige |
| --- | --- | --- |
| `customer-term-end` | När termen slutar. Inget ändras nu, men policyn förnyas inte. | Alltid tillåtet (FAL 3 kap. 3 §) |
| `customer-immediate` | Dagen efter uppsägningen, eller ett senare `effectiveDate`. Premien för resten av termen betalas tillbaka. | Bara om produkten har `midTermCancellation: immediate` |
| `withdrawal` | Dagen efter, eller från start om policyn inte börjat gälla | Inom 14 dagar från tecknandet (distansavtalslagen 3 kap. 13 §) |
| `need-ceased` | Från `effectiveDate`, även bakåt i tiden, till exempel dagen djuret dog. Kräver `note`. | Alltid tillåtet (FAL 3 kap. 6 §) |
| `insurer-term-end` | När termen slutar | Bolaget säger upp minst en månad före (FAL 3 kap. 3 §) |
| `insurer-breach` | 14 dagar efter att uppsägningen skickades. Kräver `note`. | Bara vid grovt åsidosättande eller synnerliga skäl (FAL 3 kap. 7 §) |
| `unpaid-premium` | 14 dagar efter att uppsägningen skickades | FAL 5 kap. 2 § |

**Det här händer:** de versioner som gällde från upphörandedagen ersätts. Den del som gällde före dagen finns kvar som aktiv, och resten blir en version med status `cancelled`. Skademotorn ser då att policyn är avslutad på de dagarna. Det som var känt före avslutet går fortfarande att se med `knownAt`.

**Premie tillbaka:** `refund` är termens premie per dag för de dagar som inte längre gäller, avrundat till närmaste öre (FAL 5 kap. 6 §). Utbetalningen görs av betalningsmodulen (M5).

**Ett tidigare avslut gäller redan:** ett nytt avslut som börjar samma dag eller senare ger `409`. Ett tidigare avslut är fortfarande möjligt, till exempel om djuret dör under uppsägningstiden.

**Återkalla ett avslut:** `POST /v1/policies/{id}/reinstatements` med `cancellationId` och `note`. Det går bara om avslutet är policyns senaste transaktion, till exempel om ett dödsfall registrerades på fel djur. De ersatta versionerna gäller då igen, och premien tillbaka återkallas.

**Skador omprövas.** När versioner ersätts, till exempel vid ett avslut bakåt i tiden, en överlåtelse eller en återkallelse, omprövar skademotorn varje skada vars senaste beslut fattades på en ersatt version. Om underlaget har ändrats blir det ett nytt automatiskt beslut, och ledgern bokför bara skillnaden. Om Rex dog 1 mars och en skada från 10 mars redan var ersatt, avslås den vid omprövningen, och utbetalningen bokas tillbaka. Om avslutet återkallas omprövas skadan igen och godkänns.

**Händelser:** varje ändring skriver händelser i samma transaktion: `policy.issued`, `policy.changed`, `policy.renewed`, `policy.transferred`, `policy.cancelled` (med upphörandedag och premie tillbaka), `policy.reinstated` och `policy.version_superseded` för varje ersatt version. En ansökan ger `application.received` och sedan `application.accepted`, `application.referred` eller `application.declined`. `policy.issued` har ansökans id när policyn kom från en ansökan. Dev-servern skriver ut dem i loggen.

**Exempel:** Rex dör 1 mars 2027, och Anna hör av sig 20 mars. Kundservice skickar `{ "reason": "need-ceased", "effectiveDate": "2027-03-01", "note": "Djuret har dött" }`. Policyn upphör från 1 mars, och premien för 1 mars till 1 december betalas tillbaka. En skada på Rex efter 1 mars avslås, eftersom policyn är avslutad.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/policies` | `policies:write` | Tecknar en policy på en produkt utan teckningsregler |
| `POST /v1/applications` | `policies:write` | Ansökan på en produkt med teckningsregler ([Teckning](teckning.md#ansökan)) |
| `GET /v1/applications?status=referred` | `policies:read` | Ansökningar. `referred` är kön för manuell prövning. |
| `GET /v1/applications/{id}` | `policies:read` | En ansökan med underlaget |
| `GET /v1/application-questions?productVersion=…&species=…` | `policies:quote` | Hälsofrågorna att ställa |
| `POST /v1/policies/{id}/changes` | `policies:write` | Ändrar valen från en dag under termen |
| `POST /v1/policies/{id}/renewals` | `policies:write` | Förnyar en policy för hand |
| `POST /v1/renewal-runs` | `policies:renew` | Förnyelsekörningen |
| `POST /v1/policies/{id}/cancellations` | `policies:write` | Avslutar en policy |
| `POST /v1/policy-groups` | `policies:write` | Skapar en grupp för kull eller hushåll |
| `GET /v1/policy-groups?holderPartyId=…` | `policies:read` | Grupper för en försäkringstagare. Det går också att använda `policyId`. |
| `POST /v1/policy-groups/{id}/members` | `policies:write` | Lägger till en policy |
| `POST /v1/policy-groups/{id}/members/{policyId}/ends` | `policies:write` | Tar bort en policy från en dag |
| `GET /v1/policy-proposals` | `policies:read` | Förslag efter försäljning och dödsfall |
| `POST /v1/policy-proposals/{id}/acceptances` | `policies:write` | Godkänner ett förslag |
| `POST /v1/policy-proposals/{id}/rejections` | `policies:write` | Avböjer ett förslag |
| `POST /v1/proposal-expiry-runs` | `policies:renew` | Avslutar policyer vars överlåtelse inte godkändes i tid |
| `POST /v1/policies/{id}/reinstatements` | `policies:write` | Återkallar det senaste avslutet |
| `GET /v1/policies?animalId=…` | `policies:read` | Policyer för ett djur. Det går också att använda `policyholderPartyId`. |
| `GET /v1/policies/{id}` | `policies:read` | Policyn med termer och gällande versioner |
| `GET /v1/policies/{id}/history` | `policies:read` | Alla versioner, även ersatta, och alla transaktioner |
| `GET /v1/policies/{id}/snapshot?date=…&knownAt=…` | `policies:read` | Policyn som skademotorn ser den en viss dag, enligt vad som var känt vid `knownAt` |

## Exempel

**Anna tecknar en försäkring för Rex:**

```http
POST /v1/policies
{
  "market": "SE", "animalId": "ani_rex", "policyholderPartyId": "pty_anna",
  "productVersion": "SE-HUND-VV-LIV@2026.2", "startDate": "2026-12-01",
  "vetCare": { "annualLimit": 3000000, "deductible": "standard" },
  "premium": { "amount": 480000, "currency": "SEK" },
  "acceptance": { "channel": "web", "reference": "sess-8f2c", "acceptedAt": "2026-11-15T09:58:00Z" }
}
```

Svaret har en term från 1 december 2026 till 1 december 2027 (slutdagen räknas inte), med 30 000 kr i försäkringsbelopp och premien 4 800 kr.

**Vad skademotorn ser 1 mars 2027:** `GET /v1/policies/{id}/snapshot?date=2027-03-01`.

## Vem ser vad

- `policy-registrar` tecknar policyer och skickar ansökningar, till exempel säljkanalen eller kundservice.
- `underwriter` ser kön för manuell prövning. Besluten kommer i nästa steg.
- `handler` och `approver` kan läsa.
- `customer-channel` ser bara policyerna i sin token.
- Alla ser bara policyer i sina marknader. Kliniker ser inga policyer.

## Lokalt

Dev-servern lägger in Bellas policy `pol_bella` första gången, med ägaren `pty_owner001` och förbehållet för hälta. Lenas tre ansökningar på `SE-HUND-PLUS@2026.1` finns också, en med varje utfall (se [Utvecklingsmiljö](../teknik/utvecklingsmiljo.md)). Exemplet har bara den gällande termen. Token `dev-seller` tecknar policyer. Skademotorn läser policyerna från modulen.

*Inte byggt än:* nytt pris vid förnyelse och ändring (M4), ny karenstid för ett höjt försäkringsbelopp, grupprabatt (M4), gemensam faktura (M5), och att teckna en hel kull i ett anrop.
