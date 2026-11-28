# Referensprodukt: brittisk livstidsförsäkring och belopp per sjukdom

Krav för de brittiska försäkringsformerna för hund och katt: livstid, maxbelopp per sjukdom, tidsbegränsad och bara olycksfall. Förmågorna (F1–F21) och läget finns i [översikten](README.md).

## Källor

Publicerade dokument, hämtade 2026-11-28:

- Ageas, Pet Insurance Policy Wording, Bronze, Silver, Gold och Platinum, augusti 2023 (KFIS/IFL/WSB, ageas.co.uk)
- PDSA Pet Insurance, Lifetime & Time Limited Pet Insurance for Cats and Dogs, P3385 v9, mars 2026, med Pinnacle Insurance som försäkringsgivare (pdsa.org.uk)

Agria, som också säljer i Storbritannien, används inte som källa (ADR 0009).

## Fyra försäkringsformer

| Form | Beloppet gäller | Börjar om | Exempel |
| --- | --- | --- | --- |
| **Livstid** | Per år, totalt eller per sjukdom | Vid varje förnyelse | Per sjukdom och år 2 000 eller 6 000 £. Ett tak per år för alla sjukdomar, till exempel 20 000 £. |
| **Maxbelopp per sjukdom** | Per sjukdom, så länge försäkringen gäller | Aldrig | 2 000 £ per sjukdom. När beloppet är slut undantas sjukdomen. |
| **Tidsbegränsad** | Per sjukdom, i 12 månader från första behandlingen | Aldrig | Ingen ersättning för sjukdomen efter 12 månader, även om beloppet inte är slut. |
| **Bara olycksfall** | Per olycksfall, med ett tak totalt | – | 2 000 £ per olycksfall och högst 10 000 £ för ett olycksfall totalt. |

Alla fyra är **förmåga F5**: beloppet räknas per sjukdom och inte per djur och år. I Norden är det tvärtom.

## Krav

### Sjukdom som enhet

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-01 | **En sjukdom** är en skada från samma olycka, eller en sjukdom med samma diagnos eller orsak, oavsett hur många tillfällen och kroppsdelar. | F5, F20 | Ny |
| UK-02 | **Sjukdomar på båda sidor**, till exempel båda knäna eller båda höfterna, räknas som en om symtom fanns de senaste 24 månaderna eller journalen kopplar ihop dem. | F5 | Ny |
| UK-03 | **Återkommande och relaterade** sjukdomar räknas som en, både för beloppet och för undantag. | F5, F6 | Ny |
| UK-04 | **Fortsättningsskador** knyts till den första skadan och drar från samma belopp. | F5, F6 | Ny |
| UK-05 | Beloppet som gäller är det som gällde **när sjukdomen först visade symtom**, också efter en uppgradering. En högre nivå gäller bara sjukdomar som börjar efter bytet. | F6 | Utöka |

### Belopp och självrisk

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-10 | Belopp per sjukdom och år, tak per sjukdom totalt och tak per år, i alla kombinationer. Ett tak kan vara obegränsat. | F5 | Ny |
| UK-11 | Tidsbegränsad: sjukdomen ersätts i 12 månader från första behandlingen, eller tills beloppet är slut, det som kommer först. | F5 | Ny |
| UK-12 | Fast självrisk **per sjukdom och år**, i stället för per period. | F12 | Utöka |
| UK-13 | Rörlig självrisk (co-payment) från en viss ålder, till exempel 8 år för hund, 5 år för vissa raser och 10 år för katt. | F11, F13 | Finns (ålder), Utöka (ras) |
| UK-14 | Delbelopp inom beloppet: korsband, MR och CT, kompletterande behandling, tandvård vid olycka, specialfoder vid urinsten (en del av kostnaden i högst 6 månader). | F3 | Utöka |
| UK-15 | Behandling i EU högst 90 dagar per år, med hälsointyg för djuret. | F21 | Ny |
| UK-16 | Om premien inte betalas upphör rätten till fortsättningsskador. | F5 | Ny |

### Karens och tidigare sjukdomar

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-20 | Karens 14 dagar för sjukdom och 1 till 3 dagar för olycksfall. | F8 | Utöka |
| UK-21 | Ingen karens vid byte från ett annat bolag med minst 14 dagars obrutet skydd. | F8 | Utöka |
| UK-22 | Tidigare sjukdomar undantas, även om de inte fått en diagnos, och även när de kommer tillbaka. | F6 | Utöka |

### Andra moment

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-30 | **Dödsfall** genom sjukdom eller olycka: inköpspriset, eller ett schablonbelopp minus ett avdrag för ålder. Inte efter en viss ålder, som beror på art och ras. | F1 | Ny |
| UK-31 | **Stöld och bortsprungen**: inköpspriset om djuret inte hittats efter 30 eller 45 dagar. Pengarna betalas tillbaka om djuret hittas. Chipmärkning krävs. | F18 | Ny |
| UK-32 | **Annonsering och belöning**, inte till familjen. | F18 | Ny |
| UK-33 | **Ansvar för hund** mot tredje man, upp till 1–1,5 miljoner £, med en egen självrisk på 250 £. Bolaget för talan. Gäller inte om annan ansvarsförsäkring täcker. | F18 | Ny |
| UK-34 | **Kennel** när ägaren ligger på sjukhus mer än 48 timmar, och **avbokad resa** när djuret behöver livräddande vård. | F18 | Ny |
| UK-35 | Karantän och förlorade resehandlingar för djuret. | F18 | Ny |

### Teckning och avtal

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-40 | Teckning från 8 veckor. Djuret ska bo hos ägaren i Storbritannien minst 9 månader om året. | F19 | Konfig |
| UK-41 | Raser som enligt Dangerous Dogs Act inte får hållas, och vissa andra raser, tecknas inte. Inte heller hundar som används i arbete, jakt eller bevakning. | – | Konfig (`breedRules`), Utöka (användning) |
| UK-42 | Ångerfrist 14 dagar med full återbetalning om ingen skada betalats. | F19 | Utöka |
| UK-43 | Har en skada betalats ska resten av årets premie betalas vid uppsägning, utom när djuret dött eller försvunnit. | F19 | Ny (M5) |
| UK-44 | Månadsbetalare: obetald premie kan dras från en slutlig ersättning. | – | Finns (kvittning, M5) |
| UK-45 | Bolaget meddelar nya villkor minst tre veckor före förnyelsen. Tidsbegränsad försäkring kan nekas förnyelse med 90 dagars varsel. | F19 | Utöka |

### Skadehantering

| Nr | Krav | Förmåga | Läge |
| --- | --- | --- | --- |
| UK-50 | Skadan ska anmälas inom 90 dagar eller 12 månader från behandlingen. Dödsfall inom 30 dagar. | F17 | Utöka |
| UK-51 | Kliniken kan skicka skadan direkt via en portal. | – | Finns (design) |
| UK-52 | Kunden betalar själv för journalkopior som bolaget begär. | – | Konfig |

## Konsekvenser för designen

- **Sjukdomen blir ett eget objekt** (F5). I dag knyts en skada till ett djur, en diagnos och en självriskperiod. Den brittiska modellen kräver en sjukdom med en första dag, en status och skador under sig, och konton för beloppet per sjukdom. Det liknar självriskperioden men lever längre och styr beloppet.
- **Insjuknandedagen** (F6) styr både vilket belopp som gäller och om sjukdomen är undantagen. Den ska sättas av en människa när den är osäker och sparas med beviset.
- **Kodsystemet** (F20) behövs för att avgöra vad som är samma sjukdom. En diagnosgrupp räcker inte, eftersom två diagnoser i samma grupp kan vara olika sjukdomar.
- **En marknadsprofil för Storbritannien** (F19) behövs i policymodulen, som i dag bara har Sverige.
- **Ansvar** (UK-33) är en annan sorts försäkring, där bolaget reglerar mot en tredje part. Det passar inte i skademotorn för veterinärvård och bör vara en egen modul eller ligga utanför Petvold.
