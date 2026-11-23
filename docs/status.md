# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 (pass 28)

**Gjort**
- Demon på en annan port, PR #144: `DEMO_PORT` och `DUCKDNS_TOKEN` i `setup.sh` ger certifikat med en TXT-post hos DuckDNS, när 80 och 443 leder till en annan maskin.
  - Caddy byggs i `deploy/demo/caddy/` med `caddy-dns/duckdns`. `DEMO_PUBLIC_URL` ger dokumentlänkarna rätt port. HTTP/3 är avstängt.

**Nästa steg**
1. Sätta upp demon (Anton): en VM i Proxmox hemma, med `DEMO_PORT=8443` och DuckDNS. Sedan demotjänstens fas 1, som tar emot och visar händelserna.
2. ADR 0040, steg 3b: koppla inbetalningar till fakturor, okopplade inbetalningar och `invoice.paid`. Steg 3c: utbetalningar från `claim.payout_ordered`.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
