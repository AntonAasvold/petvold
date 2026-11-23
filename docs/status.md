# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 (pass 28)

**Gjort**
- Demon på en annan port, PR #144: `DEMO_PORT` och `DUCKDNS_TOKEN` i `setup.sh` ger certifikat med en TXT-post hos DuckDNS, när 80 och 443 leder till en annan maskin.
  - Caddy byggs i `deploy/demo/caddy/` med `caddy-dns/duckdns`. `DEMO_PUBLIC_URL` ger dokumentlänkarna rätt port. HTTP/3 är avstängt.
- Pengar, steg 5a: tillgodohavanden, PR #150: körningen `billing.credits` (04:30) betalar kontots obetalda fakturor med tillgodohavandet, eller betalar tillbaka det när kontot inte har mer att fakturera. Kunden kan be om återbetalning. Återbetalningar betalas ut av `payments` (`purpose: premium-refund`). Egenskapstest för att summan går ihop. Migration 0060 och 0061.
- Pengar, steg 4: obetald premie, PR #149: körningen `billing.dunning` påminner sju dagar efter förfallodagen (`invoice.overdue`, meddelandet `payment-reminder`) och säger upp policyerna på fakturan efter 21 dagar. Betalning före uppsägningsdagen återkallar uppsägningen (FAL 5 kap. 2 §). Egenskapstest för dagarna. Migration 0058 och 0059.
- Specen för demotjänsten i repot, PR #148: [Demotjänsten](teknik/demotjanst.md), uppdaterad med inbetalningar, utbetalningar och händelserna. `DEMO_WEBHOOK_URL` låter testdatan prenumerera på demotjänsten först, så att den får hela historiken.
- Pengar, steg 3c-2: direktreglering, PR #147: kliniker med avtal (per klinik och marknad, med giltighetstid och avslut) får ersättningen för skadorna de anmält. Betaluppgifter per klinik. Steg 3 i ADR 0040 är klart. Migration 0057.
- Pengar, steg 3c-1: utbetalningar, PR #146: `claim.payout_ordered` blir en utbetalning till försäkringstagaren, en gång per order. Betaluppgifter per part (maskade), väntan utan uppgifter, spärr för nya uppgifter (`PETVOLD_NEW_PAYEE_HOLD_DAYS`) och frisläppning av en annan person. `payout.paid` och `payout.failed`. Migration 0056.
- Pengar, steg 3b, PR #145: inbetalningar kopplas till fakturan med OCR eller RF, först den fakturan och sedan äldsta förfallna, resten blir tillgodohavande. Kön med okopplade inbetalningar och koppling för hand (`billing:write`). `invoice.paid`, och fakturans status och kontots saldo i API:t. Egenskapstest för fördelningen. Migration 0055.

**Nästa steg**
1. Demotjänstens fas 1 enligt [specen](teknik/demotjanst.md): ta emot och visa händelserna, och lägga den i demons Compose. Demon kör i Proxmox med DuckDNS sedan 2026-11-23.
2. ADR 0040, steg 5b: kreditnotor och avskrivningar som en person gör, med attest av någon annan över beloppsgränsen.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
- Betaluppgifter raderas inte när en part raderas (ADR 0040, punkt 11). Gallringen ser bara att parten har en pågående utbetalning.
