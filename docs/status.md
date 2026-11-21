# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

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

**Nästa steg**
1. ADR 0040, steg 2c-2b: återkallelse av ett avslut.
2. ADR 0041 om demotjänsten som tar emot händelserna, spelar bank och kontrollerar att allt stämmer.
3. ADR 0038, steg 5: gallring av dokument som en körning.
4. Back office: översikten på startsidan och omräkning av beslut.

**Öppet**
- Kanalerna måste skicka `acceptance` på `POST /v1/policies`. Det bryter mot äldre anrop, men inga kanaler finns i drift än.
- En sänkt ersättning vid omprövning ger ingen återkravsorder. ADR 0040 föreslår ett förslag till återkrav i en kö.
- Gallringen känner till djur, policyer, ansökningar och skador. Innan den körs skarpt hos ett försäkringsbolag behöver bolaget bekräfta lagringstiderna och att inga andra system har relationer som Petvold inte känner till, till exempel betalningar (M5).
- Det sparas inte vem som slagit upp ett djur.
