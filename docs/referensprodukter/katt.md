# Referensprodukt: kattförsäkring

Krav för en svensk kattförsäkring med veterinärvård, liv och användbarhet. Förmågorna (F1–F21) och läget finns i [översikten](README.md).

## Källor

Publicerade dokument, hämtade 2026-11-28:

- Svedea, Försäkringsvillkor Kattförsäkring, 2025-01-01 (svedea.se)
- Sveland Djurförsäkringar, Sveland Hund- och kattförsäkring, särskilt villkor 2026-05-01 (sveland.se)
- If Skadeförsäkring, Försäkringsvillkor hund- och kattförsäkring, maj 2026 (if.se)

Kraven är skrivna med egna ord. Där bolagen skiljer sig står variationen, eftersom det är den Petvold måste klara.

## Produkten i korthet

| Moment | Variation mellan bolagen |
| --- | --- |
| Veterinärvård | Årsbelopp från 40 000 till 120 000 kr i en eller flera nivåer. En nivå kan sakna moment som medicin, rehabilitering och resor. |
| Liv | Fast belopp högst marknadsvärdet. Trappas ned från 7 eller 8 års ålder och upphör mellan 10 och 13 år. |
| Användbarhet | Förlorad avelsförmåga ger halva livbeloppet eller marknadsvärdet. |
| Avel och kull | Kattungar på moderns försäkring, dolda fel efter leverans. |

## Krav

### Teckning

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-01 | Teckning från 6 veckor. Liv bara till 6 eller 7 år. | – | Konfig (teckningsregler) |
| K-02 | Äldre katt utan tidigare försäkring: veterinärintyg krävs, och tills det kommit in gäller bara olycksfall. | F8 | Utöka |
| K-03 | Katter som inte får hållas som sällskapsdjur, till exempel vildkattshybrider, tecknas inte. | – | Konfig (`breedRules`) |
| K-04 | Livförsäkring kräver id-märkning och registrering i en kattklubb eller hos Jordbruksverket. | F1 | Ny |

### Karens

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-10 | Karens för sjukdom 15 eller 20 dagar. Olycksfall utan karens. | – | Finns |
| K-11 | Ingen karens vid överflyttning från ett annat svenskt bolag med likvärdigt skydd. | F8 | Utöka |
| K-12 | Ingen karens för kattunge som tecknas inom 10 dagar från köpet och före 16 veckor eller 5 månader, med intyg högst 7 dagar gammalt. | F8 | Utöka |
| K-13 | **TR (FORL)**: hel täckning om katten varit försäkrad sedan före 2 år. Annars 12 månaders karens, och ingen täckning alls om katten tecknas efter 8 år. | F7 | Ny |
| K-14 | Kejsarsnitt och förlossning: egen karens på 60 dagar, och bara för honor äldre än 12 månader. | F7 | Ny |
| K-15 | Karens på den höjda delen när beloppet höjs. | F9 | Utöka |

### Veterinärvård

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-20 | Årsbelopp per nivå, valbart. | – | Finns |
| K-21 | Självriskperiod på 130, 135 eller 180 dagar från första behandlingen, med fast och rörlig självrisk. | – | Finns (`periodDays`) |
| K-22 | En variant utan fast självrisk: 50 % rörlig självrisk och en lägsta faktura. | F10 | Utöka |
| K-23 | **TR (FORL)** högst 10 000 kr per år. | F3 | Utöka |
| K-24 | **FIP**: behandling högst 15 000 kr per livstid. Kräver förhandsgodkännande och god prognos. | F4, F17 | Ny |
| K-25 | Rehabilitering högst 12 000 kr per år, efter plan. MR och CT högst 15 000 kr per år i grundnivån. | F3, F17 | Utöka |
| K-26 | Avlivning och kremering högst 1 500 eller 2 000 kr, utan självrisk. | F3, F10 | Utöka |
| K-27 | Utredning av en sjukdom som visar sig inte ersättas: högst 2 000 kr. | F3 | Utöka |
| K-28 | Ingen fast självrisk vid olycka när katten transporterades säkert, eller vid brand. | F10 | Utöka |
| K-29 | Kejsarsnitt: högst ett eller två per livstid beroende på nivå. | F14 | Ny |
| K-30 | Behandling utomlands i EU, EES och Storbritannien i högst ett år. Utbetalning i kronor efter kursen på skadedagen. | F21 | Ny |
| K-31 | Kattpest ersätts inte om katten inte vaccinerats enligt veterinärens råd. | F13 | Utöka |

### Krav på obruten försäkring

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-40 | Höft, armbåge, knäskål, implantat, plastikkirurgi och bettfel ersätts bara om katten varit obrutet försäkrad sedan före 120 dagar eller 5 månader. | F7 | Ny |
| K-41 | Dolda fel ersätts bara med obruten försäkring sedan samma ålder. Annars 6 eller 12 månaders karens. | F7, F16 | Ny |
| K-42 | Kvarsittande mjölktänder ersätts till 24 månader, med samma krav. | F7 | Ny |

### Raser

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-50 | **Perser och Exotic**, även blandraser med en förälder av rasen: inga ersättningar för näsa, gom och luftvägar. Hos en källa även ögon. Liv ersätts inte för dödsfall av samma orsaker. | F13 | Utöka |
| K-51 | **Scottish Fold**, även blandraser: inga ersättningar för ledsjukdomar, varken vård eller liv. | F13 | Utöka |
| K-52 | Exotiska parasitsjukdomar ersätts inte för katter som importerats utanför Norden, eller deras avkomma. | F13 | Utöka |

### Liv och användbarhet

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-60 | Livbelopp högst marknadsvärdet, styrkt med köpekontrakt och meriter. | F1 | Ny |
| K-61 | Nedtrappning med 20 % per år från 7 eller 8 år, med ett golv (4 000 eller 6 000 kr) eller ett tak efter en viss ålder. | F1 | Ny |
| K-62 | Livet upphör vid förfallodagen det år katten fyller 10, 12 eller 13. | F1 | Ny |
| K-63 | Bortsprungen katt ersätts inte. Stöld ersätts hos en källa bara vid utställning, tidigast 100 dagar efter anmälan. | F1 | Ny |
| K-64 | Obduktion kan krävas för okänd dödsorsak: ung katt, kort försäkringstid, nyligen ändrat skydd eller högt belopp. | F1, F17 | Ny |
| K-65 | Livbeloppet kan betalas i stället för fortsatt behandling när vården skulle kosta mer. | F1 | Ny |
| K-66 | **Användbarhet**: förlorad avelsförmåga ger hälften av livbeloppet eller marknadsvärdet. Bara mellan vissa åldrar, med bevisad tidigare förmåga och inte efter ett visst antal kullar eller kejsarsnitt. Efter utbetalningen undantas orsaken. | F2, F14 | Ny |
| K-67 | Ingen självrisk på liv och användbarhet. | F1 | Ny |

### Kull och dolda fel

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-70 | Kattungar på moderns försäkring från födseln, med ett eget tak per kull eller per unge, dras från moderns belopp hos en källa. | F15 | Ny |
| K-71 | Egen försäkring kan aktiveras med förvalda villkor, utan karens om den tecknas i tid. | F15, F8 | Ny |
| K-72 | Dolda fel från leveransen till 3 år och 90 dagar, upp till försäljningspriset, utan självrisk. Säljaren eller uppfödaren är först i ordningen. | F16 | Ny |
| K-73 | Uppfödarens skydd för dolda fel: högst två gånger försäljningspriset, varav högst hälften för vård. | F16 | Ny |

### Skadehantering

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| K-80 | Direktreglering med kliniken, som bolaget kan neka i ett enskilt fall. | – | Finns (design) |
| K-81 | Förhandsbesked. | – | Finns |
| K-82 | Hos en källa är kontakt med bolagets digitala veterinär före besöket ett villkor. Bolaget kan hänvisa till en klinik, och ersätter då högst vad den hade kostat. | F17 | Utöka |
| K-83 | Utbetalning senast 30 dagar efter fullständigt underlag. Kontroll mot sanktionslistor. | – | Finns (FAL-klockan) |
| K-84 | Trafikolycka: uppgifter om föraren och fordonet, eller polisanmälan. | F17 | Utöka |

## Konsekvenser för designen

- **TR och FIP** visar två nya sätt att begränsa: per år för en diagnos (F3) och per livstid för en diagnos (F4). Båda är konton i ledgern, precis som årsbeloppet.
- **Karens för en diagnos** räknas från ett annat datum än första tecknandet, och beror på djurets ålder vid teckningen (F7). Policymodulen behöver kunna svara på när djuret först blev försäkrat och om skyddet varit obrutet.
- **Rasregler** finns i teckningen men inte i skaderegleringen (F13). En rasregel ska gälla även blandraser med en förälder av rasen, så djurregistret behöver föräldrarnas ras när den är känd.
