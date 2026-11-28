# Referensprodukter

Referensprodukterna prövar om Petvolds modell räcker för verkliga produkter. De är kravunderlag, inte produkter att kopiera: kraven är formulerade med egna ord, och exempeldata i koden sätts ihop självständigt (ADR 0009).

| Produkt | Marknad | Källor |
| --- | --- | --- |
| [Hund](hund.md) | Sverige | Trygg-Hansa |
| [Katt](katt.md) | Sverige | Svedea, Sveland, If |
| [Häst](hast.md) | Sverige | Sveland, If |
| [Livstid och per sjukdom](uk-livstid.md) | Storbritannien | Ageas, PDSA (Pinnacle) |

## Rent ursprung

- **Bara publicerade dokument**: villkor, förköpsinformation och faktablad som bolagen själva lägger ut. Källan står i varje fil med dokumentets namn och datum.
- **Aldrig arbetsgivarens material**, inte heller publika villkor från en arbetsgivare. Det gör att det inte går att ifrågasätta varifrån kraven kommer.
- **Aldrig leverantörsmaterial** som inte är publicerat, till exempel säljmaterial eller kravlistor som bygger på det.
- **Kontrollera mot källan.** Siffrorna är hämtade ur dokumenten och sammanfattade. Läs källan innan en siffra blir testdata eller exempel.

## Förmågor

Kraven i produkterna leder till ett mindre antal förmågor i Petvold. Läget är bedömt mot `main` 2026-11-28.

**Läge:** **Finns** = klarar det i dag. **Konfig** = produktdata, ingen ny kod. **Utöka** = ny förmåga i en befintlig modul. **Ny** = ny del.

| Nr | Förmåga | Läge | Hund | Katt | Häst | UK |
| --- | --- | --- | :-: | :-: | :-: | :-: |
| F1 | **Livförsäkring som moment**: fast belopp högst marknadsvärdet, nedtrappning med ålder (procent per år, golv, avrundning) och slutålder per art eller ras | Ny | ● | ● | ● | ● |
| F2 | **Användbarhet och avelsförmåga**: hel eller delersättning (50, 75 eller 80 % av beloppet), en gång per djur, med förbehåll efteråt | Ny | ● | ● | ● | |
| F3 | **Delbelopp per år och kategori**, till exempel TR, rehabilitering, MR och CT, sjukbeslag, avlivning, ambulans | Utöka | ● | ● | ● | ● |
| F4 | **Belopp per livstid för en diagnos**, till exempel FIP | Ny | | ● | | ● |
| F5 | **Belopp per sjukdom**: per sjukdom och år, tak per sjukdom totalt, eller 12 månader från första behandlingen | Ny | | | | ● |
| F6 | **Insjuknandedag på skadan**: villkoren och beloppet som gällde när sjukdomen började, och följdskador knutna till den första | Utöka | ● | ● | ● | ● |
| F7 | **Krav på obruten försäkring sedan en viss ålder**, och karens per diagnosgrupp (TR, leder, dolda fel) | Ny | ● | ● | ● | |
| F8 | **Undantag från karens**: överflyttning, ungt djur med intyg, olycksfall, kolik, aktivering via modern | Utöka | ● | ● | ● | ● |
| F9 | **Karens och förbehåll på höjd del** när beloppet höjs | Utöka | ● | ● | ● | ● |
| F10 | **Självrisk som beror på orsaken eller momentet**: befrielse vid rovdjur och säker transport, egen självrisk för ett moment, dubbel fast självrisk | Utöka | ● | ● | ● | |
| F11 | **Rörlig självrisk efter ålder** | Finns | ● | ● | | ● |
| F12 | **Självrisk per sjukdom och år** (en fast självrisk per sjukdom och försäkringsår) | Utöka | | | | ● |
| F13 | **Rasregler i skaderegleringen**: undantag för diagnosgrupper per ras, också för blandraser med en förälder av rasen | Utöka | ● | ● | ● | ● |
| F14 | **Räknare över djurets livstid**, till exempel antal kejsarsnitt och delersättningar | Ny | ● | ● | ● | |
| F15 | **Ungt djur på moderns försäkring**: kattunge eller föl täckt från födseln, egen försäkring aktiveras inom en frist | Ny | ● | ● | ● | |
| F16 | **Dolda fel** med säljaren eller uppfödaren först i ordningen, upp till försäljningspriset | Ny | ● | ● | ● | |
| F17 | **Villkor för bevis i skadan**: diagnostisk anestesi, röntgen, journal, och krav på förhandsgodkännande (stamceller, FIP, rehabiliteringsplan) | Utöka | | ● | ● | |
| F18 | **Andra moment än vård och liv**: ansvar för hund, stöld och bortsprungen, annonsering och belöning, avbokad resa, kennel | Ny | ● | | ● | ● |
| F19 | **Marknadsprofil för Storbritannien**: GBP, ångerfrist, lagar och regler för premieskatt | Utöka | | | | ● |
| F20 | **Kodsystem för diagnoser**, så att diagnosgrupper och rasregler pekar på koder i ett namngivet kodverk | Ny | ● | ● | ● | ● |
| F21 | **Vård utomlands**: faktura i annan valuta, utbetalning i försäkringens valuta efter kursen på skadedagen | Ny | ● | ● | ● | ● |

Det som finns i dag och bär alla fyra: veterinärvård med årsbelopp, fast självrisk per period, per skada eller per år, rörlig självrisk med ålderssteg, karens från första tecknandet, diagnosgrupper, förbehåll, moms, kategorier som inte ersätts, förhandsbesked, attest, omprövning, beviskedja och teckningsregler med ålder, frågor och raser.

## Ordning

Förmågorna som flest produkter behöver och som påverkar datamodellen kommer först:

1. **F20 kodsystem** och **F6 insjuknandedag**: skadans grunddata. Båda behöver en ADR.
2. **F1 liv** och **F2 användbarhet**: ett nytt moment med egen beräkningsmodell, fast belopp i stället för kostnad (granskningen F4).
3. **F3 delbelopp**, **F4 livstid per diagnos** och **F5 per sjukdom**: samma mekanik i ledgern, konton per kategori, diagnos eller sjukdom.
4. **F7–F10 karens och självrisk**: regler i `vet-care` med fler fakta i underlaget.
5. **F13 rasregler**, **F14 räknare**, **F15–F16 unga djur och dolda fel**.
6. **F18 andra moment** och **F19 Storbritannien**, när en marknad utanför Sverige blir aktuell.
