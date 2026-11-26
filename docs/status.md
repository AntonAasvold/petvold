# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-22 – 2026-11-24 (pass 28)

**Gjort**
- Referensdata i back office, PR #NN: arter, raser och kön med namn per språk och historik. En ny kod med föreslagen kod, och ändringar som revisioner med skäl.
- Köer under Körningar, PR #177: `GET /v1/relay-status` och kortet **Köer** visar per modul vad som väntar på reläet, hur gammalt det äldsta är och de döda posterna, och webhooks till bolagets system.
- Policyn en viss dag, PR #176: ett kort på policyns sida visar det skademotorn ser en dag, så som det var känt vid en tidpunkt.
- Omräkning av beslut, PR #175: förklaringen av ett beslut har **Räkna om från underlaget**, som visar samma resultat, vad som skiljer sig, eller att beräkningsmodellen saknas.
- Dokumentationen för användarna, PR #173: dokumentationen i back office visar bara processerna och reglerna, och funktionerna. Besluten (ADR), den tekniska dokumentationen och API:t finns på GitHub.
- Översikt, PR #172: startsidan visar det som väntar på en person i de köer rollen får se, gruppvis, med köer som väntar först, och körningar som misslyckats och senast stängda dag. Ett kort öppnar kön på rätt flik.
- Återkrav, del 2, PR #171: fliken **Återkrav** under Pengar, där en handläggare väljer att kräva tillbaka, avräkna eller skriva av.
- Återkrav, del 1, PR #170: en sänkt ersättning ger `claim.payout_reduced` och ett förslag till återkrav i `billing`. En handläggare kräver tillbaka, avräknar mot tillgodohavandet eller skriver av (`POST /v1/recoveries/{id}/decisions`). Det bokförs mot skadekostnaden. Rättat: två anrop från 7b och 7c validerade inte kroppen mot kontraktet. Migration 0070.
- Pengar, steg 7c: Stripe, PR #168: en betalsida hos Stripe för en faktura (`POST /v1/invoices/{id}/checkout-sessions`, `payments:checkout`), med kort och Swish. Stripes signerade `checkout.session.completed` blir en inbetalning med fakturans referens. Knappen **Betallänk** finns på fakturan i back office. Inget nytt beroende.
- Pengar, steg 7b: bankfiler ut, PR #167: utbetalningar med bankfil väntar på en `pain.001` som görs och hämtas under **Pengar** (`payments:export`). Bankens `camt.054` gör dem betalda eller returnerade. Filen töms när en mottagare raderas. Migration 0069.
- Pengar, steg 7a: bankfiler in, PR #166: bankens `camt.054` läses in under **Pengar** eller av en integration (`POST /v1/payment-files`, `payments:import`). Inbetalningarna kopplas med OCR eller RF som förut. Varje fil sparas med vem, när och kontrollsumma. Migration 0068, ny roll `bank-file-job`.
- Gallring av dokument, PR #165: dokumenten om en part gallras när parten anonymiseras, genom samma krok som betaluppgifterna. Filen tas bort och raden finns kvar. ADR 0038 är byggd, med ett förtydligande om steg 5.
- Besked om kreditnota, PR #164: kunden får meddelandet `credit-note` när en faktura krediteras, men inte vid en avskrivning. Bolaget kan stänga av det. Migration 0067.
- Betaluppgifter raderas med parten, PR #163: ett godkännande av en radering raderar betaluppgifterna i `payments` först, och stoppas medan en utbetalning är på väg. `erasures:reapply` raderar dem igen. Migration 0066 med en trigger som bara tillåter radering.
- Pengar, steg 8d, PR #162: **Bokföring** i back office med dagsavslut och fil, saldon, verifikationer och kontoplan med versioner. Rättat: det första dagsavslutet kunde hoppa över en dag när en verifikation för i går kom in efter dagens första. `dev-all` har alla roller.
- Menyns ordning, PR #161: det dagliga arbetet först, sedan köerna, konfiguration och drift, och Dokumentation sist.
- Pengar, steg 8c, PR #160: betaluppgifter och utbetalningar på partens sida, med svenskt konto eller IBAN (kontrollerat). Under **Pengar**: utbetalningar som väntar på betaluppgifter, och avtal med kliniker som görs och avslutas, med klinikens betaluppgifter.
- Det fladdrande testet för skadans historik, PR #159: testet räknade med att rättelsen stod överst, men skadebeskedet kommer via relän och kan vara senare.
- Pengar, steg 8b, PR #158: betalarkontona på partens sida, och kontots sida med saldo, fakturor och återbetalningar. Kreditnota och avskrivning på en faktura, ett förslag över gränsen, och återbetalning av tillgodohavandet.
- Pengar, steg 8a, PR #157: **Pengar** i back office med köerna för okopplade inbetalningar (koppla), spärrade utbetalningar (släppa) och kreditförslag (attestera eller skicka tillbaka). Fyra ögon gäller. Inloggningen har ekonomirollerna.
- Demon kan uppdateras med datan kvar, PR #156: tjänsten `roles` skapar de modulroller som saknas innan `migrate`. Förut stoppade migrering 0064 på en databas från före `accounting_service`.
- Fler affärsprocesser, PR #155: teckning, policyns livscykel, skadereglering, meddelanden och personuppgifter. Det blir 179 regler totalt.
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
2. ADR 0040, steg 7: Autogiro via Bankgirot och SEPA-autogiro, och Swish direkt utan Stripe. Bankfiler och Stripe är byggda.
3. Back office: formulär för tariffer, prisvillkor och teckningsregler, och att pröva ett regelutkast mot sparade underlag.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
