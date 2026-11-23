# Pengar, steg 4: obetald premie (PR #149)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `billing`, `communications`, `api`, `webhooks`

## Vad
En faktura som inte betalas får en påminnelse efter sju dagar. Efter 21 dagar sägs policyerna på den upp för obetald premie, med verkan fjorton dagar senare. Betalar kunden före den dagen återkallas uppsägningen, eftersom den då enligt lagen inte har någon verkan.

## Hur det fungerar
1. Körningen `billing.dunning` (05:00, efter faktureringen) anropar `BillingService.dunningRun`. För varje obetald faktura avgör den rena funktionen `nextDunningAction` (`dunning.ts`) om fakturan ska påminnas, sägas upp eller lämnas.
2. **Påminnelse:** ett steg `reminded` och händelsen `invoice.overdue`. `communications` gör meddelandet `payment-reminder` med det obetalda beloppet och bolagets text `payment`.
3. **Uppsägning:** porten `PolicyActions` (`billingPolicyActions` i `wiring.ts`) anropar `policies.cancel` med skälet `unpaid-premium` och dagen. Policymodulen ger verkan fjorton dagar senare och skickar `insurer-termination` med `voidIfPaidBefore`. Steget `cancellation-noticed` sparar varje uppsägnings transaktion och dag.
4. **Betalning:** efter varje inbetalning som kopplas till kontot väljer `voidPaidNotices` med `cancellationsToVoid` de uppsägningar som inte fått verkan. Dem återkallar den med `policies.reinstate`. Policymodulen skickar `policy.reinstated`, och `billing` lägger då tillbaka delbetalningarna som det redan gjorde i steg 2.

## Val och avvägningar
- **Uppsägningen registreras när den skickas** och återkallas om kunden betalar. Det är samma modell som policymodulen redan hade för `unpaid-premium`. Kunden och bolagets system ser uppsägningen och dess dag direkt, och avslutet behöver ingen egen körning.
- **Allt kan köras igen.** Steg sparas med nummer (`invoice_dunning`, nyckeln är faktura och nummer). Samma policy och dag ger samma uppsägning tillbaka. Återkallelsen görs vid varje betalning till kontot, också en upprepad, så att det ett fel lämnade blir gjort nästa gång.
- **En sen påminnelse ger samma tid.** Uppsägningen kommer tidigast fjorton dagar efter påminnelsen, också om körningen inte gått på några dagar.
- **Egenskapstest** för dagarna: aldrig för tidigt, varje steg högst en gång, och en betalning återkallar exakt när den kommer före uppsägningsdagen. Två fel insatta med flit fångades: ingen väntetid efter en sen påminnelse, och en betalning på själva uppsägningsdagen.

## Att känna till
- Alla policyer på fakturan sägs upp, också vid en delbetalning.
- Dagarna kommer från `BILLING_MARKET_RULES`. Inställningar per produkt och påminnelseavgift kommer senare.
- Inkasso och dröjsmålsränta finns inte (ADR 0040, punkt 7).
- I demon på sex månader blev det 44 påminnelser, 21 uppsägningar och 9 återkallelser.
- Testdatan tål nu att en policy sagts upp för obetald premie medan den kör.

## Filer
- `modules/billing/src/dunning.ts`, `index.ts` och `postgres.ts`
- `db/migrations/0058_billing_dunning.sql` och `0059_communications_payment_reminders.sql`
- `modules/billing/test/dunning.test.ts` och `dunning.property.test.ts`
- `modules/api/src/jobs.ts`, `wiring.ts` och `composition.ts`, och `modules/api/test/dunning.test.ts`
- `modules/communications/src/index.ts`
