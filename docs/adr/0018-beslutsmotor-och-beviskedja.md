# 0018. Beslutsmotor som egen modul, med beviskedja för varje beslut

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Petvold ska kunna reglera skador automatiskt. Då måste varje beslut gå att styrka i efterhand, för kunden, för försäkringsbolaget, för revisorer och för tillsynsmyndigheten. Det gäller både *vad* som beslutades och *varför*, även flera år senare och efter att regler och kod har ändrats.

Det som finns i dag:
- Varje beslut sparar bedömningen: alla regler som prövats med utfall och skäl, hela beräkningen, regel-, produkt- och policyversion, vem som beslutade och när.
- `inputHash` är en kontrollsumma över underlaget.
- Bedömningen (`assess`) är en ren funktion i `claims-core`. Samma underlag ger alltid samma resultat.

Det som saknas:

1. **Underlaget sparas inte, bara kontrollsumman.** Vi kan visa *att* underlaget var detsamma, men inte *vad* det var.
2. **Reglerna finns bara som exempeldata i koden.** Det går inte att visa vad en regelversion innehöll vid ett visst beslut.
3. **Motorns version sparas inte.** Om beräkningen rättas syns det inte vilken kod som räknade ett gammalt beslut.
4. **Ett gammalt beslut kan inte räknas om** för att visa att resultatet blir detsamma.
5. **En handläggare kan gå emot förslaget utan motivering.**
6. **Effekten av en regeländring kan inte simuleras** mot historiska ärenden innan den publiceras.
7. **Rätten till mänsklig prövning är inte uttalad.** GDPR artikel 22 ger den som berörs av ett automatiskt beslut rätt till mänsklig prövning, att framföra sin synpunkt och att bestrida beslutet. Artikel 13–15 ger rätt till meningsfull information om logiken bakom.

## Beslut

### En egen modul, inte en egen tjänst

Beslutsmotorn blir modulen `decisioning` i monoliten (ADR 0001):

- **`decisioning-core`** (ren kod): regelutvärdering och beräkning. `assess` och `calculate` flyttas hit från `claims-core`.
- **`decisioning`**: regeluppsättningar med livscykel, eget schema och eget API.

`claims-core` styr flödet och anropar motorn via en port. Motorn kan senare paketeras som fristående tjänst, till exempel framför ett befintligt skadesystem, utan att logiken ändras. Spårbarheten beror på vad som sparas, inte på var motorn körs.

### Regler som versionerad data, beräkning i kod

- **Konfigurationen styr parametrar och vilka regler som gäller:** diagnosgrupper, kategorier som inte ersätts, moms, gränser för automatisk reglering, självriskmodeller och undantagslogik.
- **Beräkningen är kod** med egenskapstester (ADR 0012). Pengamatematik skrivs inte i konfiguration.
- **Beräkningsmodeller versioneras i koden.** En regeluppsättning anger vilken modell den använder (till exempel `calculationModel: "vet-care.v1"`). En rättelse blir en ny modell. En gammal modell tas aldrig bort så länge beslut som bygger på den ska kunna räknas om.

### Livscykel för regeluppsättningar

`draft → review → published → retired`

- **Publicering kräver en andra person** (fyraögonsprincipen, ADR 0016).
- **En publicerad version ändras aldrig.** Den får en kontrollsumma över innehållet, och beslut refererar till version och kontrollsumma.
- **En version gäller från ett datum** per produktversion. Gamla beslut behåller sin version.

### Beviskedja per beslut

Varje beslut sparar, i samma transaktion som beslutet:

| Del | Innehåll |
| --- | --- |
| Underlag | Ärendet med fakturarader, policyutdraget som användes, öppen självriskperiod, förbrukat belopp före, och tidpunkten för vad som var känt (`knownAt`) |
| Regler | Regelversion och kontrollsumma för innehållet |
| Motor | Beräkningsmodell, Petvolds version och commit |
| Resultat | Bedömningen: regler med utfall och skäl, beräkningen, förslag och läge (automatiskt eller manuellt) |
| Beslut | Utfall, belopp, vem, när, och motivering om beslutet avviker från förslaget |

`inputHash` beräknas över det sparade underlaget och reglernas kontrollsumma, så att sambandet går att kontrollera.

### Avvikelse kräver motivering

- Ett beslut som avviker från förslaget kräver en skälkod och en fritext.
- Rätten att avvika är en egen rättighet (`claims:override`, ADR 0016).
- Avvikelser kan följas upp per handläggare och per regel.

### Omräkning

- **Omräkning av ett sparat beslut** (`POST /v1/claims/{id}/decisions/{seq}/replays`): sparat underlag, sparade regler och sparad beräkningsmodell körs igen, och svaret visar om resultatet är identiskt. Inget bokförs.
- **I CI:** ett urval av sparade beslut (scenarierna i lager 3) räknas om vid varje ändring. Om resultatet skiljer sig stoppas bygget, tills ändringen har blivit en ny beräkningsmodell.

### Simulering

`POST /v1/rule-sets/{version}/simulations` kör ett regelutkast mot historiska ärenden i en period. Svaret visar vilka beslut som hade ändrats och hur mycket. Inget sparas eller bokförs. Simuleringen är ett underlag i granskningen före publicering.

### Förklaring och mänsklig prövning

- **Förklaring per beslut** (`GET /v1/claims/{id}/decisions/{seq}/explanation`): huvudskälet, alla regler och beräkningen, på kundens språk. Svaret är byggt av skälkoderna, så samma förklaring kan visas för kund, handläggare och revisor.
- **Begäran om mänsklig prövning:** en kund kan begära att ett automatiskt beslut prövas. Ärendet går då till en handläggare, och prövningen blir ett nytt beslut i samma kedja.
- **Automatiska beslut märks** som automatiska i beslutet och i händelsen.

### Lagring och personuppgifter

Underlaget innehåller personuppgifter. Det sparas så länge beslutet måste kunna styrkas. Gallringstiden ställs in per installation. Efter gallring finns beslutet och kontrollsummorna kvar, men inte underlaget.

## Konsekvenser

- Ett beslut kan styrkas utan att någon behöver lita på koden som körs i dag.
- Varje beslut tar mer plats i databasen (underlaget som JSON). Det är acceptabelt för skadevolymer.
- Gamla beräkningsmodeller måste underhållas i koden. Det är priset för att kunna räkna om.
- Att flytta `assess` och `calculate` till `decisioning-core` är en ren omflyttning. Testerna följer med.

**Införs i två steg:**

*M1, före attestkedjan:*
1. Underlaget och motorns version sparas med varje beslut (migration).
2. Motivering krävs när beslutet avviker från förslaget.
3. Omräkning av ett sparat beslut, och scenarier som data som räknas om i CI.
4. Förklaring per beslut och begäran om mänsklig prövning.

*M2, med produktkatalogen:*

5. Modulen `decisioning` med regeluppsättningar i databasen, livscykel och publicering med fyra ögon.
6. Kontrollsumma för regelinnehållet i beviskedjan.
7. Simulering av regelutkast.

## Alternativ

- **Beslutsmotorn som egen tjänst:** ett nätverksanrop i varje bedömning, versioner som kan glida isär och mer drift per installation. Det ger ingen bättre spårbarhet. Kan bli aktuellt senare som paketering.
- **DMN-beslutstabeller (OMG-standard):** affärssidan kan läsa och ibland skriva regler, men det kräver en tolk och gör pengamatematiken svårare att testa. Kan bli ett format för en del av konfigurationen senare.
- **En färdig regelmotor (till exempel GoRules ZEN eller Drools):** snabbare början för regler som affärssidan skriver, men beviskedjan, omräkningen och pengamatematiken måste ändå byggas runt den.
- **Bara spara kontrollsumman, som i dag:** visar att underlaget inte ändrats, men inte vad det var.

## Källor

- Europaparlamentets och rådets förordning (EU) 2016/679 (GDPR), artikel 13.2 f, 14.2 g, 15.1 h och 22. eur-lex.europa.eu
- Europeiska dataskyddsstyrelsen (tidigare artikel 29-gruppen), *Guidelines on Automated individual decision-making and Profiling* (WP251 rev.01). edpb.europa.eu
- OMG, *Decision Model and Notation (DMN)*. omg.org/dmn
- GoRules ZEN Engine (öppen källkod). github.com/gorules/zen
- Martin Fowler, *Event Sourcing* och *Audit Log* (om att kunna återskapa tillstånd och beslut). martinfowler.com
