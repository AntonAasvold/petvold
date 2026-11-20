# Hur långt fram en policy får börja (PR #107)

**Datum:** 2026-11-20 **ADR:** 0023, 0029 **Moduler:** catalog, policies, api, apps/backoffice

## Vad
En ny policy får börja högst `policy.maxStartAheadDays` dagar efter dagen för tecknandet. Förvalet är 90 dagar. Tidigare fanns ingen övre gräns.

## Hur det fungerar
1. **Produkten:** `PolicySettings.maxStartAheadDays` i `catalog/src/products.ts`, med förvalet i `POLICY_SETTING_DEFAULTS` och kontrollen 0–365 när ett utkast sparas.
2. **Kompositionsroten:** `wiring.ts` lägger värdet på `ProductOffer`.
3. **Policymodulen:** `assertStartAhead` jämför startdagen med marknadens dag plus antalet dagar. Den anropas i två funktioner:
   - **`planIssue`,** som används av tecknande, ansökan och en persons godkännande av en ansökan
   - **`quote`,** så att prisindikationen säger samma sak som tecknandet
4. **Back office:** `latestStart` i `policy-form.ts` sätter taket på datumväljaren, och `issueProblems` stoppar ett datum som ligger längre fram.

## Val och avvägningar
- **Förvalet 90 dagar** och inte ingen gräns. Priset och teckningsreglerna bestäms den dag policyn tecknas. En start långt fram skulle låsa en tariff och regler som kan ha ändrats när policyn börjar.
- **Förnyelse berörs inte.** Den nya termen börjar alltid dagen efter den förra.
- **En ansökan som godkänns av en person** prövas mot dagen för godkännandet, eftersom det är då policyn tecknas.

## Att känna till
- **Befintliga produkter får gränsen 90 dagar** utan att innehållet ändras. En produkt som behöver längre tid sätter värdet i en ny produktversion.

## Filer
- `modules/catalog/src/products.ts`, `test/product-service.test.ts`
- `modules/policies/src/index.ts`, `test/policy-service.test.ts`
- `modules/api/src/wiring.ts`, `openapi.yaml`
- `apps/backoffice/src/policy-form.ts`, `src/views/policy-issue.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `test/policy-form.test.ts`
- `docs/funktion/produktkonfiguration.md`, `docs/funktion/policyer.md`
