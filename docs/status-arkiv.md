# Statusarkiv

Äldre arbetspass ur [`status.md`](status.md), senaste först. Arkivet ändras inte. Det beskriver läget som det var vid varje pass, så adresser och antal kan vara inaktuella.

## 2026-11-22 (pass 27)

**Gjort**
- Pengar, steg 3a: inbetalningar (ADR 0017, 0040), PR #138. Modulen `payments` med porten `PaymentProvider`, låtsasbanken `fake` (signerad som Petvolds webhooks) och en gemensam svit för adaptrar.
  - `POST /provider-notifications/{provider}` sparar varje inbetalning en gång och ger `payment.succeeded`. Läsning med `GET /v1/payments` och `payments:read`.
  - Migration 0054 med rollen `payments_service`. 642 tester och 177 databastester.
- Demon på en server, PR #143: `deploy/demo/` med Compose, Caddy (HTTPS, lösenord på `/login` och en kaka), `setup.sh` och `reset.sh`. Prövad lokalt hela vägen. Rättat i testdatan: handläggaren följer reglernas förslag, självrisker och ångerfrist som produkten har dem.
- Testdata för demon, PR #142: `npm run demo:seed` gör sex månader dag för dag genom API:t (omkring 100 kunder, 140 policyer, 65 skador, 360 fakturor och 290 inbetalningar). Samma frö ger samma data och id:n. Demobolagets texter, och PDF:er med Gotenberg.
- Demoläget för inloggningen, PR #141: `PETVOLD_AUTH=demo` ger dev-serverns token i servern för drift, med varning i loggen och i `/healthz`. Rättat: en token som `constructor` hittade objektets prototyp.
- Avbildningar för demon, PR #140: `Dockerfile` med målen `api` och `web`, byggda i CI och lagda i GitHubs register från `main`. `tsx` och `dbmate` är vanliga beroenden, eftersom servern och migreringarna behöver dem.
- ADR 0041 om demon, PR #139: en egen server med Docker Compose och Caddy, demoanvändare (`PETVOLD_AUTH=demo`) bakom ett gemensamt lösenord, och testdata som skapas genom API:t sex månader bakåt, dag för dag.

**Nästa steg**
1. Sätta upp demon på en VPS (Anton): domän, server och `./setup.sh`. Sedan demotjänstens fas 1, som tar emot och visar händelserna.
2. ADR 0040, steg 3b: koppla inbetalningar till fakturor, okopplade inbetalningar och `invoice.paid`. Steg 3c: utbetalningar från `claim.payout_ordered`.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.

## 2026-11-21 (pass 26)

**Gjort**
- ADR 0040 om pengar (M5), beslutad 2026-11-21 (PR #127). ADR 0017 beslutades samtidigt:
  - **Tre moduler:** `billing` (premieplaner, fakturor, obetalt), `payments` (ADR 0017) och `accounting` (verifikationer och dagsavslut till bolagets ekonomisystem).
  - **Allt via händelser:** policyhändelserna ger premieplaner, `claim.payout_ordered` ger utbetalningar, och premie tillbaka räknas mot det som faktiskt är betalt.
  - **Obetald premie** blir påminnelse, uppsägning och avslut som körningar, enligt FAL 5 kap.
  - **Betalningsintervall per policy**, med tillåtna intervall, förval och avgift i produkten.
  - **Kunden får ersättningen**, utom när kliniken har avtal om direktreglering.
  - **En adapter per betaltjänst:** bankfiler först, sedan Stripe eller Surfboard (kort och Swish), Autogiro och SEPA, och Swish direkt.
  - **Dagsavslutet som CSV** först. Dröjsmålsränta väntar.

- Spec för en fristående demotjänst (`apps/demo`) som tar emot händelserna, spelar bank och kontrollerar att allt stämmer, som ett dokument. Den byggs separat.

- Händelsekontraktet (PR #128):
  - **`sequence`** på varje webhook: platsen i modulens outbox, som ADR 0033 lovar.
  - **`/petvold/scheduling`** bland källorna, så att `job.failed` följer schemat.
  - **`payout` i `claim.decided`** är beskriven som skadans hela ersättning efter beslutet.
  - 559 tester och 163 databastester.

- Pengar, steg 1: `billing-core` (ADR 0040), PR #129:
  - **Premieplanen** (`premium-plan.v1`): perioder per intervall från termens början, lika belopp för hela perioder med resten på den första, en kortare sista period per dag, skatt och avgift per delbetalning, och den första premiens förfallodag. Kan räknas om med `replayPlan`.
  - **Fördelning av en betalning**, den äldsta först, **en premieändring** på ofakturerade delbetalningar, och **avräkning vid avslut** mot det som är fakturerat och betalt.
  - Egenskapstester för varje funktion. Ny sida: [Premier och betalningar](funktion/premier.md).
  - 582 tester.

- Pengar, steg 2a: betalarkonton och premieplaner (ADR 0040), PR #130:
  - **Modulen `billing`** gör en premieplan av `policy.issued` och `policy.renewed`, på försäkringstagarens betalarkonto (ett per marknad och valuta). Intervallet behålls vid förnyelse om produkten tillåter det.
  - **Produktens `billing`:** `paymentIntervals`, `defaultPaymentInterval`, `installmentFee` och `invoiceLeadDays`, med kontroll.
  - **API:** `GET /v1/payer-accounts`, `.../{id}` och `GET /v1/premium-plans`, med rättigheten `billing:read` och rollen `billing-clerk`. Tre nya operationer, 151 i kontraktet.
  - **Migration 0050:** schemat `billing` med rollen `billing_service`, som bara får läsa och lägga till. Provad ner och upp igen. En befintlig rollinställning behöver `npm run roles:sync -- --apply`.
  - Gallringen ser att en part har en pågående plan.
  - 595 tester och 167 databastester.

- Pengar, steg 2b: fakturor (ADR 0040), PR #131:
  - **Körningen `billing.invoicing`** (04:00) gör en faktura per betalarkonto av delbetalningarna som förfaller inom framförhållningen. En ny policys första premie förfaller tidigast fjorton dagar efter fakturan.
  - **Fakturanummer** ur en obruten serie per marknad och år (`SE-2026-000001`), tagen i fakturans transaktion. **Betalningsreferens:** OCR med längd- och kontrollsiffra i Sverige, RF (ISO 11649) i EUR-marknader.
  - **Händelsen `invoice.issued`** via reläet till webhooks. AsyncAPI har den, och `/petvold/billing` är en ny källa.
  - **API:** `GET /v1/invoices` och `.../{id}`. Två nya operationer, 153 i kontraktet.
  - **Migration 0051:** fakturor, rader, nummerserie och outbox. Provad ner och upp igen.
  - 603 tester och 170 databastester.

- Testerna och arbetssättet (PR #132):
  - **Egenskapstest för faktureringen.** Det hittade att en senare premie kunde förfalla tidigare än lagen tillåter (FAL 5 kap. 1 §: en månad efter fakturan). Rättat, och förvalet för `billing.invoiceLeadDays` är nu 31 dagar (rättelse i ADR 0040).
  - Testerna för migreringar och lagringar uppdaterar sig själva. Status arkiverad, och mindre dokumentation per PR (`CLAUDE.md`, `arbetssatt.md`).

- Fakturan som meddelande (ADR 0040, steg 2b-2), PR #133: `invoice.issued` ger meddelandet `invoice`, som ska skickas på fakturans dag (FAL 5 kap. 1 §), med `invoiceId` i stället för policy. Bolagets text `payment` (vart kunden betalar) krävs, och utan den hamnar fakturan i kön. Migration 0052. 607 tester och 171 databastester.
- Mall för fakturan (PR #134): Petvold gör fakturans PDF med belopp, förfallodag, OCR- eller RF-referens, vart kunden betalar och raderna, på svenska och engelska, när marknaden har `documentMaker: petvold`.
- Betalningsintervall vid tecknandet (PR #135): `paymentInterval` på tecknande och ansökan, kontrollerat mot produkten, sparat på transaktionen och med i `policy.issued`. `billing` gör planen efter det. Valet finns i back office, och exempelprodukterna tillåter år, kvartal och månad. 610 tester.
- Ändring, avslut och överlåtelse mot fakturorna (PR #136): planer som ersätter varandra, en lägre premie dras från det som inte fakturerats (beslut 2026-11-21, ADR 0040), automatiska kreditnotor med `invoice.credited` och `GET /v1/credit-notes`. Egenskapstest för att termen alltid faktureras det den kostar. Migration 0053. 624 tester och 172 databastester.
- Återkallelse av ett avslut (PR #137): `policy.reinstated` lägger tillbaka delbetalningarna och fakturerar det krediterade igen. Egenskapstestet prövar att termen efter avslut och återkallelse faktureras det den kostade före. Steg 2 i ADR 0040 är klart.

**Nästa steg**
1. ADR 0040, steg 3: `payments` med `fake`-adapter: inbetalningar, koppling till fakturor, okopplade inbetalningar och utbetalningar från `claim.payout_ordered`.
2. ADR 0041 om demotjänsten som tar emot händelserna, spelar bank och kontrollerar att allt stämmer.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.

## 2026-11-16 – 2026-11-21 (pass 25)

**Gjort**
- #65 mergad.
- Ansökan med teckningsregler och kundens godkännande (ADR 0031, steg 2 av 3), PR #66:
  - **`POST /v1/applications`** för en produkt med `underwritingSeries`. Reglerna som gäller på ansökningsdagen körs, och ansökan sparas med underlaget: svaren, varje kontroll, reglernas version och kontrollsumma och motorns version.
    - En godkänd ansökan tecknar policyn i samma transaktion.
    - En ansökan som går till manuell prövning väntar i kön `GET /v1/applications?status=referred`.
    - En avslagen ansökan sparas med skälskoderna.
  - **Förbehåll på termen** från teckningsreglerna, med `source`, ansökans id och frågan. Skademotorn läser dem som andra förbehåll.
  - **Godkännandet (F3):** `acceptance` med kanal, referens och kundens tid krävs nu också på `POST /v1/policies`. Petvold lägger till tiden då anropet kom fram, och sparar godkännandet på transaktionen.
  - **`POST /v1/policies` svarar `422`** för en produkt med teckningsregler.
  - **`underwritingSeries` på produktversionen**, med kontroll vid granskning (`underwritingCoverage`).
  - **`GET /v1/application-questions`** ger frågorna på anroparens språk.
  - **Prisindikationen** tar `answers` och säger vad en ansökan skulle leda till.
  - **Händelser:** `application.received`, `.accepted`, `.referred` och `.declined`. Outboxen tar händelser utan policy.
  - **Migration 0029:** `policies.application`, `policy_transaction.issue` och outboxens `application_id`. Provad ner och upp igen.
  - **Exempeldata:** teckningsreglerna `SE-HUND-UW@1` på svenska och engelska, produkten `SE-HUND-PLUS@2026.1` och Lenas tre ansökningar i Uppsala, en med varje utfall. Provat mot Postgres.
  - Fyra nya operationer, 95 i kontraktet.
- 397 tester och 113 databastester.
- #66 mergad.
- Manuell prövning av ansökningar (ADR 0031, steg 3 av 3), PR #67:
  - **`POST /v1/applications/{id}/decisions`** med den nya rättigheten `policies:underwrite` (rollen `underwriter`). Godkänn tecknar policyn till premien kunden ansökte till, med reglernas förbehåll eller egna. Avslå kräver en skälskod. Båda kräver en motivering.
  - **Återkallelse** från kanalen (`.../withdrawals`) och **utgång** efter produktens `policy.applicationExpiryDays` (förval 30) med `POST /v1/application-expiry-runs`.
  - **Beslutet sparas bredvid** det automatiska utfallet (`decision`), och `status` visar beslutet. Ett godkännande sparas i samma transaktion som policyn.
  - **Migration 0030:** `policies.application_decision` och `application.deadline`. En trigger tillåter bara beslut om en ansökan i kön. Provad ner och upp igen.
  - Tre nya operationer, 98 i kontraktet. En befintlig rollinställning behöver `npm run roles:sync -- --apply`.
- 401 tester och 114 databastester.
- #67 mergad. ADR 0031 är byggd.
- ADR 0032 om meddelanden och dokument till kunden (F2), beslutad 2026-11-16 (PR #68):
  - **Petvold avgör vad som ska skickas**, och bolagets dokumentsystem gör och skickar dokumentet. Ett kundmeddelande har typ, mottagare, innehåll som fält, lagrum och sista dag.
  - **En ny modul, `communications`,** skapar meddelanden från händelserna: försäkringsbrev, besked vid förnyelse, bolagets uppsägning, bekräftad uppsägning, avslag med skäl och erbjudande om överlåtelse.
  - **Bevis:** dokumentsystemet rapporterar kanal, tid, dokumentets id och kontrollsumma. Ett meddelande som inte skickats i tid hamnar i en kö.
  - **Produktens dokument** (villkor, förköpsinformation och faktablad) med kontrollsumma, och godkännandet anger vilka som visades.
  - **Källor:** FAL 2 kap. 1–2 och 4–6 §§, 3 kap. 3, 5 och 7 §§, 5 kap. 2 § och 7 kap. 6 §, distansavtalslagen 3 kap., IDD artikel 20 och förordning (EU) 2017/1469.

- #68 mergad. ADR 0032 är beslutad.
- Produktens dokument och godkännandet (ADR 0032, del 1), PR #69:
  - **`documents` på produktversionen:** villkor, förköpsinformation och faktablad per språk, med adress i bolagets arkiv och kontrollsumma. De låses med produktens kontrollsumma. Granskningen kräver alla tre på marknadens språk.
  - **`acceptance.documents`** vid tecknande och ansökan. Villkoren och förköpsinformationen krävs för en produkt med dokument, och ett okänt dokument eller en annan kontrollsumma ger `422`.
  - **`MARKET_LANGUAGES`** i `common` med marknadens språk för dokument.
  - Ingen migrering. Exempelprodukten `SE-HUND-PLUS` har påhittade dokument.
- 405 tester och 114 databastester.

- #69 mergad.
- Kundmeddelanden (ADR 0032, del 2), PR #70:
  - **Ny modul `communications`** med eget schema och egen tjänsteroll. Den gör meddelanden av policymodulens händelser via reläet: försäkringsbrev, besked vid förnyelse, bolagets uppsägning, bekräftad uppsägning och avslag på ansökan.
  - **Innehållet som fält** per schema (`policy-confirmation.v1` med flera), med lagrum och sista dag ur `NOTICE_RULES` per marknad. Partens id, inte namn eller adress.
  - **Rapport om utskick:** skickat med kanal, tid, dokumentets id och kontrollsumma, eller misslyckat med skäl. Status, `late` och `overdue` räknas vid läsning. `attention=true` är kön för en person.
  - **API:** `GET /v1/notices`, `GET /v1/notices/{id}` och `POST /v1/notices/{id}/deliveries`, 101 operationer. Rättigheterna `notices:read` och `notices:deliver`, och rollen `document-service`.
  - **Migration 0031:** `communications.notice` och `communications.delivery`. Provad ner och upp igen. En befintlig databas behöver rollen `communications_service` före migreringen.
- 417 tester och 117 databastester.

- #70 mergad.
- Meddelanden, del 3 (ADR 0032), PR #71:
  - **Erbjudande om överlåtelse** (`transfer-offer`) till den nya ägaren. Policymodulen skriver `proposal.created` i samma transaktion som förslaget.
  - **Bolagets inställningar per marknad** som versioner: dagar för "snarast", typer som lagen inte kräver och som stängs av, och texter per språk (avsändare och hur ett beslut prövas). `GET /v1/notice-settings`, `.../versions` och `POST .../versions`, 104 operationer. Rättigheten `notices:configure` och rollen `communications-manager`.
  - **Ofullständiga meddelanden:** ett avslag utan bolagets text om prövning får `incomplete` och hamnar i kön.
  - **Migration 0032:** `communications.notice_settings`, `notice.settings_version` och typen `transfer-offer`. Provad ner och upp igen.
- 421 tester och 118 databastester. ADR 0032 är byggd, utom skadebesked.

- #71 mergad. ADR 0032 är byggd, utom skadebesked. ADR 0033 om webhooks föreslagen i PR #72.
- #73, #74 och #75 mergade. ADR 0033 beslutad och mergad (#72).
- Konventioner för API-kontraktet (ADR 0034), PR #73:
  - **`docs/teknik/api-konventioner.md`:** regler för adresser, handlingar, inställningar, parametrar, id, fel och listor, och en ordlista över vad "version" betyder.
  - **`lint:openapi` kontrollerar reglerna** med `conventions.ts`. De 29 avvikelser som finns står i `KNOWN_DEVIATIONS`. Listan kan bara krympa.
  - **`/v1` rättas direkt** tills första kanalen är i drift. Därefter krävs `/v2` för en brytande ändring.

- Adresserna rättade enligt konventionerna (ADR 0034), PR #74. `KNOWN_DEVIATIONS` är tom:
  - `/v1/settings/roles`, `/v1/settings/retention` och `/v1/settings/notices` i stället för `/v1/access/roles`, `/v1/retention-settings` och `/v1/notice-settings`
  - `/v1/animal-summaries`, `/v1/parties/searches` och `/v1/product-versions?onSale=` i stället för `/v1/animal-lookup`, `/v1/party-searches` och `/v1/products/on-sale?date=`
  - `/v1/policies/{policyId}/limits` utan djuret, och `getLimits(policyId, onDate)` i skademotorn
  - `.../sales-endings`, `.../members/{policyId}/endings` och `/v1/policy-proposal-expiry-runs`
  - `status` i stället för `state` för skadornas köer, och `policyholderPartyId` för grupper
  - mönster för skadornas id (`clm_`) och beslutsförslag (`prp_`)
  - ett fel i kontraktet rättat: parametrarna till produkter till salu låg i fel ordning, så `date` saknade `in`

- Genomgång av dokumentationen, PR #75:
  - **Inaktuella texter rättade** i `arkitektur.md` (översikt, portar, lagring och händelser för alla moduler), `produktkonfiguration.md`, `policyer.md`, `parter.md`, `teckning.md` och omfånget i `behorighet.md`.
  - **`status.md` har bara det senaste passet.** 24 äldre pass ligger i `docs/status-arkiv.md`.
  - **Kontraktet sorterat** per tagg och adress, med samma innehåll.
  - **`npm run site` stoppar på trasiga länkar** till filer och rubriker.
  - **`docs/README.md`** listar alla sidor, och reglerna för hur vi skriver har fått två tillägg.

- Webhooks, steg 1 (ADR 0033), PR #76:
  - **Modulen `webhooks`** med eget schema och egen roll. Prenumerationer via API:t, och en kö per prenumeration som reläet fyller med policymodulens händelser.
  - **CloudEvents 1.0**, tunna enligt `PUBLIC_EVENTS`, och **signatur enligt Standard Webhooks**. Hemligheten krypteras med `PETVOLD_WEBHOOK_KEY` och kan bytas med 24 timmars överlapp.
  - **Arbetaren** tar förfallna utskick med `skip locked` och försöker igen under tre dygn. `410 Gone` stänger av prenumerationen.
  - **Skydd** mot privata adresser, både när prenumerationen skapas och när adressen slås upp.
  - **API:** sex operationer, 110 i kontraktet. Rättigheterna `webhooks:read` och `webhooks:manage`, och rollen `integration-admin`.
  - **Migration 0033.** Provad ner och upp igen. En befintlig databas behöver rollen `webhooks_service`, och servern i drift behöver `PETVOLD_WEBHOOK_KEY`.
- 435 tester och 121 databastester.

- #76 mergad.
- Webhooks, steg 2 (ADR 0033), PR #77:
  - **Skador, djur och kundmeddelanden** går ut med webhooks. Skadornas händelser plattas ut i `claimsEventForWebhooks`, utan vem som beslutade, kundens ord eller bedömningen.
  - **En outbox i `communications`** (migration 0034) med `notice.created`, `notice.delivered` och `notice.failed`, skrivna i samma transaktion som ändringen.
  - **`modules/api/asyncapi.yaml`** (AsyncAPI 3.0) med 24 händelser och fälten i `data`. `lint:openapi` stoppar om kontraktet och `PUBLIC_EVENTS` skiljer sig åt. Ett test kontrollerar varje händelse som skickas mot kontraktet. Granskningens punkt C1 är därmed klar.
  - **OpenAPI-kontraktets gamla `webhooks`** med hela skadeobjekt är borttagna.
- 437 tester och 122 databastester.

- Webhooks, steg 3 (ADR 0033), PR #78. ADR 0033 är därmed byggd:
  - **Döda händelser:** listan `GET /v1/webhook-deliveries?status=dead` för alla prenumerationer, och att skicka igen en i taget (`.../retries`) eller alla (`.../delivery-retries`), med tre nya dygn.
  - **Automatisk avstängning** när inget har levererats på fem dygn (`failingSince`).
  - **Gallring:** innehållet i levererade och döda händelser tas bort efter 30 dagar.
  - **API-sidan:** varje tagg har en beskrivning, och taggen för webhooks pekar på `asyncapi.yaml`. Sajtens meny har en länk till händelsernas kontrakt.
  - **Migration 0035.** Provad ner och upp igen. 113 operationer.
- 442 tester och 123 databastester.

- #77 och #78 mergade. ADR 0033 är byggd.
- ADR 0035 om ett gränssnitt för handläggare och back office, beslutad 2026-11-16 (PR #79):
  - **`apps/backoffice`** i samma repo, med Lit 3, Web Awesome 3 (bara kärnan med MIT-licens), Vite och TypeScript.
  - **En egen datatabell, `<pv-data-grid>`**, i stället för Web Awesome Pro eller Vaadins tabell. Den sidindelar med API:ts markörer och har tangentbord enligt ARIA.
  - **Typerna genereras från `openapi.yaml`**, och CI stoppar om de glider isär.
  - **OIDC med PKCE**, och token bara i minnet. `GET /v1/me` styr menyerna.
  - **Svenska och engelska**, WCAG 2.1 AA och Playwright i CI.
  - **Fem steg:** grunden med skadornas köer, skador, policyer och ansökningar, meddelanden och webhooks, och inställningar.

- #79 mergad.
- Back office, steg 1 (ADR 0035), PR #80:
  - **`apps/backoffice`** med Lit, Web Awesome, Vite och TypeScript. Dev-tokens lokalt och OIDC med PKCE i drift. Menyn följer `GET /v1/me`.
  - **`<pv-data-grid>`** med tangentbord enligt ARIA, "Visa fler" med markör, och lägen för laddning, tomt och fel.
  - **Skadornas köer och ärende:** bedömning, beräkning och beslut, bara läsning.
  - **Svenska och engelska.** Ikonerna kopieras lokalt från Font Awesome Free, så inget hämtas från ett CDN.
  - **Typerna genereras från `openapi.yaml`.** Det nya CI-jobbet `ui` jämför typerna, typkontrollerar, kör enhetstester och fyra flödestester i Chromium, och bygger.

- #80 mergad.
- Back office, steg 2 (ADR 0035), PR #81:
  - **Besluta** med förslaget förvalt. Mot förslaget krävs skälkod och motivering, och `claims:override`. Över gränsen blir det ett förslag.
  - **Attestera eller skicka tillbaka** med fyra ögon. **Begära prövning** av ett automatiskt beslut, **ompröva**, och **förklaringen** till varje beslut.
  - **Idempotensnyckel och `expectedInputHash`** på varje åtgärd. `409` blir ett besked med "Ladda om".
  - **Tester:** varje text-id har en svensk översättning, och fem nya flöden i Chromium, nio totalt.

- #81 mergad.
- Back office, steg 3 (ADR 0035), PR #82:
  - **Policyer:** sökning på id, personnummer (med `POST`) eller chip, och policyn med termer, förbehåll, versioner över tid och historik.
  - **Ansökningar:** kön för manuell prövning, och godkänn eller avslå med motivering och skälkod, eller återkalla.
  - **Förslag:** kön, och godkänn eller avböj en överlåtelse eller ett avslut från policyn.
  - **Tester:** 15 enhetstester och 12 flöden i Chromium.

- #82 mergad.
- Back office, steg 4 (ADR 0035), PR #83:
  - **Meddelanden:** kön med det som behöver en person, och meddelandet med innehåll, lagrum och utskick. Rapportera ett utskick.
  - **Webhooks:** prenumerationer och döda händelser. Skapa, stänga av och sätta på, ny hemlighet som visas en gång, och skicka igen.
  - **Tester:** 18 enhetstester och 14 flöden i Chromium.

- #83 mergad.
- Back office, steg 5a (ADR 0035), PR #84:
  - **Inställningar:** roller och gränser, gallring och bolagets texter för meddelanden. Varje ändring blir en version med skäl, och historiken visas.
  - **Flödestesterna körs med en enda arbetare.** De delar en server och bygger på ordningen, och med flera arbetare kördes filerna samtidigt.
  - **Tester:** 22 enhetstester och 17 flöden i Chromium.

- #84 mergad.
- Back office, steg 5b (ADR 0035), PR #85. ADR 0035 är därmed byggd:
  - **Produkter och regeluppsättningar** med versioner och hela livscykeln: nytt utkast från en version, ändra som JSON, skicka till granskning, publicera med fyra ögon, skicka tillbaka, avsluta försäljning och avveckla.
  - **En gemensam komponent**, `<pv-versions-panel>`, med en adapter per sort.
  - **API:ts fel per fält** visas vid `422`.
  - **Tester:** 25 enhetstester och 19 flöden i Chromium.

- #85 mergad. ADR 0035 är byggd.
- Designsystemet Petvold, PR #86:
  - `design/tokens.json` som källa, `petvold-tokens.css` och ett tema för Web Awesome (`wa-theme-petvold`). Svartvitt, med ramar i stället för skuggor, och tillstånd med helfylld eller streckad linje i stället för färg.
  - Typsnitten Inter, Space Grotesk och IBM Plex Mono från `@fontsource`, inbyggda i appen.
  - `design/components.css` med komponenterna som `pv-`-klasser, och riktlinjer i `docs/teknik/designsystem.md`. `CLAUDE.md` och `AGENTS.md` hänvisar dit.

- Back office enligt designsystemet, PR 1 av 3, PR #87 (bygger på #86):
  - **Toppraden** på `--panel-inverse` med Petvold, Back office, sökfält, språkval och Logga ut.
  - **Menyn** med val som är 44 px höga, det valda valet i `--ink`, och räknare för köerna som väntar.
  - **Sökfältet** öppnar ett känt id direkt och söker annars bland policyerna. Frågan skickas i historikens tillstånd, aldrig i adressen.
  - **`pvComponents`** läser in `design/components.css` i komponenternas `static styles`.
  - **Tester:** 27 enhetstester och 21 flöden i Chromium.

- Back office enligt designsystemet, PR 2 av 3, PR #88 (bygger på #87):
  - **Kontraktet:** bedömningen har `routing`, alltså varför ärendet behöver en handläggare. Den räknas fram vid läsning och sparas inte.
  - **Skadeärendet:** huvud med brödsmula, id som kopieras, helfyllt eller streckat märke för status, och en rad med djur, kund, policy och mottagning. Därunder två spalter: underlaget till vänster, beslutet och historiken till höger.
  - **Beslutskortet:** skälen till att ärendet gick till en handläggare, valkort med en rad om följden, och en knapp som säger vad som händer med beloppet. Ett avslag kräver alltid en motivering.
  - **Belopp på svenska** visas utan ören när beloppet är jämnt, till exempel "12 165 kr".
  - **Tester:** 445 tester i kärnan och API:t, 29 enhetstester i back office och 21 flöden.

- Back office enligt designsystemet, PR 3 av 3, PR #89 (bygger på #88):
  - **`<pv-waterfall>`** visar beräkningen med en rad per steg, staplar i procent av det fakturerade beloppet, skrafferade avdrag och regeln för varje steg.
  - **`<pv-event-log>`** visar historiken nyast först på `--panel-inverse`, med händelsernas namn och "Varför?" på besluten.
  - **Korten för attest, prövning och omprövning** är `pv-card`.
  - **Tester:** 34 enhetstester och 22 flöden.

- Registrera skada i back office, PR #90:
  - **Formuläret** nås från skadornas kö och från en policy. Policyn ger marknad, valuta och djur, så att de inte kan bli fel.
  - **Fakturarader** har beskrivning, kategori, belopp och moms.
  - **Förhandsbedömningen** (`POST /v1/claim-previews`) visar förslaget, reglerna att titta på och beräkningen innan något sparas. Registreringen skickar en idempotensnyckel och öppnar sedan ärendet.
  - **`<pv-waterfall>`** följer sin egen bredd med en container query och fungerar också i den smala spalten.
  - **Roadmapen** har ett nytt avsnitt: skadeprocessen hela vägen, före M5.
  - **Tester:** 38 enhetstester och 24 flöden.
  - **Rättat i PR #92:** fälten i formuläret ligger i linje, och "Hämta policyn" sitter inuti policyfältet.

- ADR 0036, skadeprocessen (beslutad), PR #91:
  - **Lägen:** två nya, väntar på underlag och stängt (återkallat eller avvisat).
  - **Komplettering** med påminnelse och utgång, och `basisCompleteAt` för fristen i FAL 7 kap. 1 §.
  - **Rättelse** med revisioner av ärendet.
  - **Bilagor** som referenser till bolagets arkiv.
  - **Skadenummer** från servern, och **skadebesked** till kunden.
  - **Kunden får ett meddelande** när en komplettering går ut. Bolaget kan stänga av det.
  - **Utförande:** sex PR:er med kontraktet först.
  - **Roadmapen** har ett nytt avsnitt om dokument: skapande med Carbone i en egen container och ett enkelt dokumentarkiv.

- Skadeprocessen, steg 1, PR #93: skadenummer och id från servern (ADR 0036).
  - **Kontraktet:** `id` och `claimNo` är valfria i `ClaimInput`, och ett sparat ärende har alltid båda.
  - **Serien** finns per installation och år (migration 0036) och är atomisk i Postgres. Prefixet sätts per marknad med `PETVOLD_CLAIM_NUMBER_PREFIX`, och året räknas i marknadens tidszon.
  - **Back office** väljer inte längre id eller skadenummer.
  - **Roadmapen:** Gotenberg är förstavalet för dokumentskapande.
  - **Tester:** 453 i kärnan och API:t, 125 mot databasen, 36 enhetstester och 24 flöden i back office.

- Skadeprocessen, steg 2, PR #94: återkallelse och avvisning (ADR 0036).
  - **Två nya lägen,** `withdrawn` och `dismissed`, som står först i ordningen.
  - **Anropen:** `POST /v1/claims/{id}/withdrawals` (`claims:register`) och `.../dismissals` (`claims:decide`), bara före ett beslut.
  - **Vid avslutet** skickas öppna förslag tillbaka och reserven löses upp. Databasen hindrar beslut på stängda ärenden och avslut efter beslut (migration 0037).
  - **Webhooks:** `claim.withdrawn` och `claim.dismissed`, utan motiveringen.
  - **Back office:** kortet "Stäng utan beslut", ett kort för det stängda ärendet, händelsen i historiken och två nya flikar i kön.
  - **Tester:** 460 i kärnan och API:t, 129 mot databasen, 38 enhetstester och 25 flöden i back office.

- Inventering av back office (PR #95): back office använder 68 av API:ets 115 operationer. Det som saknas står i roadmapen under "Back office: det som saknas", och körningar har ett eget avsnitt.

- ADR 0037, körningar (beslutad), PR #96:
  - **En modul, `scheduling`,** med schema per körning (`daily` per marknad eller `interval`), lån i databasen vid flera servrar och historik i 400 dagar.
  - **Reläet** blir en enda server åt gången, och dess döda poster sparas.
  - **Styrning:** "Kör nu" och paus direkt (`jobs:operate`), schemaändringar med fyra ögon (`jobs:configure`), och `job.failed` och hälsokontrollen larmar.
  - **Back office** får sidan Körningar.
  - **Utförande:** fem PR:er.

- Körningar, steg 1, PR #97 (ADR 0037):
  - **Modulen `scheduling`** med `Scheduler`, lån i `scheduling.lease`, historik i `scheduling.run` (migration 0038) och en gemensam testsvit för minnet och Postgres.
  - **Körningarna:** utgång av ansökningar och förslag, förnyelse och gallring körs varje dag per marknad, i marknadens tid, med resultat utan personuppgifter.
  - **Servern för drift** startar schemaläggaren. Dev-servern gör det bara med `PETVOLD_SCHEDULER=on`.
  - **Driften** behöver `SCHEDULING_DATABASE_URL` och rollen `scheduling_service`.
  - **Tester:** 473 i kärnan och API:t, 135 mot databasen och 25 flöden.

- Körningar, steg 2, PR #98 (ADR 0037):
  - **Reläet** går bakom lånet `relay`: en server i taget levererar, och de andra tar över när lånet går ut eller servern stängs.
  - **Döda poster** sparas i `scheduling.relay_dead_letter` (migration 0039) och finns kvar efter en omstart. `retryDeadLetter` skickar en igen.
  - **`/healthz`** visar om servern är reläet.
  - **`drift.md`** säger nu att Petvold kör körningarna själv.
  - **Tester:** 476 i kärnan och API:t och 136 mot databasen.

- Körningar, steg 3, PR #99 (ADR 0037):
  - **API:** `/v1/jobs` med lista, historik, "Kör nu", paus och återupptagande, och `/v1/relay-dead-letters` med "Skicka igen". Rättigheterna är `jobs:read` och `jobs:operate`, och den nya rollen heter `operations`.
  - **Gamla anrop:** `POST /v1/renewal-runs` och de andra går genom schemaläggaren per marknad, sparar historik som "Anrop" och svarar som förut.
  - **Paus och spår** (migration 0040). En pausad körning hoppas över av schemaläggaren.
  - **Back office:** sidan Körningar med försenade körningar, döda poster och en sida per körning. Dev-tokenen heter `dev-operations`.
  - **Tester:** 483 i kärnan och API:t, 137 mot databasen, 42 enhetstester och 26 flöden.

- Körningar, steg 4, PR #100 (ADR 0037):
  - **Schemaändringar med fyra ögon:** en person föreslår en tid eller avstängning, en annan godkänner eller avvisar. Lagras i `scheduling.job_setting` och `scheduling.job_schedule_change` (migration 0041). Rättigheten är `jobs:configure`.
  - **`job.failed`** går till webhooks, utan felet.
  - **`/healthz`** blir `degraded` av körningar som misslyckats, är mer än en timme sena eller är pausade.
  - **Back office:** kortet Schema på körningens sida, och spåret visar ändringarna. Dev-tokenen `dev-operations-2` behövs för fyra ögon.
  - **Tester:** 488 i kärnan och API:t, 138 mot databasen, 43 enhetstester och 27 flöden.

- Back office, parter, PR #101:
  - **Avsnittet Parter:** sök med nummer eller id, registrera, partens sida med uppgifter, nummer och policyer, ändring med skäl, nytt nummer och begäran om radering, och historiken.
  - **Sökfältet** i toppraden öppnar en part för ett `pty_`-id.
  - **Tester:** 46 enhetstester och 28 flöden.

- Back office, djur, PR #102:
  - **Avsnittet Djur:** sök på chip, registreringsnummer, pass, ägare eller id; registrera ett djur och en kull; djurets sida med rättelse, nummer, ägarbyte, policyer och historik.
  - **Partens sida** visar djuren parten äger, och sökfältet öppnar ett djur för ett `ani_`-id.
  - **Tester:** 50 enhetstester och 29 flöden.

- Back office, policyer, PR #103:
  - **Teckna försäkring** från djurets sida, med produkt som säljs, prisindikation, premie för hand utan tariff och kundens godkännande med dokument.
  - **Åtgärder på policyn:** ändra valen, säga upp, ångra uppsägningen och förnya för hand.
  - **Tester:** 55 enhetstester och 30 flöden.

- Back office, ansökan och grupper, PR #104:
  - **Ansökan:** en produkt med hälsofrågor visar frågorna när man tecknar, och svaren skickas som en ansökan. Prisindikationen visar vad svaren skulle ge.
  - **Grupper:** partens sida listar och skapar kull- och hushållsgrupper, och gruppens sida har medlemmar som kan läggas till och avslutas.
  - **Tester:** 56 enhetstester och 32 flöden.

- Back office, radering, PR #105:
  - **Avsnittet Radering:** kön för begäranden med räknare.
  - **Godkännande** av en annan dataskyddsansvarig, och **avslag** med begränsning till ett datum när personen själv bad om det.
  - **Inloggningen** erbjuder nu `dev-privacy-2`.
  - **Tester:** 58 enhetstester och 33 flöden.

- Komplettering av skador (ADR 0036, steg 3, och ADR 0037, steg 5), PR #106:
  - **`POST /v1/claims/{id}/information-requests`** till kunden eller kliniken, med vad som saknas och ett valfritt svarsdatum. Svar (`…/answers`) och återkallelse (`…/cancellations`). Den nya rättigheten `claims:request-information` ingår i rollen `handler`.
  - **Läget `awaiting-information`.** Ärendet kan inte beslutas medan en begäran är öppen.
  - **Körningen `claims.information-requests`** klockan 06:00 påminner och låter begäranden gå ut. Dagarna kommer från skadereglernas `informationRequest`, förval 14 och 30. En utgången begäran avslår inte ärendet. Ärendet får `informationMissing`.
  - **`basisCompleteAt` och `daysSinceBasisComplete`** för fristen i FAL 7 kap. 1 §, på ärendet och i kön.
  - **Händelser:** `claim.information_requested`, `_reminded`, `_received`, `_expired` och `_cancelled`, till webhooks utan fritexten.
  - **Migration 0042:** `claims.information_request` med trigger för reglerna. En befintlig rollinställning behöver `npm run roles:sync -- --apply`.
  - **Back office:** kortet för komplettering, fliken "Väntar på komplettering", kolumnen "Underlaget komplett" och dagar kvar att betala.
  - **E2E-testet för avvisning** var beroende av dagens datum: förslaget i testet blev ett avslag den 20 november. Testet är rättat.
  - 131 operationer i kontraktet.
- 504 tester, 145 databastester, 62 enhetstester och 34 flöden i back office.
- Startdag i förväg, PR #107:
  - **`policy.maxStartAheadDays`** på produkten, 0–365 och förval 90. Det kontrolleras vid tecknande, ansökan, godkännande av en ansökan och prisindikation, men inte vid förnyelse.
  - **Back office** sätter ett tak på datumväljaren och stoppar ett datum som ligger längre fram.
  - 505 tester och 63 enhetstester i back office.

- Rättelse av skador (ADR 0036, steg 4), PR #108:
  - **`POST /v1/claims/{id}/corrections`** för behandlingsdagar, diagnos, fakturarader och kanal, med skäl och `expectedRevision`. `GET …/revisions` listar revisionerna.
  - **Efter ett beslut:**
    - En persons beslut öppnas igen för en person.
    - Ett automatiskt beslut står kvar vid samma utfall och fattas om när utfallet ändras och fortfarande får beslutas automatiskt. Annars går ärendet till en handläggare.
  - **Beslutet sparar revisionen** (`claimRevision`). Revisionen ingår inte i bedömningens indata, så gamla beslut räknas om som förut.
  - **Migration 0043:** `claims.claim_correction`. Ärendet och raderna ändras aldrig.
  - **Händelsen `claim.corrected`** till webhooks, med de ändrade fälten men utan värdena.
  - **Back office:** "Rätta" i ärendets huvud öppnar formuläret ifyllt. Huvudet visar revisionen, och historiken visar rättelserna.
  - 133 operationer i kontraktet.

- Formulär för produkter och skaderegler i back office, PR #109:
  - **En produktversion** redigeras i ett formulär: marknad, namn, arter, serier, försäkringsbelopp, självrisker med steg efter ålder och inställningar för policyer.
  - **Skaderegler** har ett eget formulär: gränsen för automatiskt beslut, moms, kategorier, diagnosgrupper och dagarna för komplettering.
  - **JSON som alternativ.** Det går att växla till JSON, och det som formuläret inte visar finns kvar. Tariffer, prisvillkor och teckningsregler redigeras fortfarande som JSON.
  - **En vald version** visar en sammanfattning.
  - 69 enhetstester och 35 flöden i back office.

- Teckna från kunden, PR #110:
  - **Knappen "Teckna försäkring"** finns nu också på kundens sida och på sidan Policyer, inte bara på djurets sida.
  - **Från kunden** listar formuläret kundens levande djur att välja bland.
  - 36 flöden i back office.

- Bilagor till skador (ADR 0036, steg 5), PR #111:
  - **`POST` och `GET /v1/claims/{id}/attachments`:** typ, mediatyp, storlek, sha256 och adress i bolagets arkiv. Petvold sparar aldrig filen.
  - **En bilaga ändras aldrig.** En ny kan ersätta den en gång.
  - **Varje beslut sparar** de bilagor som gällde, med id och kontrollsumma, och förklaringen visar dem i `basis.attachments`. De ingår inte i `inputHash`.
  - **Migration 0044:** `claims.claim_attachment` och `decision_evidence.attachments`.
  - **Händelsen `claim.attachment_added`** går till webhooks.
  - **Back office:** kortet "Bilagor" med länk till arkivet och formuläret för en ny bilaga.
  - 135 operationer, 520 tester, 152 databastester, 71 enhetstester och 37 flöden i back office.

- dev-all och djur som redan är försäkrade, PR #112:
  - **`dev-all` och `dev-all-2`** i dev-servern har alla roller i back office. Det är två personer, så att fyra ögon går att prova.
  - **Formuläret för att teckna** visar när djuret redan är försäkrat, och från vilken dag en ny policy kan börja.
  - 72 enhetstester och 38 flöden i back office.

- Skadebesked och meddelanden om komplettering (ADR 0036, steg 6), PR #113:
  - **Varje beslut** blir ett skadebesked (`claim-decision`) till försäkringstagaren, med utfall, belopp, beräkningen, avvikelsen och bolagets text om prövning.
  - **En begäran till kunden** ger `claim-information-request`, och påminnelsen och utgången ger var sitt meddelande. Utgången går att stänga av.
  - **Meddelandemodulen** läser skademotorn genom porten `ClaimSource`, och reläet skickar skadornas händelser dit.
  - **Migration 0045:** meddelandets typer.
  - **Back office:** ärendets historik visar meddelandena till kunden.
  - ADR 0036 är byggd. 524 tester, 152 databastester och 39 flöden.

- ADR 0038 om dokument, beslutad 2026-11-20, PR #114:
  - **Gotenberg** i en egen container utan nätåtkomst, och mallar i HTML/CSS med designsystemets tokens.
  - **Modulen `documents`** med ett arkiv i S3-lagring (MinIO lokalt).
  - **Systemen sparar dokumentets id,** och länkar som slutar gälla skapas när de behövs, loggas och kan spärras. Ingen permanent hemlig adress.
  - **Bolagets dokumentsystem finns kvar** som förval.
  - **Alla dokument för en kund** visas på kundens sida, också de i bolagets arkiv (`GET /v1/documents?partyId=`).

- Dokument, steg 1 (ADR 0038), PR #115:
  - **Modulen `documents`:** uppladdning till en skada (`POST /v1/claims/{id}/documents`), högst 25 MB och PDF, JPEG, PNG eller HEIC som stämmer med innehållet, med Petvolds egen sha256.
  - **`GET /v1/documents?partyId=`** listar kundens dokument, bara det anroparen får se.
  - **Länkar** som slutar gälla (15 minuter internt, högst 7 dagar för kunden), signerade, loggade och möjliga att spärra. `/d/{token}` svarar `410` när länken inte fungerar.
  - **Arkivet:** S3 med `@aws-sdk/client-s3`, och SeaweedFS (Apache 2.0) i docker compose i stället för MinIO.
  - **Rättigheterna** `documents:read` och `documents:share`.
  - **Migration 0046:** schemat `documents`.
  - 141 operationer, 536 tester och 156 databastester.

- Dokument, steg 2 (ADR 0038), PR #116:
  - **Uppladdning från back office:** kortet "Bilagor" laddar upp en fil till arkivet och skapar bilagan `urn:petvold:doc:{id}`. API:t prövar att dokumentet hör till ärendet och stämmer.
  - **Kundens dokument:** `GET /v1/parties/{id}/documents` samlar Petvolds arkiv, brev som bolagets dokumentsystem skickat och bilagor i bolagets arkiv. Kortet "Dokument" finns på kundens sida.
  - 142 operationer, 74 enhetstester och 40 flöden i back office.

- Dokument, steg 3 (ADR 0038), PR #117:
  - **Gotenberg 9.1.0** i docker compose, utan nätåtkomst, JavaScript eller hämtning för Chromium.
  - **Mallar** i HTML och CSS med designsystemets tokens för skadebesked och försäkringsbrev, på svenska och engelska, med version och kontrollsumma.
  - **`POST /v1/notices/{id}/documents`** gör meddelandet till PDF/A-2b och PDF/UA-1 och sparar mallen och datans hash. `GET /v1/documents?noticeId=` listar dokumenten.
  - **Back office:** kortet "PDF från Petvold" på meddelandets sida.
  - **Migration 0047.** 143 operationer, 543 tester, 158 databastester och 41 flöden.

- Dokument, steg 4 (ADR 0038), PR #118:
  - **Inställningen `documentMaker`** per marknad: `insurer` (förval) eller `petvold`. `petvold` kräver Gotenberg.
  - **Reläet gör PDF:en** av skadebesked och försäkringsbrev efter `notice.created`. Meddelandet får `document`, och `notice.document_made` går till webhooks.
  - **Utskicket rapporteras** med bara kanal och tid. Petvold fyller i sitt dokument.
  - **Back office:** valet under Inställningar → Meddelanden, och vem som gör dokumentet på meddelandets sida.
  - **Migration 0048.** 547 tester, 159 databastester och 42 flöden.

- End-to-end-scenarier för en hel kundresa, att testa för hand, och en lista över det som saknas i gränssnittet (`docs/end-to-end-scenario.md`), PR #119.

- Partens livscykel (ADR 0039), PR #120:
  - **Sökning** på namn och e-post, i anropets innehåll, med en lista i back office.
  - **Nummer** tas bort med ett skäl och finns kvar som historik.
  - **Begränsning** sätts och hävs direkt.
  - **Avslut** och återöppning. En försäkringstagare med en policy som löper kan inte avslutas.
  - **Migration 0049.** 148 operationer, 43 flöden.

- Partens sida (PR #121): numren ligger i kortet Uppgifter, och djurlistan visar vilken policy som försäkrar varje djur, med "Teckna försäkring" för ett djur utan policy. 44 flöden.

- Policysidan enligt designsystemet (PR #122): rubrik och fakta som på skadan, försäkringsbeloppet som återstår, skadorna på policyn, och åtgärder och historik i högerkolumnen. Mönstret står i designsystemet som "Detaljsidan".

- Ansökans sida enligt designsystemet (PR #123): rubrik och fakta som på skadan, reglerna och svaren till vänster, och prövningen med val, beslutet och historiken till höger.

- Meddelandets sida enligt designsystemet (PR #124): innehåll, lagrum och utskick till vänster, och PDF, rapport om utskick och historik till höger.

- Webhookens sida enligt designsystemet (PR #125): utskicken per flik och uppgifterna till vänster, och åtgärderna till höger.

- Produktens och regeluppsättningens sidor enligt designsystemet (PR #126). Alla detaljsidor i back office följer nu mönstret.

## 2026-11-15 (pass 24)

**Gjort**
- #34 och #35 mergade.
- Dokumentationen och API-specen publiceras på GitHub Pages, PR #36:
  - **`npm run site`** bygger `_site/` från all Markdown i `docs/` och README, med länkar mellan sidorna och länkar till koden på GitHub. Den stoppar vid trasiga länkar.
  - **API-sidan** (`api/`) är Scalar med `openapi.yaml`, samma som dev-serverns `/docs` men utan förifylld token.
  - **Arbetsflödet `Pages`** publicerar efter varje merge till `main`. CI bygger sajten i varje PR.
- #36 mergad. Sajten är uppe på https://antonaasvold.github.io/petvold/.
- Parter i den nya modulen `parties` (ADR 0026, Beslutad), PR #37:
  - **Personer och organisationer** med namn, kontaktuppgifter, adress och språk, som revisioner med motivering. Sort och marknad ändras aldrig.
  - **Personnummer och organisationsnummer** med land, unika och aldrig borttagna. Svenska nummer kontrolleras (datum, kontrollsiffra, samordningsnummer).
  - **Personnummer visas aldrig.** Svaren maskerar dem, och sökningen sker med `POST /v1/party-searches`, så att numret inte hamnar i adresser eller loggar.
  - **Roller ligger i modulen som har relationen**, inte på parten.
  - **API:** sex operationer. Nya rättigheter `parties:read` och `parties:write`, och ny roll `party-registrar`.
  - **Migration 0017:** schemat `parties` och rollen `parties_service`. Provad ner och upp igen.
  - **Dev-servern** registrerar Bellas ägare `pty_owner001`. `dev-registrar` får även rollen `party-registrar`. Lokal rollinställning är version 6.
- 281 tester och 95 databastester.
- #37 mergad.
- Djurregistret kontrollerar ägaren (ADR 0026, punkt 8), PR #38:
  - **Ägaren måste finnas och höra till djurets marknad** vid registrering och ägarbyte. Annars blir svaret `422`, med samma svar för en part som saknas och en part i en annan marknad.
  - **Porten `PartyPort`** i `animals`, som `PartyService.marketOf` uppfyller. API-lagret och dev-servern kopplar ihop dem.
- 282 tester och 95 databastester.
- #38 mergad.
- Kullar i djurregistret (ADR 0027, Beslutad), PR #39:
  - **`POST /v1/litters`** registrerar alla djur i kullen på en gång, ägda av uppfödaren från födelsedatumet. `GET /v1/litters/{id}` visar kullen.
  - **Föräldrarna kontrolleras:** samma art och marknad, mor hona och far hane, födda före kullen. Rasen ärvs om båda har samma.
  - **Varje djur visar `litterId`**, och en valp säljs med ett vanligt ägarbyte.
  - **Migration 0018:** `animals.litter` och `animals.litter_member`. Provad ner och upp igen.
- 286 tester och 96 databastester.
- #60 mergad.
- Drift: kompositionsrot, relä och inloggning (granskningen A1, A2, A5), PR #61:
  - **`composition.ts`** kopplar ihop alla moduler en gång, både för `server.ts` (drift) och `dev-server.ts`. Exempeldatan ligger i `seed.ts`.
  - **`server.ts`** (`npm start`): kräver alla databasadresser, `PETVOLD_VERSION` och inloggning. Den har `/healthz` och stänger ordnat vid SIGTERM.
  - **Reläet** för alla tre outboxar levererar i ordning, gör omförsök med växande paus och lägger händelser som döda bokstäver efter 10 försök.
  - **Inloggning med JWT:** verifiering mot JWKS eller OpenID-konfiguration, utfärdare, mottagare och asymmetriska algoritmer. Roller, marknader och bindningar läses ur token, och fälten går att ställa in. Nytt beroende: `jose` 6.2.14.
  - **Ny sida** `docs/teknik/drift.md`.
  - Provat: servern med en lokal nyckeltjänst gav `200` med en signerad token, `401` med dev-token, `ok` på `/healthz` och ordnad avstängning.
- 366 tester och 111 databastester.
- #61 mergad.
- Listor och sidindelning före ett gränssnitt (granskningen A4), PR #62:
  - **Sidindelning på alla 18 listor:** `limit` och `cursor` in, `nextCursor` ut, med gemensamma parametrar i kontraktet.
  - **`GET /v1/claims`** med arbetsköer: status per ärende (`awaiting-decision`, `awaiting-approval`, `review-requested`, `decided`), filter på marknad, policy och djur, och anroparens omfång.
  - **`GET /v1/products`** och **`GET /v1/rule-sets`** listar alla produkter och serier med versionernas status.
  - Tre nya operationer, 90 i kontraktet.
- 369 tester och 112 databastester.
- #62 mergad.
- Inför ett gränssnitt, PR #63:
  - **`GET /v1/me`** visar anroparens roller, rättigheter, omfång och beloppsgränser. Alla inloggade får anropa den (`x-permission: signed-in`), och ingen annan operation får ha den markören.
  - **CORS** för uppräknade ursprung (`PETVOLD_CORS_ORIGINS`). Dev-servern tillåter `localhost:5173` och `localhost:3000`, och drift har inga som förval.
  - **Exempeldata:** Bellas skador i varje arbetskö, Doris i Göteborg och ett hushåll i Malmö med två hundar med grupprabatt och en katt utan försäkring.
  - **`AGENTS.md`** för Cursor och andra agenter, med hur man bygger mot API:t.
  - Provat: dev-servern mot Postgres efter `dev:reset`, två starter i rad. Köerna, `/v1/me`, preflight och policyerna svarade som väntat.
- 373 tester och 112 databastester.
- #63 mergad.
- ADR 0031 om teckningsregler, ansökan och godkännande vid tecknande (F1, F3), Beslutad, PR #64:
  - **Teckningsregler** som en versionerad serie i `decisioning` (`underwriting.v1`). De innehåller åldersgränser per art, hälsofrågor, regler för svaren och raser.
  - **En ren funktion** i den nya modulen `underwriting-core`. Utfallen är godkänd, godkänd med förbehåll, manuell prövning och avslag med skälskod.
  - **Ansökan sparas** i policymodulen med underlaget (`POST /v1/applications`). Den har en kö för manuell prövning och den nya rättigheten `policies:underwrite`.
  - **Godkännandet** sparas med kanal, referens och tid vid varje tecknande.
  - **Källor:** FAL 2 kap. 2 §, 3 kap. 1–2 §§, 4 kap. 1–2 §§ och 7 kap. 6 §, och VVG § 19.
- #64 mergad. ADR 0031 beslutad.
- Teckningsregler, steg 1 av 3 (ADR 0031), PR #65:
  - **Ny modul `underwriting-core`** med den rena funktionen `underwrite`. Den prövar art, ålder på startdagen, ras och svaren på hälsofrågorna. Utfallen är godkänd, godkänd med förbehåll, manuell prövning eller avslag med skälskoder, och varje kontroll redovisas. Samma ansökan ger samma `inputHash`.
  - **Serier med `underwriting.v1`** i `decisioning`, med samma livscykel som tariffer. Den nya funktionen `underwritingInForce` hämtar reglerna, och `GET /v1/rule-sets` visar sorten `underwriting`.
  - **Kontraktet:** schemat `UnderwritingContent`.
  - **Ny sida** `docs/funktion/teckning.md`.
- 388 tester och 112 databastester.
- #59 mergad.
- Datum i marknadens tidszon (granskningen, A3), PR #60:
  - `marketDate(market, tidpunkt)` och `MARKET_TIME_ZONES` i `common`, med 15 europeiska marknader. En okänd marknad räknar i UTC.
  - Alla 18 ställen som räknade "i dag" i UTC använder nu objektets marknad: djurregistret, katalogen, parter, gallringen och policyer (tecknande, ändring, avslut, förnyelse, överlåtelse och grupper).
  - Test: klockan 00:30 i Stockholm går det att teckna från samma dag, trots att det fortfarande är dagen innan i UTC.
- 359 tester och 111 databastester.
- #58 mergad.
- Granskning av arkitektur och funktion, PR #59 (`docs/granskning/2026-11-15-arkitektur-och-funktion.md`). Modulgränserna håller, och principerna skyddas av databasen. Före första kund behövs:
  - kompositionsrot för drift, inloggning med JWT, datum i marknadens tidszon och sidindelning
  - teckningsregler, godkännande vid tecknande, ett beslut om dokument till kunden, och livförsäkring eller ett nytt namn på exempelprodukten

  Fynden står i roadmapen under "Före första kund".
- #57 mergad.
- Priset på policyn (ADR 0030), PR #58:
  - **Tecknande, ändring och förnyelse** räknar premien med produktens tariff och prisvilkor: djurets uppgifter från djurregistret, postnumret från försäkringstagaren (bara zonen sparas), grupprabatt och kampanjkod. Förnyelsen ger nytt pris efter ålder och gällande tariff.
  - **Underlaget sparas** på termen och ändringen (`TermPricing`, migration 0028), så priset kan förklaras och räknas om.
  - **Manuellt pris** med ny rättighet `policies:price-override`, ny roll `underwriter` och motivering. Det beräknade priset sparas bredvid.
  - **Förnyelsekörningen** listar policyer där priset inte går att räkna (`price-not-available`).
  - **Provisioner** finns inte med än. De är nu en punkt i M5 i roadmapen (distribution och provision, ny ADR).
- 356 tester och 111 databastester.
- #56 mergad.
- Prisvilkor (ADR 0030), PR #57:
  - **`price-terms.v1`** i `decisioning`, med grupprabatter (`kind`, `fromMember`), kampanjkoder (giltighet, `newPoliciesOnly`) och `maxTotalDiscountBp`.
  - **`price` lägger på prisvillkoren efter grundpriset.** Den bästa grupprabatten och en kampanj läggs ihop under taket, aldrig under lägsta premie. Priset avrundas igen, och `basePremium` och `annualPremium` redovisas var för sig.
  - **`priceTermsSeries` på produkten**, med kontroll vid granskning. Prisindikationen tar `groupId` eller `group`, och `campaignCode`.
  - **Dev-servern** publicerar `SE-HUND-TERMS`. `SE-HUND-BAS` får dem bara i en ny databas.
- 355 tester och 111 databastester.
- #55 mergad.
- Produktens tariff och prisindikation (ADR 0030), PR #56:
  - **`tariffSeries` på produktversionen.** Vid granskning ska tariffen gälla när försäljningen börjar och täcka varje art, försäkringsbelopp och självrisk (`tariffCoverage`).
  - **`POST /v1/quotes`** med ny rättighet `policies:quote` (`policy-registrar` och `customer-channel`). Den räknar priset med ett registrerat djur och en part, eller med uppgifterna direkt. Ingenting sparas, och postnumret syns aldrig, bara zonen.
  - **Dev-servern** publicerar exempeltariffen `SE-HUND-TARIFF` och produkten `SE-HUND-BAS@2026.1`, som prissätts med den. Bella får 4 934 kr om året. Rollinställningen lokalt är version 11.
- 350 tester och 111 databastester.
- #54 mergad.
- Prisfunktion och tariffer (ADR 0030), PR #55:
  - **Ny modul `pricing-core`:** `price(tariff, input)` räknar grundpremien gånger faktorerna för ålder, rasgrupp, självrisk och zon (ort). Den räknar med heltal och BigInt, avrundar en gång och ger lägsta premie, termens premie, `breakdown`, `facts` och `inputHash`. Postnumret sparas inte, bara zonen.
  - **Tariffserier i `decisioning`** med beräkningsmodellen `tariff.v1` och samma livscykel och fyra ögon som skaderegler. En serie innehåller antingen tariffer eller skaderegler. `tariffInForce(serie, dag)`.
  - **Kontraktet:** `RuleSetContent` är skaderegler eller `TariffContent`. Simulering av en tariff ger `422` tills priser sparas med policyer.
  - **Ny sida** `docs/funktion/pris.md` med räkneexempel.
- 346 tester och 111 databastester.
- #53 mergad.
- ADR 0030 om tariffen (Beslutad), PR #54. Bara beslutet, ingen kod. Ort påverkar priset (zon per postnummer), och rabatter är prisvilkor i en egen serie som läggs på efter grundpriset.
  - **Tariffen är versionerad data i `decisioning`**, med fyra ögon och kontrollsumma, som skaderegler. Produktversionen pekar på en tariffserie.
  - **Priset räknas av en ren funktion** i en ny modul, `pricing-core`, med heltal och en förklaring steg för steg.
  - **Samma funktion används överallt:** prisindikation utan sparat tillstånd, tecknande, ändring och förnyelse.
  - **Manuellt pris** kräver en egen rättighet. Ingen uppgift om ägaren används utom postnumrets zon.
- #52 mergad.
- Policygrupper för kull och hushåll (ADR 0007), PR #53:
  - **Grupp** med marknad, sort, försäkringstagare och kull. **Medlemskap** med `from` och `to`, där en policy bara är med i en grupp i taget (migration 0027).
  - **Vid försäljning** lämnar policyn den förra ägarens grupp från försäljningsdagen, i samma transaktion som överlåtelsen.
  - **API:** fem operationer under `/v1/policy-groups`.
  - **Roadmapen för M3 är städad.** Förnyelse och avslut har nu delpunkter som stämmer med vad som är byggt.
  - `PolicyStore.apply` tar ett objekt (`ApplyExtra`) i stället för fyra valfria parametrar i följd.
- 339 tester och 111 databastester.
- #51 mergad.
- Ändring av val under termen (ADR 0029), PR #52:
  - **`POST /v1/policies/{id}/changes`:** nytt försäkringsbelopp eller ny självrisk från i dag eller senare, i den senaste termen. Premien för resten av termen justeras per dag (`premiumAdjustment`).
  - **Termen ändras inte.** Ändringen sparas som en egen rad (`policies.term_change`, migration 0026), och versionerna från dagen pekar på den.
  - **Skademotorn, förnyelsen och avslut** följer den premie och de val som gällde varje dag.
- 336 tester och 110 databastester.
- #50 mergad.
- Gallringen känner till skador (ADR 0028), PR #51:
  - `ClaimsService.claimActivity(policyId, från, till)` svarar om en skada med behandling under perioden är öppen (utan beslut, med förslag som väntar på attest, eller med begäran om omprövning), och när den senast togs emot eller beslutades.
  - `claimsActivity(policies, claims)` i `api/src/wiring.ts` är den tredje källan för gallringen. Den använder perioderna då parten var försäkringstagare (`PolicyService.holderPeriods`).
  - Gallringen känner nu till djur, policyer och skador.
- 332 tester och 109 databastester.
- #49 mergad.
- Omprövning av skador när en policyversion ersätts, PR #50:
  - `ClaimsService.reassessForPolicyChange(versioner)` omprövar varje skada vars senaste beslut fattades på en ersatt version. Ett nytt beslut skapas bara om underlaget har ändrats, så en händelse som kommer två gånger gör ingenting.
  - Dev-servern anropar den för varje `policy.version_superseded`.
  - Provat mot Postgres: en skada på Bella (1 500 kr) avslogs när policyn avslutades bakåt i tiden, och godkändes igen när avslutet återkallades.
- 330 tester och 108 databastester.
- #48 mergad.
- Överlåtelse och dödsfall (ADR 0029), PR #49:
  - **Djurregistret har en outbox** med `animal.ownership_changed` och `animal.died` (migration 0024).
  - **Policymodulen gör om händelserna till förslag** (migration 0025), en gång per händelse. Dev-servern lämnar dem vidare varje sekund.
  - **Överlåtelse:** samma policy byter försäkringstagare från försäljningsdagen när den nya ägaren har godkänt villkoren (kanal och referens sparas). Premien för resten av termen flyttas. Ett avböjt förslag, eller ett som inte godkänns i tid (`transferAcceptanceDays`), avslutar policyn från försäljningsdagen.
  - **Dödsfall:** ett godkänt förslag avslutar policyn från dödsdagen, och ett avböjt ändrar inget.
  - **API:** fem operationer under `/v1/policy-proposals` och `/v1/proposal-expiry-runs`.
- 328 tester och 107 databastester.
- #47 mergad.
- Förnyelse av policyer (ADR 0029), PR #48:
  - **Förnyelsekörning** (`POST /v1/renewal-runs`, med provkörning) inom produktens `renewalLeadDays`. Den använder produktversionen som säljs på förnyelsedagen och samma val och premie, tills M4. Avslut till termens slut stoppar den.
  - **Lista för beslut** när produkten inte säljs, valet saknas, djuret har dött eller försäkringstagaren inte går att nå. **Förnyelse för hand** med annan produktversion eller premie.
  - **Termens längd per produkt** (`policy.termMonths`, 1–12 månader, förval 12) inom marknadens tak. `renewalLeadDays` är nu 1–120 och kortare än termen, i stället för minst 31.
  - Ny rättighet `policies:renew` och ny roll `renewal-job`. **Migration 0023.** Rollinställningen lokalt är version 10.
- 323 tester och 106 databastester.
- #46 mergad.
- Avslut av policyer (ADR 0029), PR #47:
  - **Sju skäl** med regler från marknadsprofilen (FAL och distansavtalslagen, med källor i koden) och produktens inställning.
  - **Bakåt i tiden** när behovet har fallit bort, till exempel när djuret har dött. Versionerna från den dagen ersätts av en avslutad version, och historiken behåller vad som var känt före.
  - **Premie tillbaka** per dag, och **återkallelse** av det senaste avslutet.
  - **Produktinställningar** under `policy`: `midTermCancellation` (`term-end` som förval, eller `immediate`), `renewalLeadDays` (45 som förval, minst 31) och `transferAcceptanceDays` (30 som förval).
  - **Outbox** för policymodulen med `policy.issued`, `policy.cancelled`, `policy.reinstated` och `policy.version_superseded`.
  - **Migration 0022.** Provad ner och upp igen, även med avslut i tabellerna.
- 316 tester och 105 databastester.
- #45 mergad.
- Policymodulen, första delen (ADR 0029), PR #46:
  - **Tecknande** med kontroll av djur, försäkringstagare, produkt till salu, val, valuta och startdag. En term på ett år och en bitemporal version. Transaktionen visar stegen, och premien anges av anroparen tills M4.
  - **Databasen spärrar** två versioner av en policy för samma dag och två aktiva policyer för samma djur.
  - **Skademotorn läser policyer från modulen** i dev-servern, och exempeldatan i minnet används inte längre där. Förhandsbedömning för Bella provad.
  - **Gallringen** får policyerna som källa för relationer.
  - **API:** fem operationer. Nya rättigheter `policies:read` och `policies:write`, och ny roll `policy-registrar`. Token `dev-seller`.
  - **Migration 0021.** Provad ner och upp igen. Rollinställningen lokalt är uppdaterad med `npm run roles:sync -- --apply` till version 9.
- 309 tester och 104 databastester.
- #44 mergad.
- ADR 0029 om policyns livscykel (Beslutad), PR #45. Bara beslutet, ingen kod.
  - Svenska lagregler (FAL 3 och 5 kap., distansavtalslagen 3 kap.) i en marknadsprofil i koden, och bolagets val i produkten.
  - Vid försäljning byter samma policy försäkringstagare med en ny version från försäljningsdagen, så bytet syns i historiken även i efterhand. Den nya ägaren godkänner villkoren.
  - Förnyelsen körs 45 dagar före förfallodagen som förval, inställbart per produkt.
  - Avslut under termen: produkten väljer bindningstiden ut eller direkt uppsägning med premie tillbaka.
  - En försäkring börjar aldrig före dagen den tecknas.
- #43 mergad.
- `npm run roles:sync`, PR #44: lägger till nya standardroller och standardrättigheter i en sparad rollinställning som en ny version med motivering. Visar ändringen först och sparar bara med `--apply`. Tar aldrig bort något. Ersätter mitt tillfälliga skript, och de öppna punkterna om rättigheter som saknas i sparade rollinställningar är borta.
- 299 tester och 100 databastester.
- #42 mergad.
- Gallring (ADR 0028), PR #43:
  - **Lagringstider per marknad** som versioner, ändringsbara via API:et. Version 1 är tio år för Sverige.
  - **Sista relationen** via `ActivitySource`. Djurregistret rapporterar pågående ägarskap eller när det senaste slutade. Policyer och skador kopplas in i M3.
  - **Gallringskörning** (`POST /v1/retention-runs`, med provkörning) som begär anonymisering av parter vars lagringstid har gått ut. En dataskyddsansvarig godkänner varje begäran.
  - **`npm run erasures:reapply`** kör alla godkända anonymiseringar igen efter en återställning.
  - Ny rättighet `parties:retention` och ny roll `retention-job`. **Migration 0020.** Lokal rollinställning är version 8.
  - **Backningen av migration 0019 är ändrad.** Den tar nu bort anonymiserade revisioner, så att alla migreringar kan backas i CI. Uppåtdelen är oförändrad, och ingen installation har kört 0019.
- 297 tester och 100 databastester.
- #41 mergad. ADR 0028 beslutad som den är skriven: tio år för Sverige och fyra ögon för varje anonymisering.
- Anonymisering och begränsning (ADR 0028), PR #42:
  - **Begäran, godkännande av någon annan, och avslag.** Godkännandet anonymiserar parten i samma transaktion: personfälten töms i alla revisioner, och id-numren tas bort.
  - **Databasen spärrar:** bara funktionen `parties.anonymize` får skriva över historik, och bara med ett godkänt beslut. En trigger stoppar godkännande av den egna begäran.
  - **Begränsning:** en avslagen begäran från personen själv döljer parten för alla utom `parties:privacy` till ett datum. En begränsad eller anonymiserad part kan inte bli ny ägare till ett djur.
  - **API:** fem operationer, nya rättigheter `parties:privacy` och `parties:erase`, och ny roll `privacy-officer`.
  - **Migration 0019.** Provad ner och upp igen.
  - **Dev-servern:** tokens `dev-privacy` och `dev-privacy-2`. Lokal rollinställning är version 7.
- 292 tester och 99 databastester.
- #40 mergad.
- ADR 0028 om gallring och anonymisering (Föreslagen), PR #41. Bara beslutet, ingen kod. Personuppgifter finns bara i partmodulen. De anonymiseras med fyra ögon när lagringstiden efter partens sista relation har gått ut, eller på begäran när inget måste sparas. Lagringstiderna är en inställning per marknad.
- #39 mergad. ADR 0025, 0026 och 0027 beslutade: djur är stängda för kliniker från början, personnummer krypteras inte per fält, en ägare hör till djurets marknad och en kull ändras inte.
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
- Uppslagning av djur för kliniker (ADR 0025, Beslutad), PR #35:
  - **Flaggan `allowLookup`** per djur, som en del av revisionerna. Stängt om inget anges, och måste alltid anges vid en rättelse.
  - **`GET /v1/animal-lookup`** på chip, registrering eller pass. Visar djuret utan ägare och historik, och bara i anroparens marknader. Stängt, okänt och fel marknad ger samma tomma lista.
  - **Ny rättighet `animals:lookup`**, som rollen `clinic` får.
  - **Migration 0016:** kolumnen `allow_lookup`. Provad ner och upp igen.
  - **Dev-servern** öppnar Bella, och `dev-clinic` hittar henne på chipet. Lokal rollinställning är version 5.
- 269 tester och 91 databastester.

**Nästa steg**
1. Gränssnittet kan börja: API:t har listor, köer, `/v1/me`, CORS och exempeldata.
2. Bygga ADR 0031, steg 2: ansökan med godkännande (F3), förbehåll på termen och produktens `underwritingSeries`. Steg 3 är kön och besluten för manuell prövning. Därefter ett beslut om dokument till kunden (F2).

**Öppet**
- Flera instanser av servern kör var sitt relä. Leveransen sker minst en gång, men samma händelse kan levereras av två instanser samtidigt. Ett relä med lås per outbox (pg-boss) behövs före drift med flera instanser.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. Återkrav är en öppen fråga (M5).
- Gallringen känner till djur, policyer och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.

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
