# Referensprodukt: hundförsäkring

Ett kravunderlag som prövar om Petvolds modell räcker för en verklig produkt på den svenska marknaden. Det är inte en produkt vi ska kopiera, utan ett mått på vad modellen måste klara.

## Källa och ursprung

Underlaget bygger på publika dokument från Trygg-Hansa (filial till Tryg Forsikring A/S), hämtade från trygghansa.se:

- Villkor Hundförsäkring, 2024-06-01 (P04383_2504_T)
- För- och efterköpsinformation Hundförsäkring (MB2327_2507_T)
- Faktablad Veterinärvårdsförsäkring (PID04387_2507_T)
- Faktablad Liv- och användbarhetsförsäkring (PID04388_2507_T)

Kraven är formulerade med egna ord. Inga texter, tabeller eller raslistor är kopierade in i koden. Rasgrupper i exempeldata sätts ihop självständigt (ADR 0009).

## Produkten i korthet

| Moment | Innehåll |
| --- | --- |
| Veterinärvård | Tre nivåer med årligt försäkringsbelopp (40, 80, 120 tkr) och olika ingående moment (MR/CT, receptmedicin, cellgifter, strålning, rehabilitering, dolda fel, inackordering). |
| Liv och användbarhet | Fast belopp, högst marknadsvärdet. Död, avlivning, försvunnen hund, förlorad användbarhet eller avelsförmåga. Upphör vid 8, 10 eller 12 år beroende på ras. |
| Kull | För uppfödare. Före leverans: veterinärvård och liv per valp. Efter leverans: dolda fel upp till försäljningspriset, till 39 månaders ålder. |
| Flock | Kollektiv veterinärvård för 10–20 hundar med gemensamt belopp och gemensam fast självrisk. |

Notera: för- och efterköpsinformationen anger 7–20 hundar för flock, villkoret 10–20. Ett skäl till att dokument ska genereras ur produkten (M6).

## Krav och läge

Läge: **Finns** = klarar det i dag. **Konfig** = produktdata, ingen ny kod. **Utöka** = ny förmåga i befintlig modul. **Ny** = ny del.

### Teckning och livscykel

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-01 | Teckningsålder 6 veckor till 8 år, lägre övre gräns för vissa raser och för livmomentet. | Konfig | M4 |
| RP-02 | Prisfaktorer: ras, kön, ålder, bostadsort, valda självrisker, betalningsintervall (år, halvår, månad), fakturaavgift för papper. | Konfig | M4 |
| RP-03 | Försäkringen gäller från klockslaget för teckning om start är samma dag. | Utöka | M3 |
| RP-04 | Ettårig term med automatisk förnyelse. Uppsägning till huvudförfallodag, eller direkt när behovet upphör. Ångerrätt 14 dagar. | Utöka | M3 |
| RP-05 | Importerad hund utan svenskt veterinärintyg: gäller bara olycksfall tills intyget kommit in. | Utöka | M3 |
| RP-06 | Livmomentet upphör vid huvudförfallodagen efter en åldersgräns som beror på rasgrupp. Avslutas också när ersättning för förlorad användbarhet eller avelsförmåga betalats. | Utöka | M3 |
| RP-07 | Utebliven betalning: uppsägning, och vid återupptagande ny karens och förbehåll för det som uppstått under tiden. | Utöka | M5 |

### Karens och förbehåll

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-10 | 20 dagars karens för sjukdom. Olycksfall utan karens, men inte följdsjukdomar av fästingbett eller värmeslag. | Finns (karens), Utöka (orsakstyp) | M1 |
| RP-11 | Karensbefrielse: valp försäkrad före 12 veckor inom 10 dagar från leverans med intyg högst 7 dagar gammalt. Direkt överflyttning från annan ägare eller annat bolag efter 20 dagar där. Kull utan karens. | Utöka | M3 |
| RP-12 | Karens och förbehåll gäller bara den **höjda delen** när nivån höjs. | Utöka | M1/M3 |
| RP-13 | Förbehåll per diagnos, även med följder. Kan vara omprövningsbart. Kan föras över från tidigare avtal. | Finns (diagnos), Utöka (följder, överföring) | M1 |
| RP-14 | Utredning av en sjukdom som visar sig inte ersättas betalas fram till diagnos, med högst 2 000 kr vid diagnosbesöket. Därefter sätts ett förbehåll automatiskt. | Utöka | M1 |

### Villkor som beror på historik och ras

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-20 | Led- och skelettsjukdomar, hälsoprogram, plastikkirurgi, bettkorrigering och dolda fel ersätts bara om hunden varit oavbrutet försäkrad sedan före 4 månaders ålder (katt 5 månader). Likvärdig försäkring i annat land räknas. | Ny | M1/M3 |
| RP-21 | Saknas obruten försäkring: 12 månaders karens för vissa diagnosgrupper räknat från nyteckning. | Utöka | M1 |
| RP-22 | Friskförklarad led registrerad hos kennelklubb ger ersättning för senare problem i den leden. | Utöka | M1 |
| RP-23 | Rasgrupper med regler: undantag för övre luftvägar hos trubbnosiga raser, kejsarsnitt bara efter naturlig förlossning för vissa raser. Gäller även oregistrerade individer och blandraser. | Ny | M2 |
| RP-24 | Importerade hundar som inte är stambokförda, och deras avkomma: vissa infektionssjukdomar undantas. | Konfig | M1 |

### Ersättning för veterinärvård

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-30 | Årligt försäkringsbelopp per nivå. | Finns | – |
| RP-31 | Fast självrisk per självriskperiod och rörlig på resten. Perioden börjar vid första ersättningsbara kvittot, längd enligt försäkringsbrevet (180 dagar). | Finns | – |
| RP-32 | **Delbelopp per år och kategori**: rehabilitering, TR/FORL (katt), avlivning och kremering, obduktion, inackordering. | Utöka | M1 |
| RP-33 | **Räknare över djurets livstid**: högst två kejsarsnitt. Kräver ålder hos tiken vid förlossning och första parning. | Ny | M1 |
| RP-34 | **Egen självrisk för ett visst moment**: andra kejsarsnittet har alltid 5 000 kr plus 25 %, oberoende av pågående period. | Utöka | M1 |
| RP-35 | **Självriskbefrielse efter orsak**: rovdjur, vildsvin, trafikolycka med godkänd bur. | Utöka | M1 |
| RP-36 | **Rabatt på fast självrisk** när valpen också har kullförsäkring, i tre år från leverans. | Utöka | M1 |
| RP-37 | **Täckning efter när skadan började**: höjs beloppet under sjukdomstiden gäller det belopp som gällde när skadan uppstod. Skadan behöver ett startdatum skilt från behandlingsdatum. | Utöka | M1 |
| RP-38 | Avdrag i ordning: moms (om kunden är momsredovisningsskyldig), ej ersättningsbart, självrisk, nedsättning, skulder, ersättning från annan. | Utöka | M1/M5 |
| RP-39 | Momsplikt per kund, inte bara per marknad. | Utöka | M2 |
| RP-40 | Jouravgift bara om veterinären bedömt det som jourfall. Digitala besök ersätts. Rehabilitering bara inom Norden, inom en månad från ordination, i tolv månader per remiss. | Konfig | M1 |
| RP-41 | Utomlands: gäller i högst ett år från avresedagen. | Utöka | M1 |
| RP-42 | Underlag på svenska, skandinaviska språk eller engelska. Ingen ersättning för egen eller närståendes behandling. | Utöka | M1 |

### Liv och användbarhet

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-50 | **Fast ersättning**, högst marknadsvärdet, i stället för kostnadsersättning. | Ny | M1 |
| RP-51 | Försvunnen hund: tidigast efter en månad, polisanmälan och efterlysning krävs. Återbetalning om hunden hittas. | Ny | M1 |
| RP-52 | Förlorad användbarhet: dokumenterad användning de senaste 18 månaderna, ansökan till en viss ålder per rasgrupp. | Ny | M1 |
| RP-53 | Förlorad avelsförmåga: åldersgränser och högsta antal kullar per kön, krav på undersökningar. | Ny | M1 |
| RP-54 | Obduktion krävs under vissa villkor (ung hund, kort försäkringstid, nyligen höjt belopp eller ändrad omfattning). Ersätts med fast belopp. | Ny | M1 |
| RP-55 | Avlivning i stället för behandling om vårdkostnaden uppenbart överstiger livbeloppet, efter godkännande. | Utöka | M1 |
| RP-56 | Livbeloppet sätts efter marknadsvärde. Höjning efter meriter ger förbehåll på den höjda delen. | Utöka | M3 |

### Kull och flock

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-60 | Kullförsäkring för en hel kull född i Sverige, tik minst 20 månader. Tecknas från 1 till 12 veckors ålder. | Konfig (PolicyGroup) | M3 |
| RP-61 | **Faser per valp**: före leverans veterinärvård och liv, efter leverans dolda fel. Fasen byts vid överlåtelsen, senast vid 12 veckor. | Utöka | M3 |
| RP-62 | Dolda fel upp till försäljningspriset, till 39 månaders ålder, utan självrisk. | Utöka | M1 |
| RP-63 | **Samordning**: kullens dolda fel-skydd betalar först, köparens veterinärvård tar över när det är slut. Gäller även kullförsäkring i annat bolag. | Ny | M1 |
| RP-64 | Köparens försäkring kan ersätta det som uppstod under kulltiden om den tecknas inom 48 timmar från leverans. | Utöka | M3 |
| RP-65 | **Flock: gemensamt försäkringsbelopp och gemensam fast självrisk** för 10–20 hundar. Nytt avtal för fler hundar. | Ny | M1/M3 |

### Skadehantering

| Nr | Krav | Läge | Milstolpe |
| --- | --- | --- | --- |
| RP-70 | Förhandsbesked via veterinären. | Finns | – |
| RP-71 | Direktreglering med kliniken, med rätt att säga nej. | Finns (design) | M6 |
| RP-72 | Trafikolycka: uppgifter om förare och fordon, eller polisanmälan om föraren är okänd. | Utöka | M1 |
| RP-73 | Utbetalning senast en månad efter fullständigt underlag och beslut. Dröjsmålsränta enligt räntelagen. | Utöka | M5 |
| RP-74 | Kontroll mot sanktionslistor före utbetalning. | Ny | M5 |
| RP-75 | Nedsättning vid oriktiga uppgifter, bristande aktsamhet eller räddningsplikt. | Utöka (manuell) | M1 |

### Manuell bedömning

Följande avgörs av människor. Motorn ger ett förslag, markerar beslutet för handläggaren och sparar underlaget:

- När en sjukdom eller ett olycksfall uppstod (veterinärmedicinsk bedömning).
- Marknadsvärde och tvist om värde.
- Om något är ett dolt fel.
- Nedsättning för aktsamhet och räddningsplikt.

## Konsekvenser för designen

1. **Gruppen behöver egna konton i ledgern.** Flockens gemensamma belopp och självrisk besvarar den öppna frågan om kullbelopp: det behövs. ADR 0007 står kvar, men `PolicyGroup` får egna konton för belopp och självrisk.
2. **Skadan får ett startdatum** skilt från behandlingsdatum, och policyn slås upp på det (RP-37, RP-12).
3. **Försäkringshistorik per djur** som kan beräknas: försäkrad sedan, obruten, från vilket bolag (RP-20).
4. **Ersättningstyp i skademotorn**: kostnadsersättning och fast belopp (RP-50).
5. **Skademotorn skickar händelser som ändrar policyn**, till exempel automatiska förbehåll (RP-14) och avslutat livmoment (RP-06).
6. **Rasgrupper i referensdatan**, med blandraser (RP-23).

Punkt 1–4 bör bli ADR innan arbetet börjar.
