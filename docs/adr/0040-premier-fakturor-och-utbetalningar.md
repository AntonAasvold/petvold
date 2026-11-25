# 0040. Pengar: premieplaner, fakturor, inbetalningar, utbetalningar och bokföring

- Status: Beslutad
- Datum: 2026-11-21

## Sammanhang

Petvold kan teckna, prissätta, ändra och avsluta en policy, och skademotorn kan besluta om ersättning. Men inga pengar rör sig:

- Termen har en premie (ADR 0030), men ingen faktura skickas och ingen betalning tas emot.
- Ett avslut räknar ut premien som ska tillbaka (`policy.cancelled` med `refund`), en ändring vad den kostar (`premiumAdjustment`) och en överlåtelse vad den förra ska få tillbaka och den nya betala. Ingen tar emot händelserna.
- Ett beslut ger en utbetalningsorder (`claim.payout_ordered`, ADR 0019). Ingen betalar ut den.
- Bolagets uppsägning för obetald premie finns som skäl (`unpaid-premium`), men inget vet att premien är obetald.

ADR 0017 bestämmer hur pengar flyttas: en modul `payments` med porten `PaymentProvider` och en adapter per betaltjänst. Den lämnar tre frågor öppna: vilken adapter först, om ersättning går till kund eller klinik, och hur Autogiro ansluts. Kvar att bestämma är också allt som inte handlar om att flytta pengar:

- vad kunden är skyldig och när (premieplan och faktura)
- hur en betalning kopplas till det den betalar
- vad som händer när kunden inte betalar
- hur ändringar, avslut och överlåtelser blir pengar tillbaka eller mer att betala
- hur allt bokförs, och vad som lämnas till bolagets ekonomisystem

**Lagen (Sverige, försäkringsavtalslagen 2005:104, FAL):**
- **Första premien** ska betalas inom fjorton dagar från att bolaget skickade premieavin, men aldrig före försäkringstidens början (5 kap. 1 §).
- **Obetald premie:** bolaget får säga upp försäkringen. Uppsägningen gäller fjorton dagar efter att den skickades, om premien inte betalas inom den tiden (5 kap. 2 §, se också ADR 0029).
- **Förtida upphörande:** bolaget har bara rätt till premie för den tid försäkringen gällde (5 kap. 6 §). Vid ånger på distans gäller samma sak, i proportion (distansavtalslagen 2005:59, 3 kap. 20 §).
- **Dröjsmålsränta** får tas ut från förfallodagen enligt räntelagen (1975:635) 6 §, och en påminnelseavgift bara om den avtalats i förväg (lagen 1981:739 om ersättning för inkassokostnader m.m., 2 §).
- **Bokföring:** bokföringslagen (1999:1078) kräver löpande bokföring med verifikationer, och att en bokförd uppgift inte ändras utan att ändringen dokumenteras (5 kap.). Räkenskapsinformation sparas i sju år (7 kap. 2 §).

Andra marknader har motsvarande regler. Precis som avslutsreglerna i ADR 0029 ligger de i marknadsprofilen, med källor.

## Beslut

### 1. Tre moduler, var och en med ett eget schema

| Modul | Äger | Får veta via |
| --- | --- | --- |
| **`billing`** | Betalarkonton, premieplaner, fakturor, kreditnotor, tillgodohavanden, påminnelser och obetalt | Händelser från `policies`, `payments` och `claims` |
| **`payments`** (ADR 0017) | Inbetalningar, medgivanden, utbetalningar och mottagarens betaluppgifter | Beställningar från `billing` och händelser från `claims` |
| **`accounting`** | Verifikationer, konton, perioder och dagsavslut | Händelser från `billing`, `payments` och `claims` |

- Modulerna läser aldrig varandras tabeller (ADR 0001). De reagerar på händelser från outboxen, med samma relä som `communications` och `webhooks`, och varje modul sparar vilka händelser den har behandlat, så att en händelse som kommer två gånger bara ger en effekt.
- Skademotorns egen ledger (försäkringsbelopp, reserv och skuld per ärende) ligger kvar i `claims`. `accounting` är bolagets bokföring av pengarna och ersätter den inte.
- Den rena räkningen ligger i **`billing-core`**: premieplanen, fördelningen av en betalning och avräkningen vid avslut. Funktionerna har ingen I/O, och samma indata ger alltid samma resultat (ADR 0018).

### 2. Betalarkontot

- **En betalare per policy, i en marknad och en valuta.** Betalaren är försäkringstagaren, och kontot skapas när den första policyn tecknas.
- Kontot har **betalsätt**: faktura, autogiro eller direktdebitering, Swish eller sparat kort.
- **Betalningsintervallet väljs per policy** (år, halvår, kvartal eller månad). Produkten anger vilka intervall som får väljas, vilket som är förvalt (`billing.paymentIntervals`, `billing.defaultPaymentInterval`) och en eventuell avgift per delbetalning (`billing.installmentFee`). Det valda intervallet sparas på tecknandet och kan ändras.
- **Alla policyer för samma betalare hamnar på samma faktura** (ADR 0007: en faktura för en grupp), också när de har olika intervall.
- Ett byte av betalsätt eller intervall gäller från nästa term, eller från nästa delbetalning om produkten tillåter det.

### 3. Premieplanen

- **`policy.issued` och `policy.renewed` ger en premieplan för termen.** Planen delar termens premie i delbetalningar efter intervallet.
  - Delningen sker med heltal i minsta enhet. Resten efter divisionen läggs på den första delbetalningen, så att summan alltid är exakt termens premie.
  - Varje delbetalning har en period (från och till), en förfallodag och ett belopp.
  - Förfallodagen är periodens första dag. För den första premien gäller marknadsprofilens regel (i Sverige fjorton dagar efter att fakturan skickades, men aldrig före termens början).
- **Skatt på premien** (ADR 0030, punkt 9) är en egen rad med satsen från marknadsprofilen. Sverige har ingen sådan skatt.
- **En plan ändras aldrig.** En ändring blir en ny plan som ersätter den förra från ett datum, med en hänvisning till händelsen som orsakade den. Varje plan sparar underlaget och `billing-core`-versionen, så att den kan räknas om och jämföras.

### 4. Ändring, avslut, återkallelse och överlåtelse

Policymodulen räknar redan beloppen per dag. `billing` räknar ut vad det betyder mot det som **faktiskt är fakturerat och betalt**.

- **`policy.changed`** med positiv `premiumAdjustment` fördelas på termens kvarvarande delbetalningar. Om inga finns kvar blir det en egen faktura. En negativ justering blir en kredit.
- **`policy.cancelled`**: termens premie minskas med `refund`.
  - Delbetalningar som inte fakturerats tas bort, och fakturerade men obetalda krediteras.
  - Om det som redan betalats är mer än den nya premien blir skillnaden ett tillgodohavande.
  - Om det är mindre står resten kvar som skuld.
- **`policy.reinstated`** återställer planen från händelsen `refundReversed`.
- **`policy.transferred`**: den förra betalaren krediteras `premium`, och den nya får en plan från försäljningsdagen med samma belopp.
- **Premie tillbaka räknas per dag**, också vid ånger. Det är lagens regel (FAL 5 kap. 6 §, distansavtalslagen 3 kap. 20 §), och den är redan byggd i policymodulen. En produkt kan inte ange en sämre regel.

### 5. Fakturor

- **Faktureringen är en körning** (ADR 0037). Varje dag samlar den delbetalningar som förfaller inom framförhållningen (`billing.invoiceLeadDays`, förval 20 dagar) till **en faktura per betalarkonto och valuta**. Fakturans förfallodag är den tidigaste delbetalningens.
- Fakturan har ett **fakturanummer** ur en nummerserie per marknad, som skadenumren (ADR 0036). Den har också en **betalningsreferens** med kontrollsiffra (OCR i Sverige, RF-referens enligt ISO 11649 i EUR-marknader), så att en inbetalning kan kopplas till fakturan utan manuellt arbete.
- **En faktura ändras aldrig.** En rättelse är en **kreditnota** som hänvisar till fakturan.
- Fakturan skickas som ett meddelande (ADR 0032) av typen `invoice`. Med `documentMaker: petvold` gör Petvold PDF:en (ADR 0038). Med autogiro eller sparat kort är meddelandet ett besked om dragningen.
- Händelser: `invoice.issued`, `invoice.paid`, `invoice.overdue` och `invoice.credited`.

### 6. Inbetalningar

- **`billing` beställer en dragning** av `payments` på förfallodagen för konton med autogiro, direktdebitering eller sparat kort. Med faktura väntar `billing` på att kunden betalar.
- **`payment.succeeded`** med betalningsreferensen kopplas till fakturan. En betalning fördelas på den äldsta förfallna skulden först.
- **En överbetalning** blir ett tillgodohavande. Det dras av på nästa faktura, eller betalas tillbaka om kunden ber om det eller om kontot inte har fler fakturor.
- **En inbetalning som inte går att koppla**, till exempel utan referens eller med fel referens, hamnar i kön **Okopplade inbetalningar**. En handläggare kopplar den eller betalar tillbaka den.
- **En återförd dragning** (till exempel ett autogiro som studsar) öppnar fakturan igen.

### 7. Obetald premie

Varje steg är en körning, och varje tidsgräns är en inställning med förval från marknadsprofilen:

1. **Påminnelse** när fakturan är förfallen (`billing.reminderAfterDays`, förval 7 dagar). Påminnelseavgift tas bara ut om produkten anger den och villkoren innehåller den, och aldrig över marknadens tak.
2. **Uppsägning för obetald premie** när påminnelsen inte hjälpt (`billing.cancellationNoticeAfterDays`). Meddelandet skickas med lagrum (ADR 0032), och den dag det skickades sparas.
3. **Avslut** om premien fortfarande är obetald när uppsägningstiden gått ut (i Sverige fjorton dagar). `billing` anropar `policies` med skälet `unpaid-premium` och den sparade dagen. Policyn avslutas från uppsägningens sista dag.
4. **Betalning under uppsägningstiden** stoppar avslutet. En betalning efter avslutet ändrar det inte, men handläggaren kan återkalla avslutet (ADR 0029).

- **Dröjsmålsränta** räknas inte ut automatiskt i första versionen. Marknadsprofilen anger om den får tas ut och med vilken referensränta, och produkten anger om den ska tas ut. Den kommer som ett senare steg.
- **Inkasso** sker inte i Petvold. En skuld som går till inkasso lämnas över med händelsen `invoice.sent_to_collection` och ett beslut av en handläggare.

### 8. Utbetalningar

- **`claim.payout_ordered` ger en utbetalning** i `payments` med ordernumret som idempotensnyckel. En order betalas aldrig ut två gånger.
- **Mottagaren** (öppen fråga i ADR 0017) är **kunden**, utom när kliniken har avtal om direktreglering med bolaget. Då får **kliniken** betalt. Kliniken är den i ordern (`clinicId`), och avtalet är en inställning per klinik med giltighetstid.
- **Betaluppgifterna** (konto, Swish-nummer eller IBAN) ägs av `payments`, per part. En ändring av betaluppgifterna loggas med vem som ändrade, och en utbetalning till uppgifter som ändrats inom ett antal dagar (`payments.newPayeeHoldDays`, förval 0) väntar på en handläggare. Det skyddar mot bedrägeri med ändrade kontouppgifter.
- **Attesten är redan gjord** i skadekedjan (ADR 0019). Utbetalningen kräver ingen ny attest.
- **Premie tillbaka** till kunden går samma väg, med en återbetalning från `billing` som order.
- **Kvittning** av obetald, förfallen premie mot en ersättning sker bara om marknadsprofilen tillåter det och produkten slår på det (`billing.offsetUnpaidPremium`, förval av). Kvittningen syns i utbetalningen och i förklaringen till kunden (färdplanen, M5).
- **Återkrav** när ersättning betalats för en tid efter ett retroaktivt avslut, eller när en omprövning sänker ersättningen: `billing` skapar ett **förslag till återkrav** i en kö. En handläggare avgör om det krävs tillbaka, avräknas mot premie som ska tillbaka, eller skrivs av. Inget dras automatiskt.

### 9. Bokföringen

- **Dubbel bokföring med verifikationer.** Varje händelse som rör pengar blir en verifikation i `accounting` med löpnummer, bokföringsdag, belopp i minsta enhet per valuta, och en hänvisning till händelsen och objektet (faktura, betalning eller ärende).
- **Kontona är Petvolds egna slag** (premiefordran, premieintäkt, skatt på premie, tillgodohavande, skuld för ersättning, bank och okopplade inbetalningar). **Kontoplanen** översätter dem till bolagets kontonummer och är en inställning per installation med historik (ADR 0020).
- **Perioder och dagsavslut.** Bokföringen har perioder (månad som förval). **Dagsavslutet** är en körning som stänger dagen och lämnar **dagens verifikationer** till bolagets ekonomisystem: som en CSV-fil och som händelsen `accounting.day_closed`. CSV går att läsa in i alla ekonomisystem och är lätt att kontrollera. SIE 4, som svenska ekonomisystem läser direkt, kommer när en installation behöver det. En stängd dag eller period ändras aldrig. En rättelse bokas i en öppen period, med hänvisning till det den rättar.
- **Petvold är inte bolagets huvudbok.** Periodisering av premien (intjänad och ej intjänad premie), avsättningar och rapporter till tillsynen görs i bolagets ekonomisystem. Varje verifikation för premie bär termens period, så att det går att periodisera.

### 10. Behörighet och fyra ögon

- Nya rättigheter: `billing:read`, `billing:write` (koppla inbetalningar, byta betalsätt), `billing:credit` (kreditnota, avskrivning och återkrav), `payments:read`, `payments:payee-write` (betaluppgifter), `accounting:read` och `accounting:close`.
- **Kreditnotor och avskrivningar** över handläggarens beloppsgräns kräver attest av någon annan, med samma gränser per roll och valuta som skadebesluten (ADR 0019 och 0020).

### 11. Personuppgifter och gallring

- Fakturor, betalningar, utbetalningar och verifikationer är räkenskapsinformation och sparas i sju år (bokföringslagen 7 kap. 2 §). De raderas inte vid en begäran om radering. Rättslig grund är rättslig förpliktelse (GDPR artikel 6.1 c och 17.3 b).
- **Betaluppgifterna** (konto och Swish-nummer) gallras när kontot inte använts på ett antal år, och vid radering när inget längre är utestående. Gallringen (ADR 0028) får veta att `billing` och `payments` har relationer till parten.

### 12. Betaltjänster

Petvold ska klara bankfiler, autogiro, Swish och kort. Ingen enskild tjänst täcker allt (kontrollerat 2026-11-21 i tjänsternas publika dokumentation):
- **Stripe** har kort, SEPA-autogiro och Swish. Swish går där bara att använda för enstaka betalningar, inte för återkommande dragningar. Bankgirots Autogiro och utbetalningar till kundens konto finns inte.
- **Surfboard Payments** har kort och Swish, och återkommande dragningar med sparat kort. Utbetalningar till kunder finns inte i deras publika dokumentation.

Därför en adapter per tjänst, med porten i ADR 0017, och val av adapter per marknad, syfte och betalsätt i installationens inställningar:

| Behov | Adapter | Steg |
| --- | --- | --- |
| Utbetalning till konto, och inbetalning med OCR via bankgiro | **Bankfiler** enligt ISO 20022 (`pain.001` ut, `camt.054` in) | Först. Fungerar mot alla banker och går att testa med filer. |
| Kort och Swish för enstaka betalningar, sparat kort för återkommande | **Stripe**, eller **Surfboard Payments** om bolaget har avtal där | Andra. Båda har testmiljöer. |
| Återkommande dragning från konto | **Autogiro** via Bankgirot (filer med medgivanden och dragningar), och **SEPA Direct Debit** i EUR-marknader | Tredje |
| Utbetalning till Swish-nummer, och återkommande Swish | **Swish** direkt, med bolagets avtal med banken | Fjärde |

- **`fake`-adaptern** används i tester och i dev-servern, som ADR 0017 säger.
- En ny tjänst, till exempel en annan betalningsförmedlare, är en ny adapter som klarar den gemensamma sviten.

### 13. Införs i steg

1. **`billing-core`:** premieplanen, fördelningen och avräkningen vid avslut, med egenskapstester.
2. **`billing`:** betalarkonton, premieplaner från policyhändelserna, fakturering som körning, nummerserie och fakturan som meddelande. Migration och kontrakt.
3. **`payments`** enligt ADR 0017 med `fake`-adaptern: inbetalningar, koppling till fakturor, okopplade inbetalningar och utbetalningar från `claim.payout_ordered`.
4. **Obetald premie:** påminnelse, uppsägning och avslut som körningar.
5. **Tillgodohavanden, återbetalningar och kreditnotor**, med attest.
6. **`accounting`:** verifikationer, kontoplan, perioder och dagsavslut med fil.
7. **Betaltjänster** i ordningen i punkt 12: bankfiler, Stripe eller Surfboard, Autogiro och SEPA, och Swish.
8. **Back office:** betalarens konto på partens sida, fakturor, okopplade inbetalningar, utbetalningar och återkrav som köer.

Distribution och provision (färdplanen, M5) får en egen ADR.

## Konsekvenser

- **Kundresan blir hel:** teckning, faktura, betalning, skada, utbetalning och avslut med premie tillbaka.
- **Tre nya moduler och scheman.** Flödet går helt via händelser, så en händelse som försvinner ger en faktura som saknas. Reläet levererar minst en gång, och modulerna sparar vad de behandlat. Avstämningen (ADR 0017, punkt 8) och en kontroll i dagsavslutet att varje termpremie har en plan fångar resten.
- **Policyhändelserna får fält som saknas i dag.** `billing` ska inte behöva fråga policymodulen. Till exempel saknar `policy.renewed` betalaren och `policy.issued` termnumret. Fälten läggs till i kontraktet i steg 2, och de är inte brytande.
- **Pengarna i `policies` blir en källa.** Policymodulens belopp (premie, `refund`, `premiumAdjustment`) är det `billing` räknar på. En rättelse i hur policymodulen räknar måste vara en ny version, som för skadebeslut.
- **Bolagets ekonomisystem behövs fortfarande** för huvudbok, periodisering och rapporter. Petvold lämnar underlaget.
- **Mer att ställa in per installation:** kontoplanen, betaltjänsterna, nummerserien för fakturor och tidsgränserna för obetald premie.
- **Fler dokument:** fakturan, påminnelsen och uppsägningen för obetald premie behöver mallar om Petvold gör dokumenten.

## Alternativ

- **Billing i policymodulen.** Färre moduler, men en betalare med flera policyer skulle behöva en faktura över flera policyer, och betalningar och påminnelser har en egen livscykel. Valdes bort.
- **Bara händelser ut, och bolagets ekonomisystem fakturerar.** Enklast för Petvold, och möjligt för ett bolag som redan har ett faktureringssystem: det kan låta bli att slå på `billing` och lyssna på policyhändelserna. Men då kan Petvold inte säga upp för obetald premie, kvitta eller visa kundens skuld, och ett bolag utan faktureringssystem kan inte använda Petvold. Valdes bort som enda väg.
- **En huvudbok i Petvold.** Valdes bort. Försäkringsbolag har redan en huvudbok med periodisering och rapporter till tillsynen. Petvold lämnar verifikationer som underlag.
- **Fakturan som ändras när policyn ändras.** Enklare att visa, men en skickad faktura är en verifikation och får inte ändras. Kreditnotor gör ändringen synlig.
- **Bara Stripe eller bara Surfboard.** Färre integrationer, men ingen av dem har Bankgirots Autogiro eller utbetalningar till kundens konto, och båda behövs i Sverige.

## Beslut 2026-11-21

1. **Betalningsintervall:** konfigurerbart per policy, med tillåtna intervall, förval och avgift i produkten (punkt 2).
2. **Mottagare av ersättning:** kunden, utom när kliniken har avtal om direktreglering. Då får kliniken betalt (punkt 8).
3. **Betaltjänster:** bankfiler, Autogiro, Swish och kort, med en adapter per tjänst. Stripe eller Surfboard Payments för kort och Swish (punkt 12).
4. **Dagsavslutet:** CSV först och SIE 4 senare (punkt 9).
5. **Dröjsmålsränta:** väntar till ett senare steg (punkt 7).
6. **En lägre premie under termen** dras av från delbetalningarna som inte fakturerats än, lika mycket på var och en och aldrig under noll. Bara det som de inte räcker till krediteras på det som är fakturerat (punkt 4). Krediteringar från en policyhändelse görs automatiskt, utan attest. Attest gäller kreditnotor som en person gör (steg 5).

## Rättelse 2026-11-21

Punkt 3 och 5 nämnde bara lagens regel för den första premien. FAL 5 kap. 1 § andra och tredje stycket säger också att premien för en senare premieperiod, och vid förnyelse, inte behöver betalas tidigare än en månad efter att kravet skickades. Ett egenskapstest för faktureringen hittade det (PR #132).

- **Fakturans förfallodag** är den tidigaste radens, men aldrig tidigare än lagen tillåter för någon rad: fjorton dagar efter fakturan för en ny policys första premie, och en månad efter fakturan för en senare premie. Marknadsprofilen anger båda (`firstPremiumDays`, `laterPremiumMonths`).
- **Förvalet för `billing.invoiceLeadDays` är 31 dagar** i stället för 20. En månad är aldrig längre än 31 dagar, så en senare premie förfaller då på periodens första dag när körningen går varje dag. En kortare framförhållning flyttar förfallodagen framåt.

## Förtydligande 2026-11-23

Punkt 6 säger att en betalning fördelas på den äldsta förfallna skulden först. En inbetalning med en fakturas referens går nu **först till den fakturan**, och bara det som blir över till den äldsta förfallna skulden (PR #145). Annars kunde en kund som betalat en faktura med rätt OCR se den som obetald, medan pengarna gått till en äldre faktura. Med två obetalda fakturor och en betalning utan referens som en person kopplar till kontot gäller fortfarande den äldsta först.

## Förtydligande 2026-11-23, steg 4

Punkt 7 byggdes så här (PR #149):
- **Uppsägningen registreras när den skickas**, med verkan fjorton dagar senare, som policymodulen redan gjorde för skälet `unpaid-premium`. Betalas premien före den dagen återkallar `billing` uppsägningen. Det ger samma resultat som att vänta med avslutet, men kunden och bolagets system ser uppsägningen och dess dag direkt.
- **Alla policyer på fakturan** sägs upp. En delbetald faktura fördelas inte på policyerna.
- **Dagarna kommer från marknadens regler** (7 och 21 dagar efter förfallodagen i Sverige). Inställningar per produkt eller installation, och påminnelseavgift, kommer senare.

## Förtydligande 2026-11-24, steg 6a

Punkt 9 byggdes så här (PR #152):
- **Tillgodohavanden bokförs som ett negativt saldo på premiefordran** per betalarkonto, inte på ett eget konto. Ett tillgodohavande kan uppstå på flera sätt, till exempel en överbetalning eller en kreditnota på en betald faktura, och det är en omföring som bolagets ekonomisystem gör vid periodens slut. Kontot `tillgodohavande` i punkt 9 finns därför inte som eget slag.
- **Varje inbetalning bokförs först mot okopplade inbetalningar**, och flyttas till premiefordran med händelsen `payment.matched` när `billing` kopplat den. Bokföringen beror då inte på i vilken ordning modulerna läser händelserna.
- **Tre slag till:** delbetalningsavgifter, kundförluster (avskrivningar) och återbetalningar att betala. Skadekostnad bokförs mot skuld för ersättning när utbetalningsordern kommer.

## Förtydligande 2026-11-25, steg 7a

Bankfiler in, `camt.054`, är byggda:
- **En bankfil saknar egen signatur.** Den läses därför in av en inloggad person eller integration med `POST /v1/payment-files` och rättigheten `payments:import`, aldrig genom den öppna vägen för aviseringar. Adaptern har `uploadOnly` och nås bara genom `PaymentsService.importFile`.
- **Varje inläsning sparas** med vem, när, filens kontrollsumma och vilka inbetalningar den gav, så att det går att visa var en inbetalning kom ifrån (ADR 0018).
- **Bara bokförda insättningar** blir inbetalningar. Uttagen i samma fil är bankens bekräftelse på utbetalningar och läses i steg 7b, med `pain.001` ut.


## Förtydligande 2026-11-25, steg 7b

Bankfiler ut, `pain.001.001.03`, och bankens bekräftelse i `camt.054` är byggda:
- **En utbetalning väntar som skickad** tills den har kommit med i en fil och banken har bekräftat den. Uttaget gör den betald. En retur gör den misslyckad med bankens orsakskod.
- **`EndToEndId`** är utbetalningens id utan prefixet `pyo_`, eftersom fältet rymmer högst 35 tecken.
- **Mottagarens namn**, som filen kräver, kommer från partsmodulen genom porten `payeeNames`. För en klinik används klinikens id, eftersom kliniker inte har namn i Petvold än.
- **Filen sparas** så att den kan hämtas igen. Den innehåller namn och kontonummer, så den töms när en mottagare i den raderas (punkt 11). Raden och kontrollsumman finns kvar.
- **Filerna följer meddelandedefinitionerna** på iso20022.org. Bankernas egna tillämpningsanvisningar kan kräva mer, och en bank behöver pröva filerna innan de används med riktiga pengar.

## Förtydligande 2026-11-25, steg 7c

Stripe är byggd för inbetalningar med kort och Swish, genom Stripe Checkout:
- **En betalsida per faktura**, för det som är kvar att betala, med fakturans referens i `metadata`. Betalningen kopplas därför till fakturan som från banken. Sidan fungerar en timme, så att beloppet fortfarande stämmer.
- **Stripes händelse `checkout.session.completed`** läses efter att signaturen kontrollerats (`Stripe-Signature`, HMAC-SHA256). Stripes id för betalningen gör att samma händelse inte ger två inbetalningar.
- **Inget Stripe-bibliotek.** Ett anrop med `fetch` och kontrollen med `node:crypto` räcker. Ett bibliotek hade gett ett större beroende att följa.
- **Swish genom Stripe** gäller bara engångsbetalningar i SEK, och Stripe står som mottagare. Återkommande dragningar kräver Autogiro, som återstår.

## Förtydligande 2026-11-25, återkrav

Återkrav enligt punkt 8 är byggt. Det besvarar också den öppna frågan i ADR 0019:
- **Skademotorn ger `claim.payout_reduced`** när ett beslut sänker ersättningen, med minskningen. Varje ändring av ersättningen blir då antingen en order (upp) eller en minskning (ned), och summan är alltid det beslutade.
- **`billing` gör ett förslag** för försäkringstagaren den dagen, en gång per händelse, med betalarkontot om det finns.
- **En handläggare med `billing:credit` beslutar en gång.** Att kräva tillbaka ger en fordran som bolaget driver in. Att avräkna minskar tillgodohavandet och kräver att det räcker, kontrollerat under kontots lås. Att skriva av kräver att beloppet ryms inom handläggarens gräns.
- **Bokföringen:** att kräva tillbaka ger debet på fordringar på återkrav och kredit på skadekostnad. Att avräkna ger debet på premiefordran och kredit på skadekostnad. En avskrivning bokförs inte.
- **Inte byggt:** att en betalning av ett återkrav kopplas till det, och att förslaget ser om den ursprungliga utbetalningen redan har betalats ut.

## Källor

- Försäkringsavtalslagen (2005:104), 5 kap. 1, 2 och 6 §§. riksdagen.se
- Lagen (2005:59) om distansavtal och avtal utanför affärslokaler, 3 kap. 20 §. riksdagen.se
- Räntelagen (1975:635), 6 §. riksdagen.se
- Lagen (1981:739) om ersättning för inkassokostnader m.m., 2 §. riksdagen.se
- Bokföringslagen (1999:1078), 5 kap. och 7 kap. 2 §. riksdagen.se
- Dataskyddsförordningen (EU) 2016/679, artikel 6.1 c och 17.3 b. eur-lex.europa.eu
- Stripe, *Swish payments* (enstaka betalningar, inte återkommande). docs.stripe.com/payments/swish
- Surfboard Payments, *Swish* och *Recurring payments*. surfboardpayments.com
- ISO 20022, meddelanden `pain.001` och `camt.054`. iso20022.org
- ISO 11649, strukturerad betalningsreferens (RF). iso.org
- Bankgirot, *OCR-referenskontroll* och *Autogiro*. bankgirot.se
- SIE-gruppen, *SIE filformat version 4*. sie.se
- ADR 0001, 0007, 0010, 0017, 0018, 0019, 0020, 0028, 0029, 0030, 0032, 0036, 0037 och 0038 i det här repot.
