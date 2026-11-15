# Förnyelse av policyer (PR #48)

**Datum:** 2026-11-15 **ADR:** 0029 **Moduler:** `policies`, `catalog`, `api`

## Vad

Policyer förnyas automatiskt av en daglig körning, inom produktens framförhållning. Det som inte kan förnyas som det är listas för ett beslut och kan förnyas för hand. Termens längd ställs in per produkt.

## Hur det fungerar

1. **Kandidaterna.** `POST /v1/renewal-runs` går till `PolicyService.renewalRun`. Den hämtar policyer som slutar inom 120 dagar med `PolicyStore.endingBetween`, alltså aktiva versioner där ingen version följer.
2. **Kontrollerna för varje policy:**
   - Ett avslut som gäller vid termens slut (`cancellationsInForce`) räknas som `cancelled`.
   - Produktens `renewalLeadDays` från `ProductPort.offer` avgör om det är dags, och annars räknas policyn som `notYet`.
3. **Nästa term.** `planRenewal` bygger termen:
   - djuret ska leva och försäkringstagaren gå att nå
   - `ProductPort.versionOnSale(produkt, startdag)` ger produktversionen
   - arten och marknadens tak för termlängden kontrolleras
   - `vetCareTermsFor` får samma försäkringsbelopp och självrisk som förut
   - premien är samma som förut

   Ett problem ger en `RenewalIssue`, som hamnar under `needsDecision`.
4. **Sparandet.** `renew` sparar termen, versionen, transaktionen (`type: renew`) och händelsen `policy.renewed` i en transaktion med `PolicyStore.apply(…, terms)`.
5. **Förnyelse för hand.** `POST /v1/policies/{id}/renewals` använder samma `planRenewal`, men med `productVersion` och `premium` från anropet.

## Val och avvägningar

- **Termens längd per produkt** (`policy.termMonths`), enligt ditt beslut om att perioden ska vara inställbar. Marknadsprofilen sätter taket.
- **`renewalLeadDays` 1–120 och kortare än termen**, i stället för minst 31 dagar. Med månadsterminer går det annars inte. Att kunden ska få besked mer än en månad före en ändring av pris eller villkor står i dokumentationen, men tvingas inte.
- **Samma premie tills M4.** Transaktionens steg säger det.
- **Lista i stället för gissning.** Om produkten inte säljs eller valet saknas väljer körningen inte själv.
- **`inceptionDate` ändras inte**, så karenstiden börjar inte om vid förnyelse.

## Att känna till

- Körningen ser 120 dagar framåt, vilket är den längsta tillåtna framförhållningen.
- Bellas policy i dev-servern har förnyats för hand till 1 april 2028.
- Nytt pris och ny riskbedömning vid förnyelse kommer med M4.

## Filer

- `modules/policies/src/index.ts` (`renew`, `renewalRun`, `planRenewal`), `modules/policies/src/postgres.ts` (`endingBetween`, termer i `apply`)
- `modules/catalog/src/products.ts` (`termMonths`, ny gräns för `renewalLeadDays`)
- `db/migrations/0023_policies_renewal.sql`
- `modules/api/src/app.ts`, `modules/api/src/wiring.ts`, `modules/api/src/permissions.ts`, `modules/api/openapi.yaml`
- `modules/policies/test/policy-service.test.ts`, `modules/policies/test-suites/policy-store.ts`, `modules/api/test/policies.test.ts`, `modules/catalog/test/product-service.test.ts`
