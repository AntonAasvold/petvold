# Pengar, steg 2a: betalarkonton och premieplaner (PR #130)

**Datum:** 2026-11-21 **ADR:** 0040, 0001, 0018, 0028 **Moduler:** `billing`, `catalog`, `api`

## Vad
En tecknad eller förnyad policy får nu en premieplan i den nya modulen `billing`, på försäkringstagarens betalarkonto. Produkten anger vilka betalningsintervall som får väljas. Planerna och kontona går att läsa i API:et.

## Hur det fungerar
1. Policymodulen skriver `policy.issued` eller `policy.renewed` i sin outbox, som förut.
2. Reläet i `composition.ts` lämnar händelsen till `communications`, sedan till `BillingService.handlePolicyEvent` och sist till webhooks.
3. `handlePolicyEvent` (`modules/billing/src/index.ts`):
   - hämtar produktens marknad och inställningar via `ProductSource` (`billingProductSource` i `wiring.ts`, som läser `billingSettingsOf`)
   - hittar försäkringstagaren i händelsen vid tecknande. Vid förnyelse hämtas den via `PolicySource` på termens första dag.
   - väljer intervallet: förra termens om produkten fortfarande tillåter det, annars produktens förval
   - bygger `PlanInput` med marknadens regler från `BILLING_MARKET_RULES` och anropar `premiumPlan` i `billing-core`
4. `BillingStore.addPlan` sparar kontot, om det är nytt, och planen i en transaktion. `unique (source_event_id)` gör att en händelse som kommer två gånger inte ger något. Ett nytt konto från en upprepad händelse rullas tillbaka.
5. `GET /v1/payer-accounts`, `GET /v1/payer-accounts/{id}` och `GET /v1/premium-plans` läser med rättigheten `billing:read`.

## Val och avvägningar
- **Konto per part, marknad och valuta** med `unique (party_id, market, currency)`, som ADR 0040 säger. Postgres-lagringen gör `insert … on conflict do nothing` och läser sedan kontot, så två planer som kommer samtidigt hamnar på samma konto.
- **Ingen egen tabell för behandlade händelser.** Varje händelse som `billing` reagerar på ger just en plan, så det räcker med den unika källan på planen, som i `communications`. När fler händelser ger effekter (steg 2c) kan en tabell behövas.
- **Första premien räknas från händelsens dag** i marknadens tidszon, inte från fakturans. Försäkringsbrevet går ut samma dag. När faktureringen kommer (2b) kan det visa sig att avin skickas senare, och då är det fakturans dag som gäller.
- **En marknad utan regler stoppar händelsen** i stället för att räkna utan skatt och med fjorton dagar. Reläet försöker igen och lägger den till slut bland de döda posterna, så att den syns.
- **Sökvägarna** blev `/v1/payer-accounts` och `/v1/premium-plans`, eftersom API-konventionerna inte tillåter `/billing/accounts`.
- **Kundportalen ser planerna för sina policyer men inte kontot.** Kontot samlar alla kundens policyer, och en portal bunden till vissa policyer ska inte se de andra.
- **Gallringen** får `billing` som källa: en part med en plan vars term inte är slut har en pågående relation.

## Att känna till
- Produktionen behöver `BILLING_DATABASE_URL` och tjänsterollen `billing_service` före migration 0050.
- Bara `policy.issued` och `policy.renewed` ger planer. Ändring, avslut, återkallelse och överlåtelse kommer i 2c. Fram till dess stämmer en plan inte efter en sådan händelse.
- Intervallet kan inte väljas vid tecknandet än. Alla nya planer får produktens förval.
- Exempeldatans produkter har inga inställningar för betalning, så alla planer är årliga.

## Filer
- `modules/billing/src/index.ts`, `postgres.ts`
- `modules/billing/test-suites/billing-store.ts`
- `db/migrations/0050_billing.sql`
- `modules/catalog/src/products.ts` (`BillingSettings`, `billingSettingsOf`)
- `modules/api/src/app.ts`, `composition.ts`, `wiring.ts`, `permissions.ts`
