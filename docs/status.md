# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 (pass 27)

**Gjort**
- Pengar, steg 3a: inbetalningar (ADR 0017, 0040), PR #138. Modulen `payments` med porten `PaymentProvider`, låtsasbanken `fake` (signerad som Petvolds webhooks) och en gemensam svit för adaptrar.
  - `POST /provider-notifications/{provider}` sparar varje inbetalning en gång och ger `payment.succeeded`. Läsning med `GET /v1/payments` och `payments:read`.
  - Migration 0054 med rollen `payments_service`. 642 tester och 177 databastester.
- ADR 0041 om demon, PR #139: en egen server med Docker Compose och Caddy, demoanvändare (`PETVOLD_AUTH=demo`) bakom ett gemensamt lösenord, och testdata som skapas genom API:t sex månader bakåt, dag för dag.

**Nästa steg**
1. Demon enligt ADR 0041: `Dockerfile`, demoläget för inloggningen, testdatan, `deploy/demo/` och demotjänstens fas 1.
2. ADR 0040, steg 3b: koppla inbetalningar till fakturor, okopplade inbetalningar och `invoice.paid`. Steg 3c: utbetalningar från `claim.payout_ordered`.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
