# 0012. Teststrategi i lager med invarianter, scenarier och porttester

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

En försäkringskärna räknar med pengar, datum och regler som ändras över tid. Handplockade exempel täcker de fall vi tänkt på, men fel uppstår i kombinationer vi inte tänkt på. Kärnan har också portar (`ClaimsStore`, `PolicyPort`) med flera implementationer som måste bete sig lika. Det är billigare att bestämma hur vi testar nu än att lägga till det när flera moduler finns.

## Beslut

Vi testar i sex lager enligt `docs/testning.md`:

1. Enhetstester för ren domänkod, med `node:test`.
2. Egenskapstester med fast-check för invarianter: bevarande, gränser, monotoni, idempotens.
3. Scenariotester där försäkringsfall är data (YAML), så att de går att granska utan att läsa kod och kan köras mot både kärnan och API:et.
4. En gemensam testsvit per port som alla implementationer måste gå igenom.
5. Kontraktstester: varje API-svar valideras mot OpenAPI, och kontrakt och kod har samma operationer.
6. Databastester mot riktig Postgres för de regler som databasen själv upprätthåller.

Lager 1, 2 och 5 gäller från nu. Lager 3, 4 och 6 byggs i M1, före `claims-store-postgres`.

fast-check är ett utvecklingsberoende och används bara i tester.

## Konsekvenser

- Fel i kombinationer hittas tidigt, och motexemplen krymps till minsta fall.
- Postgres-lagret kan bevisas likvärdigt med minneslagret genom samma svit.
- Scenarier blir en körbar specifikation som en domänkunnig kan granska.
- Fler tester att underhålla. Egenskaper måste formuleras med omsorg, annars blir de antingen triviala eller falska.

## Alternativ

- **Bara exempelbaserade tester:** enklare men missar kombinationer.
- **Gherkin/Cucumber för scenarier:** läsbart men ett extra lager av stegdefinitioner. YAML med en egen körare räcker.
- **Testcontainers för Postgres i alla tester:** för långsamt för lager 1–3. Används bara i lager 4 och 6.

## Källor

- John Hughes, *QuickCheck Testing for Fun and Profit* (2007), och fast-checks dokumentation (fast-check.dev).
- Martin Fowler, *TestPyramid* (martinfowler.com, 2012).
- Ham Vocke, *The Practical Test Pyramid* (martinfowler.com, 2018), om kontraktstester.
