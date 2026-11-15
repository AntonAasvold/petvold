# 0030. Tariff: pris som versionerad data och en ren funktion

- Status: Beslutad
- Datum: 2026-11-15

## Sammanhang

Idag anger den som tecknar, ändrar eller förnyar en policy premien själv (ADR 0029). M4 ska ge riktiga priser. Kraven:
- **Spårbart pris.** Varje pris ska gå att förklara och räkna om, som skadebeslut (ADR 0018). Det ska synas vilken tariff, vilka uppgifter och vilka steg som gav priset.
- **Ändringar som data.** Ett försäkringsbolag ändrar priser ofta, och det ska kunna göras utan en ny version av Petvold.
- **Samma pris överallt.** Det ska bli samma pris vid prisindikation, tecknande, ändring och förnyelse.
- **Pris efter marknad, art, djur och val.** Försäkringsbolag i Europa sätter vanligen priset efter art, ras, ålder, valt försäkringsbelopp och självrisk, och ibland efter var djuret bor. Det framgår av deras publika prisuppgifter.
- **Skatt per marknad.** Vissa marknader har skatt på premien, till exempel Tyskland (Versicherungsteuergesetz). Sverige har ingen sådan skatt.

Kvar att bestämma:
- var tariffen bor
- hur den är uppbyggd
- hur priset räknas och sparas
- hur rabatter och manuella priser hanteras

## Beslut

1. **Tariffen är en versionerad serie i `decisioning`, som skaderegler.**
   - Den har samma livscykel som skadereglerna i ADR 0021: utkast, granskning, publicering med fyra ögon och kontrollsumma.
   - Den gäller från ett datum (`effectiveFrom`), och den kan simuleras mot tidigare priser innan den publiceras.
   - Produktversionen pekar på en **tariffserie** (`tariffSeries`), som den pekar på en regelserie.
   - Ett pris räknas med den tariffversion som gäller på termens första dag.
2. **Uppbyggnad.** En tariff är tabeller, inte kod, och ger **grundpriset**:
   - **Grundpremie** per art och försäkringsbelopp, i minsta valutaenhet för ett år.
   - **Faktorer** i baspunkter (10 000 = 1,0) som multipliceras:
     - åldersband för djurets ålder på termens första dag
     - riskgrupp per ras, med en förvald grupp för ras som saknas eller är okänd
     - självrisk per alternativ
     - **ort:** zon per postnummerprefix, från försäkringstagarens adress, med en förvald zon för postnummer som saknas i tabellen
   - **Lägsta premie** per år.
   - **Avrundning** till hel valutaenhet, till exempel hela kronor.
3. **Rabatter är prisvilkor som läggs på efter grundpriset.**
   - Prisvilkoren är en egen versionerad serie i `decisioning`, med samma livscykel. De kan därför ändras utan att tariffen ändras, till exempel för en kampanj.
   - Exempel på villkor: andra och följande djur i samma grupp (ADR 0007), och kampanjkoder med giltighetstid.
   - Varje villkor har ett tak i procent. Villkoren tillsammans får aldrig ge ett pris under tariffens lägsta premie.
   - Produktversionen pekar på en serie med prisvilkor (`priceTermsSeries`), om den har några.
4. **Priset räknas av en ren funktion i en ny modul, `pricing-core`.**
   - Funktionen är `price(tariff, priceTerms, input) → { basePremium, annualPremium, breakdown, inputHash }`. Den har ingen I/O, inget ramverk och ingen text för användare.
   - Indata är marknad, art, ras, födelsedatum, startdag, termlängd, valt försäkringsbelopp och självrisk, postnummer, gruppens storlek och kampanjkod.
   - Grundpriset och priset efter prisvilkoren redovisas var för sig.
   - All räkning sker med heltal. Faktorerna multipliceras i BigInt, och avrundningen sker en gång på slutet, halvt uppåt. Termens premie är årspremien gånger termens dagar delat med årets.
   - `breakdown` listar varje steg med kod och värde, så att priset kan förklaras på kundens språk (ADR 0018).
5. **Ingen ålder, kön eller annan uppgift om ägaren** används i priset, utöver postnumrets zon. Zonen räknas från postnumret när priset räknas, och bara zonen sparas med priset. Uppgiftsminimering enligt GDPR artikel 5.1 c.
6. **Prisindikation utan sparat tillstånd.** `POST /v1/quotes` räknar priset för givna uppgifter och sparar ingenting. Svaret har tariffversion, kontrollsumma och `inputHash`.
7. **Tecknande, ändring och förnyelse räknar priset själva** genom en port (`PricingPort`), med samma funktion.
   - Termen eller ändringen sparar årspremien, tariffversionen, prisvillkorens version, kontrollsummorna, `inputHash` och `breakdown`. Priset kan alltid räknas om och jämföras, som ett skadebeslut.
   - Förnyelsen räknar ett nytt pris med den tariff som gäller på förnyelsedagen och djurets nya ålder. Om priset ändras syns det i händelsen `policy.renewed`, så att kanalen kan meddela kunden i tid. Förnyelsens framförhållning i produkten (ADR 0029) ger den tiden.
8. **Manuellt pris** kräver en egen rättighet, `policies:price-override`, och en motivering. Det sparas tillsammans med det beräknade priset, så att skillnaden syns.
9. **Skatt på premien** ligger i marknadsprofilen (ADR 0029), med källa. Tariffens priser är utan skatt, och skatten läggs på och visas för sig. Sverige har ingen skatt.
10. **Teckningsregler** (åldersgränser, raser som inte försäkras, hälsofrågor och förbehåll) får en egen ADR. De hör ihop med priset men inte med tariffen.

## Konsekvenser

- Priser ändras genom en ny tariffversion med fyra ögon, utan kod.
- Varje pris går att förklara, räkna om och simulera, på samma sätt som skadebeslut.
- Policymodulen slutar ta emot premien från anroparen, utom med `policies:price-override`.
- Produktversioner behöver `tariffSeries`. Befintliga produkter utan den fortsätter att ta premien från anroparen, så att inget går sönder.
- Zon efter ort kräver försäkringstagarens adress, som finns i partmodulen. Den läses via en port. En försäkringstagare utan postnummer får tariffens förvalda zon.
- Att priset beror på ort bör framgå av förköpsinformationen till kunden.
- En tariff i tabellform kan inte uttrycka alla modeller, till exempel kurvor eller interaktioner mellan faktorer. Om det behövs blir det en ny beräkningsmodell med ett eget namn, som beräkningsmodellerna i skademotorn.

## Alternativ

- **Tariff som kod per produkt:** flexibelt, men varje prisändring blir en ny version av Petvold, och kontrollen med fyra ögon försvinner.
- **Tariffen i produktversionen:** då kräver en prisändring en ny produktversion, och befintliga policyer kan inte få nytt pris vid förnyelse utan att byta produktversion. Priser ändras oftare än produkter, och av samma skäl ligger skaderegler utanför produkten (ADR 0021).
- **Ett externt prissystem:** möjligt via `PricingPort`, men då förlorar Petvold kopplingen mellan pris och underlag.
- **Flyttal och avrundning per steg:** enklare att skriva, men ger öresfel som syns vid omräkning.

## Källor

- GDPR artikel 5.1 c, om uppgiftsminimering. eur-lex.europa.eu
- Versicherungsteuergesetz (VersStG), Tyskland, om skatt på försäkringspremier, som exempel på skatt per marknad. gesetze-im-internet.de
- ADR 0007, 0018, 0021, 0023 och 0029.
