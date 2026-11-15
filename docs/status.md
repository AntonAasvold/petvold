# Status

Läses i början och uppdateras i slutet av varje arbetspass. Senaste först.

## 2026-11-15 (pass 24)

**Gjort**
- #31 mergad: simulering och rättningen av outboxens ordning.
- Referensdata i den nya modulen `catalog` (ADR 0022, Beslutad):
  - **Arter, raser och kön** med koder som aldrig ändras och etiketter per språk. `label` följer `Accept-Language`.
  - **Historik:** varje ändring blir en ny revision med vem, när och varför. Tjänsterollen `catalog_service` får bara läsa och lägga till. En kod avaktiveras i stället för att tas bort.
  - **En ras tillhör en art** som måste finnas och vara aktiv, och arten ändras aldrig. Kontrolleras både i tjänsten och av en trigger.
  - **API:** fyra operationer under `/v1/reference-data`. Nya rättigheter `catalog:read` och `catalog:write`, och ny roll `catalog-manager`. `catalog:read` har lagts till i standardrollerna som behöver listorna.
  - **Migration 0013:** schemat `catalog`. Provad ner och upp igen.
  - **Dev-servern** läser in exempeldata (3 arter, 2 kön, 8 raser på engelska och svenska). Ny token `dev-catalog`.
- **Bygglogg** i `docs/logg/` med en post per PR om hur ändringen är byggd. Den har lagts till i `CLAUDE.md` och arbetssättet.
- #32 mergad.
- Produkter och produktversioner i `catalog` (ADR 0023, Beslutad):
  - **Produktversioner** som `SE-HUND-VV-LIV@2026.2` har marknad, valuta, arter, namn, regelserie, säljperiod och valbara försäkringsbelopp och självrisker för veterinärvård.
  - **Livscykel:** utkast, granskning och publicering med fyra ögon. Vid granskning kontrolleras arter och att regelserien gäller när försäljningen börjar. Försäljningen kan avslutas tidigare, med motivering. Högst en version av en produkt säljs samma dag, och databasen spärrar det också.
  - **Skademotorn** hittar regelserien via policyns produktversion (`ProductService.ruleSeriesOf`). Den tillfälliga funktionen i dev-servern är borta.
  - **API:** nio operationer under `/v1/products`, bland annat produkter till salu ett visst datum och villkor för kundens val. Ny rättighet `catalog:publish` och ny roll `catalog-publisher`.
  - **Migration 0014:** `catalog.product_version`. Provad ner och upp igen.
  - **Dev-servern** publicerar exempelprodukten (Bellas). Ny token `dev-catalog-publisher`.
- #33 mergad.
- Djurregistret i den nya modulen `animals` (ADR 0024, Beslutad). Flytten av `assess` och `calculate` får vänta, eftersom ADR 0021 säger att den görs när de behövs utanför skademotorn.
  - **Djur** med art, ras och kön ur referensdatan, namn, födelse och död, som revisioner med motivering. Marknad och art ändras aldrig.
  - **Id-nummer:** chip (15 siffror), registreringsnummer och pass. De är unika i installationen och tas aldrig bort.
  - **Ägarskap med giltighetstid.** Ett ägarbyte avslutar det gällande samma dag i en transaktion. Databasen spärrar glapp, överlapp och ändringar.
  - **API:** sju operationer under `/v1/animals`, med sökning på chip och ägare. Nya rättigheter `animals:read` och `animals:write`, och ny roll `animal-registrar`. Omfånget är djurets marknad, och roller bundna till klinik eller försäkringar ser inga djur.
  - **Migration 0015:** schemat `animals` och rollen `animals_service`. Provad ner och upp igen.
  - **Dev-servern** registrerar Bella. Ny token `dev-registrar`. Lokal rollinställning är version 4.
- ADR 0022, 0023 och 0024 beslutade.
- Uppslagning av djur för kliniker (ADR 0025, Föreslagen), PR #35:
  - **Flaggan `allowLookup`** per djur, som en del av revisionerna. Stängt om inget anges, och måste alltid anges vid en rättelse.
  - **`GET /v1/animal-lookup`** på chip, registrering eller pass. Visar djuret utan ägare och historik, och bara i anroparens marknader. Stängt, okänt och fel marknad ger samma tomma lista.
  - **Ny rättighet `animals:lookup`**, som rollen `clinic` får.
  - **Migration 0016:** kolumnen `allow_lookup`. Provad ner och upp igen.
  - **Dev-servern** öppnar Bella, och `dev-clinic` hittar henne på chipet. Lokal rollinställning är version 5.
- 269 tester och 91 databastester.

**Nästa steg**
1. Kullar i djurregistret, eller partmodulen (personer, organisationer, roller), som ägarna pekar på.

**Öppet**
- ADR 0025 väntar på ditt beslut.
- Det sparas inte vem som slagit upp ett djur.
- `animals:lookup` saknas på `clinic` i installationer som redan har en sparad rollinställning.
- `catalog:read`, `catalog-manager` och `catalog-publisher` saknas i installationer som redan har en sparad rollinställning. Lokalt måste de läggas till via API:et.

## 2026-11-14 (pass 23)

**Gjort**
- #30 mergad: `api`. ADR 0021 är beslutad.
- Simulering av regelversioner (ADR 0018):
  - **`POST /v1/rule-sets/{serie}/versions/{v}/simulations`** med `from` och `to`. Rättigheten `rules:simulate` finns i `rules-author` och `rules-publisher`.
  - **Den rena funktionen `simulate()`** i kärnan kör sparade underlag med versionens regler och jämför med besluten. Svaret visar ändrade beslut, flytt mellan automatiskt och manuellt, och ersättning per valuta. Inget sparas.
  - **Underlagen** kommer via skademodulens tjänst, varje ärendes senaste beslut i perioden. API-lagret filtrerar på serie och anroparens omfång.
  - **Migration 0012:** index på `claims.decision (decided_at)`.
- Dokumentation: produktkonfiguration (simulering med exempel), behörighet och arkitektur.
- **Rättat fel i outboxen:** `pendingEvents` sorterade på id som text (`order by id` syftade på `id::text`). Därför kom id 10 före id 9, och reläet kunde publicera händelser i fel ordning när sekvensen passerade en siffergräns. Felet upptäcktes när CI föll. Nu sorteras det på det numeriska id:t, och ett regressionstest sätter sekvensen till 8 och kontrollerar ordningen 9, 10, 11.
- 228 tester och 77 databastester.

**Nästa steg**
1. Produktkatalogen `catalog`: referensdata med översättningar, produkter och produktversioner.

**Öppet**
- Följdeffekter mellan skador (självriskperioder) simuleras inte.
- `rules:simulate` saknas i installationer som redan har en sparad rollinställning. En administratör lägger till den.

## 2026-11-14 (pass 22)

**Gjort**
- #28 och #29 mergade: ADR 0021 och regeluppsättningarna.
- HTTP-lagret har bytt namn från `claims-api` till `api` (`@petvold/api`), och kontraktet heter "Petvold API". Det har anrop för skador, regler och roller och är Petvolds enda HTTP-yta. Petvold körs som en process (modulär monolit, ADR 0001).

**Nästa steg**
1. Simulering av regelutkast mot sparade underlag.
2. Produktkatalogen `catalog`.

**Öppet**
- ADR 0021 är Föreslagen och väntar på ditt beslut.

## 2026-11-14 (pass 21)

**Gjort**
- #27 mergad: reserven. M1 är klar.
- ADR 0021 (Föreslagen, PR #28): produktkatalog och regeluppsättningar. Roadmapen för M2 är uppdelad i ordning.
- Regeluppsättningar i modulen `decisioning`. Den här PR:en bygger på #28.
  - **Regelserier** med numrerade versioner: `draft → in_review → published → retired`. Publicering kräver fyra ögon, och en publicerad version ändras aldrig. Kontrollsumman räknas ut vid granskning.
  - **Rätt version för en skada:** den publicerade med senaste `effectiveFrom` som inte ligger efter behandlingsdatumet. `rulesVersion` är `<serie>@<version>`, och `rulesChecksum` ingår i underlaget.
  - **`RulesPort.getRules(productVersion, onDate)`** kan svara null, och då svarar skademotorn 409. En skada utan policy bedöms utan produktregler.
  - **API:** 8 operationer under `/v1/rule-sets/{serie}/versions`. Nya rättigheter `rules:read`, `rules:write` och `rules:publish`, och nya roller `rules-author` och `rules-publisher`.
  - **Migration 0011:** schemat `decisioning` och rollen `decisioning_service`. Databasen spärrar ändringar efter publicering, fyra ögon och dubbla datum. Provad ner och upp igen.
  - **Dev-servern** läser regler från modulen. Första gången publiceras exempelreglerna som `SE-HUND-VV@1`. Nya tokens `dev-author` och `dev-publisher`.
- Fynd: nya standardroller når inte en installation som redan har en sparad rollinställning. Det är dokumenterat, och en administratör lägger till dem via API:et. Lokalt är det gjort.
- 222 tester och 75 databastester.

**Nästa steg**
1. Simulering av regelutkast mot sparade underlag.
2. Produktkatalogen `catalog` med referensdata och produktversioner.

**Öppet**
- ADR 0021 väntar på ditt beslut.
- Produktversion → regelserie är en funktion i installationen tills katalogen finns.

## 2026-11-14 (pass 20)

**Gjort**
- #25 och #26 mergade: attestkedjan och rollinställningen via API. ADR 0019 och 0020 är beslutade.
- Reserv i ledgern. Det sista i M1.
  - **Reserven bokas** när en skada går till handläggare: den förväntade ersättningen bokas i samma transaktion som skadan sparas. Bedömningen görs nu innan skadan sparas, vilket inte ändrar resultatet eftersom skadan aldrig räknas med i sin egen bedömning.
  - **Beslutet löser upp reserven** i samma transaktion, både vid avslag och vid attest. Ett öppet förslag behåller den.
  - **Ingen reserv** för automatiska beslut eller när förslaget är avslag.
  - **Lagringen:** `saveClaim` tar journaler, och `getBalance(account)` läser ett kontos saldo. Nya konton är `claim_reserve` och `reserve_expense`.
  - **Migration 0010:** journaler kan ha källan `claim_reserve`. En trigger kontrollerar att källan är ärendet eller ett beslut i det. Provad ner och upp igen.
- Dokumentation: skadereglering och arkitektur (ledgern).
- 209 tester och 69 databastester.

**M1 är klar.**

**Nästa steg**
1. M2: produktkatalog och modulen `decisioning`, med regeluppsättningar i databasen, publicering med fyra ögon och simulering.
2. Fyra ögon för ändringar av rollinställningen, om du vill ha det.

**Öppet**
- Reserven justeras inte när bedömningen ändras före beslutet.
- Det finns ingen summering av öppna reserver. Den kommer med läsmodellen Insikt.

## 2026-11-14 (pass 19)

**Gjort**
- #24 och #25 mergade: roadmap och attestkedjan. ADR 0019 och 0020 är beslutade.
- Roller och beloppsgränser som versionerad konfiguration via API (ADR 0020).
  - **Ny modul `access`:** `AccessService`, porten `RoleConfigStore`, lagring i minnet och i Postgres, och en gemensam testsvit.
  - **Migration 0009:** schemat `access` och tjänsterollen `access_service`, med en tabell där versioner bara kan läggas till. Provad ner och upp igen.
  - **API:** `GET /v1/access/roles`, `GET /v1/access/roles/versions` och `POST /v1/access/roles/versions`. Nya rättigheter `access:read` och `access:manage`, och standardrollen `admin`.
  - **Spärrar:** ingen ändrar en roll den själv har (403), en ändring på en gammal version ger 409, och ogiltiga inställningar eller saknad motivering ger 422.
  - **Gäller direkt.** API:et läser gällande version vid varje anrop. Testat: en administratör sänker gränsen och nästa beslut blir ett förslag.
  - **Dev-servern** sparar rollinställningen i Postgres med `ACCESS_DATABASE_URL`. Ny token `dev-admin`.
- Dokumentation: behörighet (ändra via API), arkitektur, utvecklingsmiljö, roadmap.
- 202 tester och 65 databastester.

**Nästa steg**
1. Reserv i ledgern. Det slutför M1.
2. Fyra ögon för ändringar av rollinställningen, om du vill ha det.

**Öppet**
- Lokalt behövs databasrollen `access_service`. Kör `npm run dev:reset` eller skapa rollen för hand, se utvecklingsmiljö.
- Det finns inget administrativt gränssnitt. Petvold är headless, och API-sidan (`/docs`) kan användas tills vidare.

## 2026-11-14 (pass 18)

**Gjort**
- #23 mergad: behörighet del 2. Roadmap-PR #24 är öppen med nya punkter från jämförelsen med ett annat system. Bara idéer på allmän nivå, med publika källor.
- Attestkedjan (ADR 0019, Föreslagen):
  - **Beslutsförslag.** Över handläggarens gräns blir beslutet ett förslag (`202`). Inget bokförs, och ärendet kan ha högst ett öppet förslag.
  - **Attest.** Attesten kräver `claims:approve`, en annan person än den som föreslog, att beloppet ryms inom attestantens gräns och samma underlag (kontrollsumman). Beslutet får `approvedBy` och `proposalId`. Ett förslag kan också skickas tillbaka med en motivering.
  - **Gränser per roll och valuta:** `decisionLimits` och `approvalLimits`. En valuta som saknas har gränsen 0. Handläggare beslutar ensamma upp till 25 000 SEK eller 2 500 EUR. `approver` har `claims:approve`.
  - **Utbetalningsorder.** `claim.payout_ordered` skrivs för varje höjning av ersättningen, i samma transaktion som beslutet.
  - **Migration 0008:** `claims.decision_proposal` med regler i databasen (ett öppet per ärende, fyra ögon, stängs en gång). Provad ner och upp igen.
  - Ny dev-token `dev-approver`. `dev-handler` är nu bara handläggare.
- Dokumentation: skadereglering (attest, utbetalningsorder, händelser), behörighet (gränser) och arkitektur.
- 190 tester och 61 databastester.

**Nästa steg**
1. Reserv i ledgern medan ärendet ligger hos handläggare eller väntar på attest. Det slutför M1.
2. M2: produktkatalog och modulen `decisioning`.

**Öppet**
- ADR 0019 är Föreslagen och väntar på ditt beslut.
- Återkrav när en omprövning sänker en redan utbetald ersättning (M3 och M5).
- Omprövningar omfattas inte av beloppsgränser.

## 2026-11-14 (pass 17)

**Gjort**
- #22 mergad: förklaring och mänsklig prövning.
- Behörighet del 2: omfång (ADR 0016).
  - **Omfånget** kommer från tokenen: `markets` (lista eller `"*"`), `clinicId` och `policyIds`. Utan `markets` ser anroparen ingenting.
  - **Roller binds** med `bindsTo: 'clinic' | 'policies'`. Rollinställningen har nu formen `{ permissions, bindsTo? }`, och okända bindningar stoppar starten. `clinic` är bunden till klinik och `customer-channel` till försäkringar.
  - **Saknas attributet** som rollen kräver i tokenen blir svaret 403. Omfånget blir aldrig bredare.
  - **Ärenden utanför omfånget** ger 404 med samma svar som ett ärende som inte finns. Det gäller alla anrop under `/v1/claims/{id}` via en gemensam middleware.
  - **Anmälan och förhandsbesked** utanför omfånget ger 403. Försäkringsbelopp utanför omfånget ger 404, och kliniker kan inte slå upp försäkringsbelopp per försäkrings-id.
  - **Klinik-id** sparas på ärendet från tokenen (`clinicId`, migration 0007) och kan inte anges i anropet.
- Kontraktet beskriver omfånget. Dokumentationen är uppdaterad: behörighet med tabeller och arkitektur. Dev-tokens har omfång.
- 170 tester och 54 databastester.

**Nästa steg**
1. Attestkedjan med beloppsgränser per roll och valuta, fyra ögon och en händelse för utbetalningsorder (behörighet del 3). Det slutför M1.

**Öppet**
- Rollinställningen ges fortfarande i koden (`createApp`). Den bör komma från installationens konfiguration.
- Hur tokenens attribut översätts (namn på claims i JWT) bestäms när en riktig identitetstjänst kopplas in.

## 2026-11-14 (pass 16)

**Gjort**
- #21 mergad: omräkning och scenarier.
- Förklaring per beslut och mänsklig prövning (ADR 0018, GDPR art. 13–15 och 22):
  - **Automatiska beslut märks** med `automated`. Det gäller automatisk reglering och omprövning. Gamla beslut fick värdet i migrationen.
  - **Förklaring:** `GET /v1/claims/{id}/decisions/{seq}/explanation`. Den är en ren funktion `explainDecision()` i kärnan och ger huvudskäl, alla regler, beräkningen steg för steg (stegen summerar till ersättningen), avvikelse, möjlighet till prövning och underlagets versioner. Texten kommer på svenska och engelska via `messages.ts`.
  - **Begäran om prövning:** `POST /v1/claims/{id}/decisions/{seq}/review-requests`. Den gäller bara ärendets senaste automatiska beslut, och ärendet kan ha högst en öppen begäran. Nästa beslut av en handläggare är prövningen och stänger begäran i samma transaktion. Händelsen heter `claim.review_requested`.
  - **Ny rättighet** `claims:request-review` och ny standardroll `customer-channel` (kundportal). Ny dev-token `dev-customer`.
  - **Migration 0006:** `claims.review_request`, med regler i databasen: en öppen begäran per ärende, bara automatiska beslut, och stängning bara av det mänskliga beslut som besvarar den. Provad ner och upp igen.
- Kontraktet ändrades först. Dokumentationen är uppdaterad: skadereglering med ett exempel, behörighet och arkitektur.
- 161 tester och 53 databastester.

**Nästa steg**
1. Behörighet del 2: omfång per marknad, klinik och kund.
2. Attestkedjan med beloppsgränser, fyra ögon och utbetalningsorder. Det slutför M1.

**Öppet**
- Kundkanalen kan läsa och begära prövning i alla ärenden tills omfånget finns (del 2).
- Tidsgräns, påminnelse och kö för prövningar kommer i M6.

## 2026-11-14 (pass 15)

**Gjort**
- #19 och #20 mergade: roadmap för förnyelse och avslut, och självriskperiod över förnyelse som produktinställning.
- Omräkning av sparade beslut (ADR 0018):
  - `replay()` i kärnan, med `CALCULATION_MODELS` där gamla modeller behålls.
  - Jämförelse fält för fält med JSON-pekare.
  - Status `identical`, `different` eller `model_unavailable`, och en kontroll att underlaget fortfarande ger samma `inputHash`.
  - API: `POST /v1/claims/{id}/decisions/{seq}/replays` (rättighet `claims:read`). Kontraktet ändrades först.
- Scenarier som data (lager 3):
  - 8 scenarier i `scenarios/claims/` (7 svenska och 1 EUR-exempel), med standardvärden i `product.yaml`.
  - En fryst golden-fil per scenario, som räknas om i CI.
  - `npm run scenarios:golden` skriver bara saknade golden-filer.
  - Provat med ett inplanterat fel: bygget stoppades med exakta sökvägar och värden.
- Dokumentation: testning (scenarier och golden-filer), skadereglering (omräkning) och arkitektur.
- 142 tester.

**Nästa steg**
1. Förklaring per beslut och begäran om mänsklig prövning.
2. Behörighet del 2: omfång per marknad och klinik.
3. Attestkedjan med beloppsgränser och utbetalningsorder.

## 2026-11-14 (pass 14)

**Gjort**
- Självriskperiod över förnyelse är en produktinställning: `deductible.periodEndsAtRenewal`.
  - Standard är `false`: perioden fortsätter in i nästa försäkringsår. Det är oförändrat beteende, så beräkningsmodellen är fortfarande `vet-care.v1`.
  - Med `true` slutar perioden när försäkringsåret slutar.
  - Villkoren när perioden öppnas avgör när den slutar.
- 3 nya tester över en förnyelse (fortsätter, slutar, kortas inte i onödan). Totalt 118 tester.
- Produktkonfigurationen beskriver inställningen med ett räknat exempel.

**Öppet**
- Perioden är knuten till djuret, inte till ett oavbrutet skydd. Den bör sluta vid avslut, uppehåll eller ny ägare (M3).

## 2026-11-14 (pass 13)

**Gjort**
- #17 mergad: behörighet del 1.
- ADR 0018 beslutad. Beviskedja per beslut:
  - Med varje beslut sparas underlaget (`AssessmentInput`), beräkningsmodellen (`vet-care.v1`) och Petvolds version, i samma transaktion.
  - Ny port `getEvidence`. Båda lagringarna klarar sviten med 4 nya tester.
  - Migration 0005: tabellen `claims.decision_evidence`. En uppskjuten trigger kräver underlag för varje nytt beslut, och underlaget kan inte ändras. Provad ner och upp igen.
  - Bevisat i test: underlaget ger samma `inputHash`, och `assess(underlag)` ger exakt den sparade bedömningen, i minnet och efter en tur genom Postgres.
- Avvikelse från förslaget kräver rättigheten `claims:override` (403), skälkod och motivering (422). Beslutet märks `deviatesFromProposal`. Databasen har en check-constraint för samma regel.
- Kontraktet, dokumentationen (skadereglering, behörighet, arkitektur) och dev-servern är uppdaterade. Dev-servern sparar git-commit som motorns version.
- Provat mot dev-servern på Postgres: avslag mot förslaget utan motivering gav 422, med motivering 201, och underlaget finns i databasen.
- 115 tester och 44 databastester.

**Nästa steg**
1. Omräkning av sparade beslut (`POST /v1/claims/{id}/decisions/{seq}/replays`), och scenarier som data som räknas om i CI.
2. Förklaring per beslut och begäran om mänsklig prövning.
3. Behörighet del 2: omfång per marknad och klinik.
4. Attestkedjan med beloppsgränser och utbetalningsorder.

**Tillägg i samma pass**
- #18 mergad.
- Roadmap: förnyelse och avslut som egna punkter i M3, en ADR om policyns livscykel, och tre nya öppna frågor:
  - självriskperiod över förnyelse
  - retroaktivt avslut efter utbetalning
  - premieåterbetalning

**Öppet**
- Beslut som fattades före migration 0005 har inget underlag. Det gäller bara testdata.
- Underlaget innehåller personuppgifter. Gallring per installation kommer med driften.

## 2026-11-14 (pass 12)

**Gjort**
- Mergat: #13 (ADR 0016 behörighet), #14 (dokumentation för funktion och teknik), #15 (ADR 0017 betalningar, väntar till M5), #16 (ADR 0018 beslutsmotor och beviskedja).
- ADR 0016 beslutad. Behörighet del 1:
  - `x-permission` på varje operation i kontraktet, med 401 och 403 som svar.
  - En central kontroll i API:et läser rättigheten ur kontraktet för den matchade operationen. Rättigheterna står inte i koden.
  - Roller översätts till rättigheter per installation (`roles` i `createApp`, standard `DEFAULT_ROLES`). Okända rättigheter stoppar starten.
  - `system` släpper inte längre igenom allt. Ny roll `reassessment-job`.
  - Läsningar, förhandsbesked och försäkringsbelopp kräver nu rättighet.
  - `lint:openapi` stoppar en operation utan giltig rättighet (provat).
- Ny sida `docs/funktion/behorighet.md`, och arkitektur uppdaterad.
- 105 tester.

**Nästa steg**
1. Beviskedja (ADR 0018): underlag och motorns version sparas med beslutet, och motivering krävs vid avvikelse från förslaget (migration 0005).
2. Omräkning av sparade beslut, och scenarier som data som räknas om i CI.
3. Förklaring per beslut och begäran om mänsklig prövning.
4. Behörighet del 2: omfång per marknad och klinik.
5. Attestkedjan med beloppsgränser och utbetalningsorder.

**Öppet**
- En klinik kan läsa alla ärenden tills del 2 är klar.
- Rollinställningen ges i koden (`createApp`). Den ska läsas från installationens konfiguration.
- ADR 0017 och 0018 är föreslagna. 0018 beslutas när beviskedjan byggs. 0017 har öppna frågor till M5.

## 2026-11-14 (pass 11)

**Gjort**
- #12 mergad: valuta i kontonamnen för försäkringsbelopp.
- ADR 0016 om behörighet, föreslagen: rättigheter per anrop i kontraktet (`x-permission`), roller översätts till rättigheter per installation, inget `system` som släpper igenom allt, omfång per marknad och klinik (404 utanför omfånget), beloppsgränser och fyraögonsprincip i kärnan.
- CloudEvents och AsyncAPI väntar tills det finns en mottagare utanför Petvold (tillägg i ADR 0008, flyttat i roadmap). Bara Postgres: pollning nu, LISTEN/NOTIFY om det behövs, pg-boss för jobb.

**Nästa steg**
1. Anton beslutar om ADR 0016.
2. Behörighet del 1: `x-permission` i kontraktet, kontroll i API-lagret, standardroller, lint-regel, ta bort `system`.
3. Behörighet del 2: omfång per marknad och klinik, med migration för klinik-id.
4. Kedjan reserv, beslutsförslag, beslut, attest och betalning, med beloppsgränser (behörighet del 3).

**Öppet**
- Läsningar och förhandsbedömning är oskyddade tills del 1 är klar. Spelar ingen roll lokalt, men måste vara klart före drift.

## 2026-11-14 (pass 10)

**Gjort**
- #11 mergad: dev-servern på Postgres.
- Valuta i kontonamnen för försäkringsbelopp (ADR 0014): `limit_consumed:<valuta>:<djur>:<moment>:<årsstart>`, som `claim_*`-kontona redan har.
- Kontonamnen byggs på ett ställe, `accounts` i `claims-core/src/ledger.ts`. Lagringarna och sviten använder samma funktioner.
- `getConsumed` tar en `LimitKey` (djur, moment, försäkringsår och valuta). Belopp i en annan valuta räknas aldrig med (nytt test i sviten).
- Tjänsten vägrar bokföra om ärendet och policyn har olika valuta. Bedömningen avslår redan sådana ärenden, så det är ett skydd för en journal med en enda valuta.
- Migration 0004 byter namn på befintliga konton med journalens valuta. Provad upp, ner och upp igen med data i gammalt format.
- 98 tester och 36 databastester.

**Nästa steg**
1. ADR om behörighet.
2. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.
3. Kedjan reserv, beslutsförslag, beslut, attest och betalning (resten av M1).
4. Gemensamma kontraktsdelar (Money, Problem, paginering, Ref) och Biome.

## 2026-11-14 (pass 9)

**Gjort**
- #10 mergad: outbox och relä.
- Dev-servern på Postgres: väljer lagring efter `CLAIMS_DATABASE_URL` i `.env`, ansluter som `claims_service` och skriver ut vilken lagring som används. Utan variabeln körs allt i minnet som förut.
- `PostgresIdempotencyStore` i `claims.idempotency`: ett upprepat anrop ger samma svar även efter omstart (4 tester).
- Slumpade id:n i dev-servern, så att id:n inte upprepas mellan omstarter.
- Verifierat: registrera, starta om, samma nyckel ger samma beslut, ärendet och förbrukat belopp finns kvar, och ett nytt anrop för samma ärende ger 409.
- 97 tester och 35 databastester.

**Nästa steg**
1. Valuta i kontonamnen `limit_*` (ADR 0014).
2. ADR om behörighet.
3. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.
4. Kedjan reserv, beslutsförslag, beslut, attest och betalning (resten av M1).

## 2026-11-14 (pass 8)

**Gjort**
- #9 mergad: all kod på engelska.
- Outbox (ADR 0008): `saveClaim` och `commitDecision` tar emot händelser och skriver dem till outboxen i samma transaktion. Tjänsten publicerar inte längre själv.
- Ny port `ClaimsOutbox` (`pendingEvents`, `markPublished`) och `relayOutbox` i kärnan: publicerar i ordning, markerar efter leverans, stannar vid fel och fortsätter från samma händelse nästa gång.
- Sviten utökad med 5 outbox-tester (händelser skrivs atomiskt, inga händelser vid fel, ordning, gräns, publicerade försvinner). Båda lagringarna klarar dem.
- Dev-servern kör reläet varje sekund och loggar händelserna.
- 97 tester och 31 databastester.

**Nästa steg**
1. Dev-servern på Postgres (`npm run dev` sparar data mellan omstarter).
2. Valuta i kontonamnen `limit_*` (ADR 0014).
3. ADR om behörighet.
4. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.

**Öppet**
- Bara ett relä per outbox åt gången. Flera samtidiga reläer kräver radlås (`for update skip locked`).

## 2026-11-14 (pass 7)

**Gjort**
- ADR 0015 beslutad, #8 mergad.
- Regel: all kod på engelska, inklusive kommentarer, felmeddelanden, loggar, testnamn, SQL, konfiguration, kontrakt och exempeldata (`CLAUDE.md`, `docs/arbetssatt.md`). Dokumentation och commits fortsätter på svenska.
- `npm run lint:lang` i CI: stoppar å, ä och ö i koden. Undantag: den svenska språkkatalogen och körda migreringar.
- All befintlig kod översatt: kärnan, API:et, kontraktet med exempel, lagringarna, testerna, `examples/claims.http`, `compose.yaml`, CI och `db/init` (bytt namn till `01-roles-and-databases.sql`). Problem-texterna i API:et är nu på engelska.
- Exempeldata (Bella, fakturarader) på engelska.

**Nästa steg**
1. Outbox: händelser skrivs i samma transaktion som ärendet och beslutet.
2. Dev-servern på Postgres.
3. Valuta i kontonamnen `limit_*` (ADR 0014).
4. ADR om behörighet.

**Öppet**
- Migreringarna 0001–0003 har kommentarer på svenska. De ändras inte eftersom de redan körts.
- Kontrollen hittar inte svenska utan å, ä eller ö. Granskning fångar resten.

## 2026-11-14 (pass 6)

**Gjort**
- `modules/claims-store-postgres`: `PostgresClaimsStore` klarar alla 16 tester i den gemensamma sviten, ansluten som `claims_service`.
- Tjänsten körd mot Postgres: automatisk reglering, handläggarbeslut, förbrukat belopp, omprövning och självriskperiod (3 tester).
- Migration 0003: fakturaradernas ordning (`line_no`) och valuta på journaler (ADR 0014), med ifyllnad av befintliga rader. `LedgerJournal` har `currency`.
- CI backar nu senaste migreringen med data i tabellerna och kör den igen. Det fångade att första versionen av 0003 inte klarade befintliga rader.
- `.env` hade av misstag kommit med i #5. Borttagen ur git (bara lokala dev-värden).
- ADR 0015 beslutad: node-postgres och ren SQL.
- 26 databastester och 88 övriga tester.

**Nästa steg**
1. Outbox: händelser skrivs i samma transaktion som ärendet och beslutet.
2. Dev-servern på Postgres (`npm run dev` sparar data mellan omstarter).
3. Valuta i kontonamnen `limit_*` (ADR 0014).
4. ADR om behörighet: rättigheter i kontraktet, roller per installation, egna ärenden för kliniker, beloppsgränser och fyra ögon.

## 2026-11-14 (pass 5)

**Gjort**
- API-sida på `/docs` i dev-servern (Scalar 1.76.4, genererad från kontraktet, `dev-handler` förifylld).
- Exempel i kontraktet: öroninflammation (automatisk), korsbandsskada (till handläggare), behandling före start (avslag), plus beslut och omprövning. Tester kontrollerar att exemplen följer schemat och ger beskrivet utfall.
- `examples/claims.http` med hela flödet och felfall, och REST Client som föreslaget VS Code-tillägg.
- ADR 0014 beslutad. #6 och #7 mergade.

**Nästa steg**
- Se pass 4: `claims-store-postgres` först.

## 2026-11-14 (pass 4)

**Gjort**
- Gemensam testsvit för `ClaimsStore` (`modules/claims-core/test-suites/claims-store.ts`, 16 tester). Porten säger nu exakt vad som gäller: allt eller inget vid beslut, beslut i löpnummerordning, halvöppna perioder, och `StoreConflictError` för dubbletter och överlapp.
- Sviten hittade fyra skillnader mellan minneslagret och Postgres: dubblett av ärende skrevs över, fel feltyp vid dubblett av beslut, beslut för okänt ärende godtogs, och överlappande perioder godtogs. Alla rättade.
- Tjänsten gör krockar i lagringen till `conflict` (409) i stället för internt fel.
- ADR 0014 beslutad: belopp som heltal med valutan en gång per objekt. Ersätter 0005.
- 85 tester totalt.

**Nästa steg**
1. `claims-store-postgres` som går igenom samma svit, med outbox i samma transaktion och valuta på journalerna (ADR 0014).
2. ADR 0015 om behörighet: rättigheter i kontraktet, roller per installation, egna ärenden för kliniker, beloppsgränser och fyra ögon.
3. Gemensamma kontraktsdelar och Biome.

**Öppet**
- OrbStack-licens när Petvold blir kommersiellt.
- Postgres-versionen i `compose.yaml` och i driften hålls lika för hand.

## 2026-11-14 (pass 3)

**Gjort**
- Utvecklingsmiljö (ADR 0013, beslutad, och `docs/utvecklingsmiljo.md`): `.node-version` (24), `compose.yaml` med Postgres 18.7, dbmate för migreringar, testdatabas och tjänsteroll `claims_service`.
- Migration `0002_claims_grants.sql`: tjänsterollen får bara läsa och lägga till, plus ersätta självriskperioder och markera händelser som publicerade.
- Databastester (`db/test/`, lager 6): balanserade journaler, inga överlappande perioder, historik går inte att ändra eller radera för tjänsterollen.
- CI: samma Node-version som lokalt, och ett jobb som kör `npm run dev:up`, databastesterna och backning av migreringarna.
- Verifierat lokalt med OrbStack: `dev:up` och alla databastester gröna.
- ADR 0011–0013 beslutade. #2, #5 (ersätter #3) och #4 mergade till `main`.

**Nästa steg**
1. Gemensam testsvit för `ClaimsStore` (lager 4) och sedan `claims-store-postgres`.
2. Gemensamma kontraktsdelar: `Money`, `Problem`, sidindelning och `Ref`.
3. Biome för formatering och lint, som egen PR.

**Öppet**
- OrbStack är gratis bara för privat bruk. Köp licens eller byt till Colima när Petvold blir kommersiellt.
- Postgres-versionen i `compose.yaml` och i driften hålls lika för hand. Överväg Renovate.

## 2026-11-14 (pass 2)

**Gjort**
- ADR 0010 beslutad och mergad: en installation per kund.
- `modules/common` med `Money`, `MinorUnits`, `applyBp`, `MarketCode`, `CurrencyCode`, `ISODate`, `DateRange`. 12 nya tester, 55 totalt.
- `claims-core` använder `common`. `Ore` heter nu `MinorUnits`, och `kr()` är borttagen (oanvänd, och text hör inte hemma i kärnan).
- Fel rättat: `assertDate` godkände datum som inte finns, t.ex. `2026-02-30`.
- ADR 0011 (beslutad): gemensam kärna för värdetyper.
- Teststrategi: ADR 0012 (beslutad) och `docs/testning.md`. fast-check införd, 13 egenskapstester för `common` och ersättningsberäkningen, 68 tester totalt. Kontrollerat att ett inplanterat fel (taket borttaget) fångas.

**Nästa steg**
1. Gemensamma kontraktsdelar: `Money`, `Problem`, sidindelning och `Ref` som delad OpenAPI-fil.
2. Docker compose med Postgres och migrationen.
3. `ClaimsStore` mot Postgres.

**Öppet**
- ADR 0005 säger att `Money` är `{ amount, currency }`, men kontraktet och `claims-core` använder heltal med valutan på det omgivande objektet. Välj ett sätt innan fler moduler byggs.
- Licens (se roadmap).

## 2026-11-14 (pass 1)

**Gjort**
- ADR 0010 (beslutad): en installation per kund (silo). Kunderna är etablerade försäkringsbolag eller en egen försäkringsverksamhet, så ingen `tenant_id`.
- Repot skapat. Skademotorn inflyttad och omdöpt till `@petvold/*`. 43 tester gröna, kontraktslint OK.
- Arbetssätt, roadmap, ADR 0001–0009 och CI på plats.

**Nästa steg**
1. Gemensamt schemabibliotek (`modules/common`) och flytta `Money` dit.
2. Docker compose med Postgres och migrationen.
3. `ClaimsStore` mot Postgres.

**Öppet**
- Licens (se roadmap).
