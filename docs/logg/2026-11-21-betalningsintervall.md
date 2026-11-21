# Betalningsintervall vid tecknandet (PR #135)

**Datum:** 2026-11-21 **ADR:** 0040, 0029, 0031 **Moduler:** `policies`, `billing`, `catalog`, `api`, back office

## Vad
Kunden väljer hur ofta den betalar när policyn tecknas. Premieplanen görs efter valet.

## Hur det fungerar
1. `productPort` i `wiring.ts` lägger till produktens `paymentIntervals` och `defaultPaymentInterval` (från `billingSettingsOf`) på `ProductOffer`.
2. `PolicyService.planIssue`:
   - tar `input.paymentInterval`, annars produktens förval, annars `year`
   - kontrollerar att produkten tillåter intervallet, och svarar annars `422`
   - lägger valet i planen för tecknandet
3. `commitIssue` sparar valet i `transaction.issue.paymentInterval`, i den befintliga kolumnen `issue jsonb`, och lägger det i `policy.issued`.
4. En ansökan sparar valet bland `choices`. Ett godkännande från en person tecknar med samma val.
5. `BillingService.handlePolicyEvent` tar valet från händelsen om produkten tillåter det, och annars förvalet.
6. **Back office** visar valet "Betalar" när produkten har fler än ett intervall.

## Val och avvägningar
- **Valet sparas hos policyn och inte bara i `billing`.** Det är en del av det kunden godkände, precis som självrisk och försäkringsbelopp. `billing` får det med händelsen, och modulerna läser aldrig varandras tabeller.
- **Ingen migration.** `issue` och `choices` är redan `jsonb`.
- **`billing` kontrollerar valet igen.** En produkt kan ändras mellan tecknandet och planen, och då gäller förvalet i stället för att händelsen fastnar.
- **Exempelprodukterna** tillåter år, kvartal och månad. Det märks bara i en ny databas, eftersom en publicerad produktversion aldrig ändras.

## Att känna till
- Intervallet kan inte bytas efter tecknandet än. ADR 0040 säger att ett byte gäller från nästa term.
- Prisindikationen (`POST /v1/quotes`) visar inte delbetalningarna.

## Filer
- `modules/policies/src/index.ts`, `postgres.ts`
- `modules/billing/src/index.ts`
- `modules/api/src/wiring.ts`, `openapi.yaml`, `asyncapi.yaml`
- `apps/backoffice/src/policy-form.ts`, `views/policy-issue.ts`
- `modules/catalog/seed/products.json`
