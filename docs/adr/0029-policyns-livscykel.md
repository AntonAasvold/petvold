# 0029. Policyns livscykel: tecknande, förnyelse, avslut och överlåtelse

- Status: Beslutad
- Datum: 2026-11-15

## Sammanhang

Skademotorn läser i dag policyer från exempeldata i minnet via `PolicyPort`. M3 bygger policymodulen. ADR 0006 bestämmer att policyversioner är bitemporala och att ändringar går genom en transaktionslivscykel. ADR 0007 bestämmer att varje djur har en egen policy, att policyer kan samlas i grupper och att en överlåtelse antingen byter försäkringstagare eller ger en ny policy. Det som återstår är hur en policy tecknas, förnyas, avslutas och överlåts, och vilka lagregler som gäller.

För konsumentförsäkring i Sverige gäller försäkringsavtalslagen (FAL):
- **Försäkringstid:** högst ett år, om det inte finns särskilda skäl (3 kap. 2 §).
- **Förnyelse:** försäkringen förnyas på samma villkor om ingen har sagt upp den (3 kap. 4 §).
- **Kundens uppsägning:** kunden kan när som helst säga upp försäkringen till försäkringstidens slut (3 kap. 3 §). Den kan avslutas i förtid bland annat när försäkringsbehovet faller bort (3 kap. 6 §). Uppsägningen gäller från dagen efter att den kom fram, om inget annat anges.
- **Bolagets uppsägning till försäkringstidens slut** ska skickas senast en månad i förväg (3 kap. 3 §).
- **Bolagets uppsägning under försäkringstiden** får bara ske om kunden grovt har åsidosatt sina förpliktelser eller om det finns synnerliga skäl. Uppsägningstiden är fjorton dagar från att den skickades (3 kap. 7 §).
- **Obetald premie:** bolaget får säga upp försäkringen, och uppsägningen gäller fjorton dagar efter att den skickades om premien inte betalas (5 kap. 2 §).
- **Premie vid förtida upphörande:** bolaget har bara rätt till premie för den tid försäkringen gällde, och resten betalas tillbaka (5 kap. 6 §).

Om försäkringen tecknas på distans gäller distansavtalslagen (2005:59). Kunden har då 14 dagars ångerrätt från avtalet eller från när informationen kom fram (3 kap. 13 och 17 §§). Bolaget får ta betalt för den tid försäkringen gällde, i proportion (3 kap. 20 §).

## Beslut

1. **En ny modul, `policies`,** med schemat `policies` och tjänsterollen `policies_service` (ADR 0001). Den uppfyller skademotorns `PolicyPort` och ersätter exempeldatan.
2. **Begrepp:**
   - **Policy** (`pol_…`): ett djur, en försäkringstagare, en produkt, och hela historiken.
   - **Term:** en försäkringstid, högst ett år, med premie och valda villkor (försäkringsbelopp och självrisk).
   - **Version:** policyns innehåll med giltighetstid och registreringstid (ADR 0006).
   - **Transaktion:** en ändring som skapar versioner. Typerna är tecknande, ändring, förnyelse, avslut, återkallat avslut och överlåtelse.
3. **Tecknande.**
   - Försäkringstagaren är en part och djuret är ett djur, båda i policyns marknad (ADR 0024, 0026).
   - Produktversionen ska vara till salu på startdagen och gälla djurets art (ADR 0023). Villkoren väljs bland produktversionens alternativ.
   - Startdagen får inte ligga före dagen för tecknandet. En försäkring gäller aldrig retroaktivt.
   - Transaktionen går igenom stegen utkast, prissatt, riskbedömd och utfärdad. Pris och riskbedömning är portar. Tills tariffen och teckningsreglerna finns (M4) anger anroparen premien, och riskbedömningen godkänner allt.
4. **Förnyelse.**
   - Termens längd ställs in per produkt (`termMonths`, 1–12 månader, förval 12), inom marknadens tak.
   - En förnyelsekörning skapar nästa term ett antal dagar före förfallodagen. Antalet dagar ställs in per produkt, och förvalet är 45 dagar. Det måste vara kortare än termen.
   - Den nya termen får den version av produkten som är till salu på förnyelsedagen. Om produkten inte säljs längre förnyas policyn inte automatiskt, utan den markeras för beslut.
   - En förnyad term meddelas kunden genom en händelse, `policy.renewed`. Utskicket hör till kanalen.
5. **Avslut.** Lagreglerna ovan ligger i en **marknadsprofil** i koden, per marknad och med källor. Den uppdateras med nya versioner av Petvold och kan inte försvagas av en produkt.
   - **Kundens avslut:** till termens slut, när som helst. För avslut under termen erbjuder Petvold två sätt, och produkten väljer:
     - **bindningstiden ut:** avslutet gäller från termens slut
     - **direkt uppsägning:** avslutet gäller från dagen efter att det kom fram, och premien för resten av termen betalas tillbaka

     Avslut när behovet faller bort och ånger inom ångerfristen är alltid tillåtna, oavsett produktinställning. Petvold kontrollerar att en produkt inte stänger dem.
   - **Behovet faller bort när djuret dör.** Händelsen `animal.died` från djurregistret skapar ett förslag till avslut från den dagen. Det kan ligga bakåt i tiden, och då påverkar det skador efter den dagen (omprövning, ADR 0018). När djuret säljs gäller i stället överlåtelse (punkt 6).
   - **Bolagets avslut:** till termens slut med minst en månads varsel. Under termen bara med skäl och fjorton dagars uppsägningstid. Vid obetald premie gäller fjorton dagar från att uppsägningen skickades, och den skickas från betalningsmodulen (M5).
   - **Premie tillbaka** räknas per dag för den tid som inte gällde och skickas som en händelse till betalningsmodulen (M5).
   - **Ett avslut kan återkallas** med en reversering, till exempel om ett dödsfall var felregistrerat.
6. **Överlåtelse när djuret säljs: samma policy byter försäkringstagare.**
   - Händelsen `animal.ownership_changed` skapar ett förslag till överlåtelse från försäljningsdagen. Överlåtelsen genomförs när den nya ägaren har godkänt villkoren. Godkännandet sparas med vem, när och via vilken kanal.
   - Försäkringstagaren är en del av policyversionen. Överlåtelsen skapar en ny version med giltighet från försäljningsdagen. Historiken visar därför alltid vem som var försäkringstagare en viss dag och när bytet registrerades, även om det registrerades i efterhand (ADR 0006).
   - Karenstid, självriskperioder och förbrukat försäkringsbelopp följer policyn och djuret, inte försäkringstagaren.
   - Skador före försäljningsdagen hör till den förra försäkringstagaren, och skador från den dagen till den nya. Premien delas per dag. Den förra får tillbaka premien för tiden efter försäljningen, och den nya betalar från försäljningsdagen (M5).
   - Om den nya ägaren inte godkänner inom en tid som ställs in per produkt, avslutas policyn från försäljningsdagen, eftersom behovet har fallit bort.
7. **Grupper** (`PolicyGroup`, ADR 0007) samlar policyer för en kull eller ett hushåll. Gruppen påverkar signering, faktura och rabatt, men aldrig skaderegleringen. Den byggs efter enskilda policyer.
8. **Händelser** via en outbox (ADR 0008): `policy.issued`, `policy.version_superseded` (som skademotorn redan lyssnar efter), `policy.renewed`, `policy.cancelled` och `policy.transferred`.
9. **Gallring** (ADR 0028). Policymodulen är en `ActivitySource`. En försäkringstagare har en pågående relation så länge en term gäller eller en skada på policyn är öppen. Därefter gäller det senaste datumet av termens slut och skadans slutliga beslut.

## Konsekvenser

- Skademotorn får riktiga policyer, och gallringen kan köras skarpt när policyer och skador rapporterar relationer.
- Lagregler och produktval är åtskilda: lagen i marknadsprofilen och bolagets val i produkten.
- Varje marknad behöver en egen profil med källor innan den kan användas. Sverige först.
- Priset anges av anroparen tills M4 finns. Det sparas i termen och i beviskedjan som vilket pris som helst.
- Förnyelse och avslut i efterhand ger omprövning av skador, så omprövningen måste fungera för retroaktiva avslut. Det står redan i roadmapen.

## Alternativ

- **Ny policy till den nya ägaren, med `continuityOf`:** håller avtalen isär, men karenstid, självriskperioder och försäkringsbelopp måste föras över mellan policyer. Samma policy med en ny version ger samma spårbarhet med ett krav på godkännande.
- **Lagregler som inställning per installation:** flexibelt, men ett försäkringsbolag skulle kunna stänga ångerrätten av misstag. Lagen ändras sällan och hör till Petvolds version.
- **Förnyelse som en ny policy:** bryter historiken och karenstiden.
- **Ett enda sätt att avsluta under termen:** enklare, men bolag erbjuder både bindningstid och fri uppsägning.
- **Avslut bara framåt i tiden:** enklare, men ett djur som dog för två veckor sedan ger då premie för en tid utan försäkringsbehov.

## Källor

- Försäkringsavtalslag (2005:104) 3 kap. 2, 3, 4, 6 och 7 §§ och 5 kap. 2 och 6 §§. riksdagen.se, lagen.nu
- Lag (2005:59) om distansavtal och avtal utanför affärslokaler, 3 kap. 13, 15, 17 och 20 §§. riksdagen.se, lagen.nu
- ADR 0001, 0006, 0007, 0008, 0018, 0023, 0024, 0026 och 0028.
