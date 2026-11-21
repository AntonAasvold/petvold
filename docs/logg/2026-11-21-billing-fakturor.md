# Pengar, steg 2b: fakturor, nummerserie och betalningsreferens (PR #131)

**Datum:** 2026-11-21 **ADR:** 0040, 0037, 0033, 0008 **Moduler:** `billing-core`, `billing`, `webhooks`, `api`, back office

## Vad
Faktureringen är nu en körning, `billing.invoicing`. Den gör en faktura per betalarkonto av delbetalningarna som förfaller inom framförhållningen. Fakturan har ett nummer ur en obruten serie och en betalningsreferens, och händelsen `invoice.issued` går ut med webhooks. Fakturorna går att läsa i API:et.

## Hur det fungerar
1. Schemaläggaren kör `billing.invoicing` klockan 04:00 i varje marknad (`jobs.ts`), efter förnyelsen klockan 02:00.
2. `BillingService.invoicingRun` (`modules/billing/src/index.ts`) gör så här:
   - läser marknadens planer och vilka delbetalningar som redan är fakturerade (`invoicedSeqs`)
   - tar varje ofakturerad delbetalning vars förfallodag ligger inom planens `invoiceLeadDays`
   - grupperar dem per konto
3. **Förfallodagen** är den tidigaste radens. En ny policys första premie förfaller dock tidigast fjorton dagar efter fakturan (FAL 5 kap. 1 §), och fakturan förfaller aldrig före det.
4. `BillingStore.addInvoice` gör allt i en transaktion:
   - räknar upp `invoice_number_series` för marknad och år
   - bygger fakturan med numret, genom en funktion från tjänsten
   - sparar fakturan, raderna och händelsen i outboxen
5. Reläet har en ny källa, `billing`, som lämnar `invoice.issued` till webhooks. `PUBLIC_EVENTS` och AsyncAPI har händelsen, och `/petvold/billing` är en ny källa.
6. `GET /v1/invoices` och `GET /v1/invoices/{id}` läser med `billing:read`.

**Betalningsreferensen** räknas i `billing-core`:
- `ocrReference` lägger till en längdsiffra och en Luhn-siffra, enligt Bankgirots kontroll av OCR-referenser.
- `rfReference` räknar kontrollsiffrorna enligt ISO 11649 med modulo 97.

Basen är fakturans år och löpnummer. Referensen blir då unik och går att läsa av en människa.

## Val och avvägningar
- **Numret tas i fakturans transaktion.** Raden i serien låses av `update … returning`, så två körningar i samma marknad turas om. En faktura som inte sparas, till exempel för att en delbetalning redan fakturerats, rullar tillbaka numret. Serien får alltså inga luckor, vilket bokföringslagen kräver. Testet i `test-db` kör fyra fakturor samtidigt.
- **`unique (plan_id, seq)` på raderna** är skyddet mot dubbel fakturering, inte körningens lån. En krock blir `InvoiceConflictError`. Körningen hoppar då över fakturan, och nästa körning tar det som återstår.
- **Framförhållningen sparas på planen** (`invoice_lead_days`) när planen görs, i stället för att produkten läses varje natt. Planen är underlaget, och en ändrad produkt ska inte ändra en befintlig plans fakturering. Planer från före migration 0051 får 20 dagar.
- **Första premien räknas från fakturans dag.** Steg 2a räknade från dagen policyn tecknades, men det är avin som räknas. Planens förfallodag är därför en undre gräns, och körningen flyttar den när fakturan går ut senare.
- **Kundportalen ser en faktura bara om alla rader gäller dess policyer.** En faktura kan samla flera policyer för samma betalare, och en portal bunden till vissa policyer ska inte se de andra.
- **Ingen PDF och inget meddelande än.** Fakturan som meddelande till kunden kommer i nästa PR (2b-2), via `communications`.

## Att känna till
- **Exempeldatan:** planerna är årliga och fakturerades i dev först när förfallodagen var inom 20 dagar.
- **Bara faktura som betalsätt:** autogiro och kort kommer med `payments` i steg 3. Fakturan säger inte än hur den ska betalas.
- **Inga betalningar än:** fakturorna har ingen status som betald eller förfallen.

## Filer
- `modules/billing-core/src/index.ts` (`ocrReference`, `rfReference`)
- `modules/billing/src/index.ts`, `postgres.ts`
- `db/migrations/0051_billing_invoices.sql`
- `modules/api/src/jobs.ts`, `composition.ts`, `app.ts`
- `modules/webhooks/src/index.ts`, `modules/api/asyncapi.yaml`, `modules/api/openapi.yaml`
