# Roadmap

Mål: kunna teckna en hundförsäkring och reglera en skada från början till slut, i en marknad, med alla delar i Petvold. Sedan katt, häst och en EUR-marknad.

## Nu

**M0 – Grund**
- [x] Skademotorn med kontrakt, tester och Postgres-schema
- [x] Arbetssätt, roadmap, ADR och CI
- [x] Gemensam kärna i kod: `Money`, `Market`, `DateRange` (`modules/common`)
- [ ] Gemensamma kontraktsdelar: `Money`, `Ref`, problem+json, sidindelning
- [x] Lokal miljö med Postgres (docker compose), dbmate och databastester i CI

**M1 – Skademotorn på riktig lagring**
- [x] `ClaimsStore` mot Postgres (klarar den gemensamma sviten)
- [x] Outbox i samma transaktion som ärendet och beslutet, med relä
- [x] Dev-servern på Postgres
- [x] Gemensam testsvit för `ClaimsStore` (lager 4) och databastester (lager 6)
- [x] Beviskedja per beslut (ADR 0018): underlag och motorns version sparas med beslutet
- [x] Motivering krävs när beslutet avviker från förslaget
- [x] Omräkning av sparade beslut, och scenarier som data (lager 3) som räknas om i CI
- [x] Förklaring per beslut och begäran om mänsklig prövning
- [x] Integrationstester mot Postgres
- [x] Behörighet (ADR 0016): rättigheter i kontraktet, omfång per marknad och klinik
- [x] Beslutsförslag, beslut och attest som kedja, med beloppsgränser och fyraögonsprincip (ADR 0019). Ett beslut som höjer ersättningen ger en utbetalningsorder (händelse). Själva betalningen kommer med betalningsmodulen i M5.
- [x] Reserv: bokas i ledgern när ärendet går till handläggare och löses upp när beslutet bokas.
- [x] Gränser och roller som konfiguration per installation, ändringsbara via API med historik (ADR 0020)
- [ ] Fyra ögon för ändringar av rollinställningen

## Nästa

**M2 – Produkt och djur**
- [x] Beslutsmotorn `decisioning` (ADR 0018, 0021): regelserier och versioner i databasen, publicering med fyra ögon, kontrollsumma i beviskedjan. Skademotorn läser regler från modulen.
- [x] Simulering av regelutkast mot sparade underlag
- [x] Referensdata i `catalog` (ADR 0022): arter, raser och kön med översättningar och historik
- [x] Produkter och produktversioner i `catalog` (ADR 0023): säljperiod, villkorsalternativ, regelserie och publicering med fyra ögon. Skademotorn hittar regelserien via produktversionen.
- [ ] `assess` och `calculate` flyttas till `decisioning-core`
- [x] Djurregister (ADR 0024): djur, id-nummer och ägarskap med giltighetstid
- [x] Uppslagning av djur för kliniker, styrd per djur (ADR 0025)
- [x] Kullar i djurregistret (ADR 0027)
- [x] Parter (ADR 0026): personer och organisationer, personnummer som aldrig visas, och historik. Roller ägs av modulen som har relationen.
- [x] Djurregistret kontrollerar att ägaren finns som part, i djurets marknad
- [x] ADR om gallring och anonymisering av personuppgifter (ADR 0028)
- [x] Anonymisering med fyra ögon, begäran om radering och begränsning (ADR 0028)
- [x] Gallring enligt ADR 0028: lagringstider per marknad, relationer från djurregistret, gallringskörning och omkörning efter återställning

**M3 – Policy**
- [x] ADR om policyns livscykel: tecknande, ändring, förnyelse, avslut och överlåtelse, med legala ramar per marknad (ADR 0029)
- [x] Tecknande med term, bitemporala versioner och transaktion. Skademotorn läser policyer från modulen.
- [x] Ändring av val under termen, med premiejustering för resten av termen
- [x] Förnyelse:
  - [x] förnyelsekörning före förfallodagen, med framförhållning och termlängd per produkt
  - [x] ny term med den produktversion som säljs, och lista för beslut när det inte går
  - [ ] nytt pris och ny prövning (åldersgränser, nya undantag): kommer med tariff och teckningsregler (M4)
  - [x] händelse `policy.renewed`, som kanalen använder för att meddela kunden
- [x] Avslut:
  - [x] kundens uppsägning, med bindningstiden ut eller direkt med premie tillbaka (produktinställning)
  - [x] ånger inom ångerfristen
  - [x] bolagets uppsägning, och vid utebliven betalning
  - [x] djuret dött eller sålt
  - [x] avslutsdatum bakåt i tiden (bitemporalt)
  - [x] reversering av avslut
  - [x] händelse `policy.cancelled`
  - [x] avslut som alltid är tillåtna oavsett produkt: ånger och när försäkringsbehovet faller bort
- [x] Överlåtelse vid försäljning och förslag till avslut vid dödsfall, från djurregistrets händelser
- [x] Omprövning av skador när en policyversion ersätts
- [x] Policyer och skador rapporterar partens relationer till gallringen (ADR 0028)
- [x] PolicyGroup: kull och hushåll, med medlemskap över tid och utträde vid försäljning (ADR 0007)
- [ ] Teckna en hel kull i ett anrop, med en policy per djur och en kullgrupp
- [ ] Ändring i fel ordning (en ändring registreras bakåt i tiden efter en senare ändring, ADR 0006)
- [ ] Självriskperiod och försäkringsbelopp över termgränsen

**Före första kund** (från [granskningen 2026-11-15](granskning/2026-11-15-arkitektur-och-funktion.md))
- [x] Kompositionsrot för drift: `server.ts` utan exempeldata, med relä för händelser (A1, A5)
- [x] Inloggning med JWT och OIDC mot försäkringsbolagets identitetstjänst (A2)
- [x] "I dag" i marknadens tidszon (A3)
- [x] Markörbaserad sidindelning på alla listor, enligt ADR 0002 (A4)
- [x] Listor för ett gränssnitt: ärenden med arbetsköer, produkter och regelserier
- [x] Inför ett gränssnitt: `GET /v1/me`, CORS, rikare exempeldata och `AGENTS.md`
- [x] Godkännande av villkoren sparas vid tecknande (F3), ADR 0031
- [x] ADR om dokument och meddelanden till kunden: förköpsinformation, villkor, försäkringsbrev, besked om förnyelse och uppsägning (F2), ADR 0032
- [x] Produktens dokument med kontrollsumma, och godkännandet anger vilka som visades (ADR 0032)
- [x] Meddelandemodulen `communications`: kundmeddelanden från policyhändelserna, rapporter om utskick och kö (ADR 0032)
- [x] Meddelanden, del 3: erbjudande om överlåtelse, bolagets texter per marknad (prövning av beslut, avsändare, sista dag för "snarast") och typer som kan stängas av (ADR 0032)
- [x] Konventioner för API-kontraktet, kontrollerade i CI (ADR 0034)
- [x] Rätta adresserna enligt konventionerna (ADR 0034)
- [x] Gå igenom dokumentationen: inaktuella texter, arkitekturen för alla moduler, arkiv för `status.md` och kontroll av länkar
- [x] ADR om leverans av händelser till bolagets system: webhooks med prenumerationer, signatur, CloudEvents och AsyncAPI (ADR 0008, granskningen C1), ADR 0033
- [x] Webhooks, steg 1: modulen `webhooks`, prenumerationer, kö och arbetare, med händelser om policyer, ansökningar och förslag (ADR 0033)
- [x] Webhooks, steg 2: skador, djur, meddelanden och AsyncAPI-kontraktet (ADR 0033)
- [x] Webhooks, steg 3: död post, skicka igen och avstängning (ADR 0033)
- [x] ADR om ett gränssnitt för handläggare och back office, ADR 0035
- [x] Back office, steg 1: grunden, `<pv-data-grid>` och skadornas köer
- [x] Back office, steg 2: beslut, attest och prövning
- [x] Back office, steg 3: policyer och ansökningar
- [x] Back office, steg 4: meddelanden och webhooks
- [x] Back office, steg 5a: inställningar för roller och gränser, gallring och meddelanden
- [x] Back office, steg 5b: produkter och regler med fyra ögon
- [x] Designsystemet Petvold: tokens, tema för Web Awesome, typsnitt och riktlinjer
- [x] Back office enligt designsystemet, PR 1: toppraden och menyn med räknare
- [x] Back office enligt designsystemet, PR 2: skadeärendet med beslut i en egen spalt, och `routing` i bedömningen
- [x] Back office enligt designsystemet, PR 3: `<pv-waterfall>` och `<pv-event-log>`
- [ ] Livförsäkring som moment, eller ändrat namn på exempelprodukten (F4)

**Skadeprocessen hela vägen** (före M5)
- [x] Registrera skada i back office, med förhandsbedömning innan den sparas
- [x] [ADR 0036](adr/0036-skadeprocessen.md) om skadeprocessen
- [x] Skadenummer och id från servern
- [x] Lägen, återkallelse och avvisning
- [x] Komplettering från kund eller klinik, med påminnelse, utgång och `basisCompleteAt` (FAL 7 kap. 1 §)
- [x] Rättelse med revisioner
- [ ] Bilagor som referenser till bolagets arkiv
- [ ] Skadebesked och meddelanden om komplettering (ADR 0032)
- Utbetalningen kommer med betalningsmodulen i M5.

**Körningar** (före steg 3 i skadeprocessen)

I dag finns förnyelse, gallring och utgång av ansökningar och förslag bara som anrop som något utanför Petvold måste starta. Ingen historik sparas. Reläet och webhook-arbetaren går med ett fast intervall som inte går att se eller ändra.
- [x] [ADR 0037](adr/0037-korningar.md) om körningar
- [x] Schemaläggare i servern med lån i en tabell, och historik över körningar: start, slut, resultat med antal, fel och vem eller vad som startade den (ADR 0037, steg 1)
- [x] Reläet bakom ett lån, med döda poster som sparas (steg 2)
- [x] API och back office: lista över körningar med nästa och senaste körning, historik, "Kör nu", paus med spår, och reläets döda poster med "Skicka igen" (steg 3)
- [x] Schema som går att ändra med fyra ögon, `job.failed` och larm i `/healthz` (steg 4)
- [ ] Back office: reläets och webhook-arbetarens kö och eftersläpning
- [x] Påminnelser och utgång för komplettering (skadeprocessen, steg 3) som en körning bland de andra

**Back office: det som saknas** (inventering 2026-11-18: back office använder 68 av API:ets 115 operationer)
- [x] **Policy:** teckna med prisindikation och kundens godkännande, ändra, säga upp, ångra en uppsägning och förnya för hand
- [ ] **Policy:** ögonblicksbild och policyns sida enligt designsystemet
- [x] **Ansökan:** registrera en ansökan med hälsofrågorna, och se vad svaren skulle ge
- [x] **Djur:** sök, registrera och rätta djur, id-nummer, ägarbyte, historik och kullar
- [x] **Parter:** sök, registrera och ändra personer och organisationer, id-nummer, historik och begäran om radering
- [x] **Radering (ADR 0028):** begära radering av en part och kön för radering med fyra ögon
- [x] **Grupper (ADR 0007):** kull och hushåll, med medlemmar och utträde
- [ ] **Referensdata (ADR 0022):** arter, raser och kön med översättningar och historik
- [x] **Produkter och regler:** formulär för produkter och skaderegler, med JSON som alternativ, och en sammanfattning av vald version
- [ ] **Regler:** formulär för tariffer, prisvillkor och teckningsregler, och simulering av regelutkast mot sparade underlag
- [ ] **Skador:** omräkning av ett sparat beslut (ADR 0018) och försäkringsbeloppet som återstår på policyn
- [ ] **Översikt:** en startsida med köerna, körningarna och det som fastnat

**Dokument**
- [ ] ADR om dokument: skapande och ett enkelt arkiv
- [ ] Dokumentskapande med [Gotenberg](https://gotenberg.dev) (MIT) i en egen container, bakom en port. Mallarna är HTML/CSS med designsystemets tokens, versionerade per marknad och språk med kontrollsumma, och ger PDF/A och PDF/UA. Gotenberg har LibreOffice inbyggt, så Word-mallar (till exempel med docxtemplater) kan läggas till senare utan att containern byts. Carbone valdes bort på grund av licensen (Carbone Community License).
- [ ] Ett enkelt dokumentarkiv: lagring med kontrollsumma, visning via adresser som inte går att gissa och som slutar gälla, åtkomst efter rättighet och gallring enligt ADR 0028
- [ ] Bilagor till skador laddas upp från back office till arkivet (ADR 0036)

**M4 – Pris och teckning**
- [x] ADR om tariffen (ADR 0030)
- [x] Prisfunktionen (`pricing-core`) och tariffserier i `decisioning`
- [x] Produktversionen pekar på en tariffserie som täcker den
- [x] Prisindikation utan sparat tillstånd (`POST /v1/quotes`)
- [x] Prisvilkor: grupprabatt och kampanjkoder efter grundpriset, med tak
- [x] Priset vid tecknande, ändring och förnyelse, med underlaget sparat på termen, och manuellt pris med egen rättighet
- [ ] Simulering av tariffer och prisvilkor mot sparade priser
- [x] Teckningsregler och manuell prövning (F1), ADR 0031
  - [x] Teckningsregler som serie och den rena funktionen `underwriting-core`
  - [x] Ansökan med godkännande (F3), förbehåll på termen och produktens `underwritingSeries`
  - [x] Kö och beslut för manuell prövning, återkallelse och utgång
- [ ] Rabatter som regler

## Senare

**M5 – Pengar**
- Premieåterbetalning vid avslut och ny premieplan vid förnyelse.
- Distribution och provision (ny ADR):
  - vem som sålde en policy: försäkringsbolagets egen kanal, en säljare eller ett ombud (förmedlare), sparat på tecknandet och på varje förnyelse
  - provisionsavtal per förmedlare och produkt, versionerade som tariffen: andel av premien första året och vid förnyelse, eller fast belopp
  - provision räknas på premien när den betalas, och återtas per dag vid ånger och avslut
  - redovisning till förmedlaren, och krav på information om ersättning enligt lagen om försäkringsdistribution (2018:1219) och IDD (EU 2016/97)
- Betalningsmodul (ADR 0017): porten `PaymentProvider`, tillståndsmaskin, fake-adapter och gemensam testsvit.
- Betalintegrationer, en adapter per tjänst:
  - Stripe (kort, sparat kort)
  - Swish (betalning och utbetalning)
  - Open banking (PSD2, betalningsinitiering)
  - Autogiro (Bankgirot)
  - SEPA Direct Debit
  - Bankfil ISO 20022 (`pain.001`, `camt.054`)
- Utbetalning av ersättning från skademotorn. Obetald, förfallen premie kvittas först om villkoren tillåter det, och kvittningen syns i utbetalningsordern och i förklaringen till kunden.
- Billing: premieplaner, fakturor, påminnelser, tillgodohavande och utebliven betalning.
- Ledger för premier och betalningar, med bokföringsperioder som skärs på bokföringsdatum och dagsavslut. En stängd period ändras aldrig: en rättelse bokas i en öppen period.

**M6 – Stöd**: dokument, utskick med preferenser, ärenden, interaktionslogg, klinikintegration.

**Händelser utåt**: CloudEvents-kuvert och AsyncAPI när det finns en mottagare utanför Petvold (ADR 0008). Varje händelse bär ärendets id och ett spårnings-id (W3C Trace Context), så att allt som hänt i ett ärende kan följas över moduler.

**Insikt – läsmodell för portföljen**: en egen modul som bara läser händelser och kan byggas om genom att spela upp dem. Den visar till exempel automatiseringsgrad, andel avvikelser, tid till utbetalning och prövningar. Belopp läses ur ledgern, och modulen håller inga egna. Kärnan ändras inte.

**M7 – Drift**: Kubernetes med CloudNativePG, observabilitet, säkerhetskopiering, DORA-anpassning. Volymprov med genererade portföljer (tusentals försäkringar och skador) mot Postgres, med mål för svarstid och genomströmning.

## Öppna frågor

- Kvittning av premie mot ersättning: när villkor och lag tillåter det per marknad, och om kunden ska kunna välja bort det. Utreds med källor i ADR:n för utbetalning.

- Licens: stängd, källkod tillgänglig eller öppen källkod?
- Gemensamt försäkringsbelopp för en kull.
- Överlåtelseregler per marknad.
- Självriskperiod över förnyelse: konfigurerbart per produkt (`periodEndsAtRenewal`, standard är att perioden fortsätter). Kvar: perioden ska bara fortsätta så länge skyddet är oavbrutet, inte över avslut, uppehåll eller ny ägare.
- Retroaktivt avslut när ersättning redan är betald för tiden efter avslutet: återkrav, avräkning mot premieåterbetalning eller avskrivning?
- Premieåterbetalning vid avslut: per dag eller enligt produktens regel, och vid ånger?
- Moln och klientlager.

## Källor för punkter som lagts till 2026-11-14

Punkterna om kvittning, bokföringsperioder, spårnings-id, läsmodell och volymprov är allmän praxis. De bygger på publika källor och inte på något annat systems material (ADR 0009).

- Bokföringslag (1999:1078): löpande bokföring, verifikationer och att bokförda uppgifter inte får ändras utan att ändringen dokumenteras.
- W3C Trace Context (W3C Recommendation). w3.org/TR/trace-context
- CloudEvents 1.0, tillägget *Distributed Tracing*. github.com/cloudevents/spec
- Martin Fowler: *CQRS* (2011) och *Event Sourcing* (2005). martinfowler.com
- Kvittning: allmänna civilrättsliga regler och försäkringsvillkoren. Exakta lagrum per marknad fastställs i ADR:n innan det byggs.
