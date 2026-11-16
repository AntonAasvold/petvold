# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-16 (pass 25)

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

**Nästa steg**
1. Back office, steg 3: policyer och ansökningar.
2. Livförsäkring som moment, eller ett nytt namn på exempelprodukten (F4).

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- Flera instanser av servern kör var sitt relä. Ett relä med lås per outbox behövs före drift med flera instanser. Webhooks klarar redan flera instanser (`skip locked`), men reläet som fyller kön gör det inte.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. Återkrav är en öppen fråga (M5).
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
