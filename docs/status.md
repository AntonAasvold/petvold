# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 – 2026-11-23 (pass 27)

**Gjort**
- Pengar, steg 3a: inbetalningar (ADR 0017, 0040), PR #138. Modulen `payments` med porten `PaymentProvider`, låtsasbanken `fake` (signerad som Petvolds webhooks) och en gemensam svit för adaptrar.
  - `POST /provider-notifications/{provider}` sparar varje inbetalning en gång och ger `payment.succeeded`. Läsning med `GET /v1/payments` och `payments:read`.
  - Migration 0054 med rollen `payments_service`. 642 tester och 177 databastester.
- Pengar, steg 3b, PR #144: inbetalningar kopplas till fakturan med OCR eller RF, först den fakturan och sedan äldsta förfallna, resten blir tillgodohavande. Kön med okopplade inbetalningar och koppling för hand (`billing:write`). `invoice.paid`, och fakturans status och kontots saldo i API:t. Egenskapstest för fördelningen. Migration 0055.
- Demon på en server, PR #143: `deploy/demo/` med Compose, Caddy (HTTPS, lösenord på `/login` och en kaka), `setup.sh` och `reset.sh`. Prövad lokalt hela vägen. Rättat i testdatan: handläggaren följer reglernas förslag, självrisker och ångerfrist som produkten har dem.
- Testdata för demon, PR #142: `npm run demo:seed` gör sex månader dag för dag genom API:t (omkring 100 kunder, 140 policyer, 65 skador, 360 fakturor och 290 inbetalningar). Samma frö ger samma data och id:n. Demobolagets texter, och PDF:er med Gotenberg.
- Demoläget för inloggningen, PR #141: `PETVOLD_AUTH=demo` ger dev-serverns token i servern för drift, med varning i loggen och i `/healthz`. Rättat: en token som `constructor` hittade objektets prototyp.
- Avbildningar för demon, PR #140: `Dockerfile` med målen `api` och `web`, byggda i CI och lagda i GitHubs register från `main`. `tsx` och `dbmate` är vanliga beroenden, eftersom servern och migreringarna behöver dem.
- ADR 0041 om demon, PR #139: en egen server med Docker Compose och Caddy, demoanvändare (`PETVOLD_AUTH=demo`) bakom ett gemensamt lösenord, och testdata som skapas genom API:t sex månader bakåt, dag för dag.

**Nästa steg**
1. Sätta upp demon på en VPS (Anton): domän, server och `./setup.sh`. Sedan demotjänstens fas 1, som tar emot och visar händelserna.
2. ADR 0040, steg 3c: utbetalningar från `claim.payout_ordered`. Sedan steg 4, obetald premie.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
