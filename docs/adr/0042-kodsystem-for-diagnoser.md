# 0042. Kodsystem för diagnoser

- Status: Föreslagen
- Datum: 2026-11-28

## Sammanhang

Diagnoskoden är en av de viktigaste uppgifterna i en skada. Den styr diagnosgrupp, självriskperiod, förbehåll och undantag, och snart också karens för en viss diagnos, delbelopp och rasregler ([referensprodukterna](../referensprodukter/README.md), förmåga F20). Teckningen använder samma koder för hälsofrågor och förbehåll.

I dag är koden en fri sträng som produktens regler hittar på, till exempel `ORA-OTIT` och `ORT-KORSBAND-V`. Det fungerar i exempeldatan men inte i en installation:

- **Kliniken använder ett annat kodverk.** I Sverige finns Jordbruksverkets diagnoskoder och behandlingsorsaker, som kliniker redan rapporterar med. I Storbritannien används VeNom, och internationellt SNOMED CT. En kod som Petvold hittar på måste översättas för hand.
- **Ingen kontroll.** En felstavad kod blir en okänd diagnos (`DIAGNOSIS_KNOWN` ger granskning), och det syns först i skadan.
- **Ingen art.** Samma sjukdom har olika koder för hund, katt och häst i Jordbruksverkets listor.
- **Ingen historik.** Kodverken ändras: koder läggs till, slås ihop och avvecklas. Ett gammalt beslut måste kunna räknas om med den kod det fattades på (ADR 0018).
- **Brittiska produkter behöver veta vad som är samma sjukdom** (förmåga F5), vilket kräver att koderna kommer från ett kodverk med en känd struktur.

ADR 0022 lade arter, raser och kön i `catalog` som referensdata och sa att diagnoskoder skulle bli en ny sort. Men ett kodverk skiljer sig från en raslista: det ägs av någon annan, har tusentals koder, kommer i utgåvor och har egna koder med versaler som `AA0258`.

## Beslut

1. **Ett kodverk är ett eget begrepp i `catalog`**, skilt från referensdatan i ADR 0022. Det har ett id (`se-sjv`, `venom`, `snomed-ct`, `local`), ett namn, en ägare, en adress till källan och villkoren för att använda det.

2. **En diagnos identifieras av kodverket och koden tillsammans**, till exempel `se-sjv:AA0258`. Koden är exakt som i källan, med versaler och tecken, så att kliniken kan skicka den den redan har. Petvold hittar inte på egna koder för ett externt kodverk.

3. **Kodverket läses in i utgåvor.** En utgåva har källans version eller datum, filens kontrollsumma, vem som läste in den och när. Inläsningen visar vad som tillkommer, ändras och försvinner innan den sparas.
   - En kod tas aldrig bort. En kod som saknas i en ny utgåva avvecklas (`retiredIn`) men går fortfarande att läsa, så att gamla skador och beslut visas rätt.
   - En kod som byter innebörd i källan avvecklas, och den nya innebörden får en ny post i stället för att skriva över den gamla.
   - Varje kod har sina namn per språk (BCP 47), som i ADR 0022.

4. **En kod kan gälla vissa arter** och kan ha en förälder i kodverkets struktur, till exempel en grupp av virusinfektioner hos hund. Strukturen används för sökning och förslag till diagnosgrupper, aldrig direkt av reglerna.

5. **Skadan sparar kodverket och koden** (`diagnosis: { system, code }`). Fältet `diagnosisCode` med en sträng finns kvar som kodverket `local`, så att befintliga regler, skador och beslut fungerar som förut. En skada med en kod som saknas i kodverket eller inte gäller djurets art tas emot, men regeln `DIAGNOSIS_KNOWN` ger granskning med ett nytt skäl.

6. **Reglerna pekar på koder i ett namngivet kodverk.** Produktens `diagnosisGroups`, förbehåll, teckningens frågor och kommande rasregler använder `system:kod`. En regeluppsättning anger vilka kodverk den använder, och granskningen kontrollerar att varje kod finns i en inläst utgåva.

7. **Mappning mellan kodverk är egen data**, till exempel från Jordbruksverkets kod till en lokal grupp eller till SNOMED CT. En mappning har en version och en typ av likhet (samma, bredare, smalare). Den används för att hitta diagnosgruppen, men skadan behåller alltid koden som kliniken skickade. Beslutets underlag sparar både koden och mappningens version, så att omräkningen ger samma resultat (ADR 0018).

8. **Petvold levererar bara kodverk som får spridas fritt.** Jordbruksverkets listor är publicerade av en svensk myndighet och blir det första kodverket. VeNom kräver tillstånd från VeNom Coding Group, och SNOMED CT och AAHA:s termer kräver licens. Dem läser en installation in själv, under sin egen licens. Varje kodverk visar sina villkor, och Petvold kontrollerar inte licensen.

9. **Fyra ögon för en ny utgåva och för mappningar.** De påverkar beslut direkt, till skillnad från raslistan (ADR 0022 punkt 6). En annan person än den som läste in utgåvan publicerar den, och först då kan regler och skador använda den. En regeluppsättning som pekar på en avvecklad kod får en varning vid granskningen men publiceras ändå, eftersom gamla skador kan behöva den.

## Första kodverket: Jordbruksverket

Kodverket `se-sjv` byggs på Jordbruksverkets *Lista över behandlingsorsaker* med bokstavskoder (till exempel `AA0258` Parvovirusinfektion) och de tresiffriga diagnoskoderna som alias, per art. Listan har också koder för orsaker, till exempel skadad av björn eller varg, som passar självriskbefrielse efter orsak (förmåga F10).

Inläsningen behöver Jordbruksverkets fil. Den läses in med ett skript i repot, som tolkar listan och skriver en utgåva via API:et. Filen ligger inte i repot. Skriptet hämtar den från Jordbruksverket eller läser en lokal kopia, och sparar källans adress och kontrollsumma i utgåvan.

## Konsekvenser

- Kliniker kan skicka den kod de redan har, och Petvold vet vilket kodverk den kommer från.
- Reglerna blir kontrollerbara: en kod som inte finns upptäcks vid granskningen och inte i skadan.
- Befintliga skador, beslut och regler fungerar oförändrade som kodverket `local`. Exempeldatan kan flyttas till `se-sjv` i en senare PR.
- Teckningens hälsofrågor kan föreslå koder ur kodverket i stället för fritext.
- En ny tabell för kodverk, utgåvor, koder och mappningar i `catalog`. Det blir tusentals rader per kodverk, så sökningen behöver index på namn per språk.
- Grunden för förmåga F5 (samma sjukdom) finns, men vad som räknas som samma sjukdom avgörs i en egen ADR.

## Alternativ

- **Diagnoser som en ny sort i referensdatan (ADR 0022):** koderna måste då följa mönstret med små bokstäver och bindestreck, och det finns inga utgåvor. Kliniker skulle behöva översätta.
- **Bara lokala koder, och mappning vid kanten:** varje kanal och klinikintegration måste översätta, och beslutet visar inte koden kliniken skickade.
- **SNOMED CT som enda kodverk:** heltäckande men licensierat, och svenska kliniker använder Jordbruksverkets koder.
- **Fritext med maskinell tolkning:** går inte att styrka i ett beslut (ADR 0018).

## Källor

- Jordbruksverket, *Lista över behandlingsorsaker* och *Baslista alla tresiffriga diagnoskoder*, med listor per djurslag. jordbruksverket.se
- VeNom Coding Group, *Veterinary Nomenclature*, förvaltad av brittiska veterinärskolor. Koderna lämnas ut efter tillstånd. Se även Royal Veterinary College, VetCompass. rvc.ac.uk
- AAHA, *Problem and Diagnosis Terms*, kopplade till SNOMED CT, under licens. aaha.org
- SNOMED International, *SNOMED CT*.
- IETF BCP 47, *Tags for Identifying Languages*.
- ADR 0018, 0021, 0022 och 0031. [Referensprodukterna](../referensprodukter/README.md), förmåga F5, F10 och F20.
