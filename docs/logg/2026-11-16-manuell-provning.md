# Manuell prövning av ansökningar (PR #67)

**Datum:** 2026-11-16 **ADR:** 0031 **Moduler:** policies, catalog, api

## Vad
En person med rättigheten `policies:underwrite` kan godkänna eller avslå en ansökan som teckningsreglerna skickade till manuell prövning. Kanalen kan återkalla en ansökan som väntar, och en ansökan som inte beslutats i tid går ut. Därmed är ADR 0031 byggd.

## Hur det fungerar
`POST /v1/applications/{id}/decisions` i `modules/api/src/app.ts`:
1. `visibleApplication` hämtar ansökan och svarar `404` utanför omfånget. Kontraktet validerar `ApplicationDecisionRequest`.
2. `PolicyService.decideApplication` i `modules/policies/src/index.ts` hämtar ansökan med `waitingApplication`. Den ska ha status `referred`, och sista dagen (`deadline`) får inte ha passerat.
3. **Avslå:** `PolicyStore.decideApplication` sparar beslutet och händelsen `application.declined`.
4. **Godkänn:** ansökans val, premie och godkännande blir en `IssueInput`. `planIssue` gör alla kontroller igen med dagens tariff. Ansökans premie skickas med `priceOverride` och `mayOverridePrice`, så ett annat pris i dag sparas som ett manuellt pris med ansökan som skäl. Godkännandet från ansökan ersätter det nya, eftersom kunden godkände när ansökan kom in. Förbehållen blir reglernas förslag (`source: 'underwriting'`) eller de som personen anger (`source: 'manual'`). `commitIssue` skickar beslutet till `PolicyStore.issue(…, { decision })`.
5. I Postgres skriver `insertApplicationDecision` till `policies.application_decision` i samma transaktion som policyn.

Återkallelsen går genom `withdrawApplication`. Utgången går genom `expireApplications`, som tar varje ansökan med status `referred` vars sista dag har passerat i dess marknad.

## Val och avvägningar
- **Ett beslut i en egen tabell**, som förslagens `proposal_decision`. Ansökan ändras aldrig, och det automatiska utfallet finns kvar bredvid personens beslut. `status` räknas vid läsning: beslutets utfall, annars reglernas.
- **Samtidiga beslut.** Tjänsterollen får inte uppdatera ansökan, så `select … for update` gick inte. Primärnyckeln i `application_decision` gör att det andra beslutet ger en unik-överträdelse, som blir `409`. Ett godkännande som förlorar rullar tillbaka policyn också.
- **En trigger** stoppar beslut om en ansökan som inte gick till manuell prövning, även om koden skulle ha ett fel.
- **Kundens pris gäller.** Kunden godkände ett pris. Om tariffen har ändrats sparas båda priserna, som vid ett manuellt pris.
- **Ny startdag i stället för att godkänna bakåt.** En policy börjar aldrig före dagen den tecknas, så en startdag som har passerat ger `422` tills personen anger en ny.
- **Sista dagen räknas när ansökan kommer in**, från produktens `policy.applicationExpiryDays`. En ändrad produktinställning ändrar inte ansökningar som redan väntar. Migrationen ger ansökningar som redan väntar 30 dagar från dagen de kom in.
- **Utgången har rättigheten `policies:renew`**, som de andra schemalagda körningarna, så samma jobb kan köra alla.

## Att känna till
- `PolicyStore.issue` tar nu `IssueExtra` (`application` eller `decision`) i stället för en ansökan som sjätte argument.
- En befintlig rollinställning behöver `npm run roles:sync -- --apply` för att `underwriter` ska få `policies:underwrite`.
- Brevet med skälen vid avslag hör till F2.

## Filer
- `modules/policies/src/index.ts`, `src/postgres.ts`, `test/policy-service.test.ts` och `test-suites/policy-store.ts`
- `db/migrations/0030_policies_application_decisions.sql`
- `modules/catalog/src/products.ts` (`applicationExpiryDays`)
- `modules/api/src/app.ts`, `permissions.ts`, `wiring.ts`, `openapi.yaml` och `test/policies.test.ts`
- `docs/funktion/teckning.md`, `behorighet.md`, `policyer.md`, `produktkonfiguration.md`, `docs/teknik/arkitektur.md` och `utvecklingsmiljo.md`
