# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 – 2026-11-24 (pass 28)

**Gjort**
- Fler affärsprocesser, PR #NN: teckning, policyns livscykel, skadereglering, meddelanden och personuppgifter. Det blir 179 regler totalt.
- Systemdokumentation i back office, PR #154: **Dokumentation** i menyn visar affärsprocesserna och affärsreglerna ([docs/processer](processer/README.md)), funktionerna och besluten, sökbara. Sidorna byggs in från `docs/`.
  - Sex processer för pengarna, med 67 regler. Varje regel har id, källa och inställning, till exempel `OBET-05`.
- Demon på en annan port, PR #144: `DEMO_PORT` och `DUCKDNS_TOKEN` i `setup.sh` ger certifikat med en TXT-post hos DuckDNS, när 80 och 443 leder till en annan maskin.
  - Caddy byggs i `deploy/demo/caddy/` med `caddy-dns/duckdns`. `DEMO_PUBLIC_URL` ger dokumentlänkarna rätt port. HTTP/3 är avstängt.
- Pengar, steg 6b: dagsavslut och kontoplan, PR #153: körningen `accounting.day-close` (06:00) stänger varje dag i ordning, med summor, kontrollsumma och `accounting.day_closed`. Dagens verifikationer som CSV, och kontoplanen med versioner (`accounting:configure`). En verifikation för en stängd dag bokförs på första öppna dag. Migration 0065. Steg 6 i ADR 0040 är klart.
- Pengar, steg 6a: verifikationer, PR #152: modulen `accounting` bokför fakturor, kreditnotor, avskrivningar, inbetalningar, kopplingar, återbetalningar, utbetalningsordrar och utbetalningar med dubbel bokföring. Ett test stämmer av varje konto mot `billing` och `payments`. Ny händelse `payment.matched`. Rättat: kreditnotornas fördelning kunde ge en rad mer än fakturaraden. Migration 0063 och 0064, rollen `accounting_service`.
- Pengar, steg 5b: kreditnotor och avskrivningar, PR #151: `POST /v1/invoices/{id}/credit-notes` med `billing:credit`. Inom rollens `creditLimits` görs den direkt, och över den blir den ett förslag som någon annan attesterar. Ny roll `billing-manager`. En befintlig rollinställning behöver `npm run roles:sync -- --apply`. Migration 0062. Steg 5 i ADR 0040 är klart.
- Pengar, steg 5a: tillgodohavanden, PR #150: körningen `billing.credits` (04:30) betalar kontots obetalda fakturor med tillgodohavandet, eller betalar tillbaka det när kontot inte har mer att fakturera. Kunden kan be om återbetalning. Återbetalningar betalas ut av `payments` (`purpose: premium-refund`). Egenskapstest för att summan går ihop. Migration 0060 och 0061.
- Pengar, steg 4: obetald premie, PR #149: körningen `billing.dunning` påminner sju dagar efter förfallodagen (`invoice.overdue`, meddelandet `payment-reminder`) och säger upp policyerna på fakturan efter 21 dagar. Betalning före uppsägningsdagen återkallar uppsägningen (FAL 5 kap. 2 §). Egenskapstest för dagarna. Migration 0058 och 0059.
- Specen för demotjänsten i repot, PR #148: [Demotjänsten](teknik/demotjanst.md), uppdaterad med inbetalningar, utbetalningar och händelserna. `DEMO_WEBHOOK_URL` låter testdatan prenumerera på demotjänsten först, så att den får hela historiken.
- Pengar, steg 3c-2: direktreglering, PR #147: kliniker med avtal (per klinik och marknad, med giltighetstid och avslut) får ersättningen för skadorna de anmält. Betaluppgifter per klinik. Steg 3 i ADR 0040 är klart. Migration 0057.
- Pengar, steg 3c-1: utbetalningar, PR #146: `claim.payout_ordered` blir en utbetalning till försäkringstagaren, en gång per order. Betaluppgifter per part (maskade), väntan utan uppgifter, spärr för nya uppgifter (`PETVOLD_NEW_PAYEE_HOLD_DAYS`) och frisläppning av en annan person. `payout.paid` och `payout.failed`. Migration 0056.
- Pengar, steg 3b, PR #145: inbetalningar kopplas till fakturan med OCR eller RF, först den fakturan och sedan äldsta förfallna, resten blir tillgodohavande. Kön med okopplade inbetalningar och koppling för hand (`billing:write`). `invoice.paid`, och fakturans status och kontots saldo i API:t. Egenskapstest för fördelningen. Migration 0055.

**Nästa steg**
1. Demotjänstens fas 1 enligt [specen](teknik/demotjanst.md): ta emot och visa händelserna, och lägga den i demons Compose. Demon kör i Proxmox med DuckDNS sedan 2026-11-23.
2. ADR 0040, steg 7: betaltjänster. Bankfiler först (ISO 20022, `pain.001` ut och `camt.054` in), sedan Stripe eller Surfboard, Autogiro och SEPA, och Swish. Eller back office för pengarna (steg 8).
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
- Betaluppgifter raderas inte när en part raderas (ADR 0040, punkt 11). Gallringen ser bara att parten har en pågående utbetalning.
