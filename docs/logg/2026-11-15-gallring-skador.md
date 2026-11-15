# Gallringen känner till skador (PR #51)

**Datum:** 2026-11-15 **ADR:** 0028 **Moduler:** `claims-core`, `claims-store-memory`, `claims-store-postgres`, `policies`, `api`

## Vad

En part med en öppen skada gallras inte. En avslutad skada räknas som en relation, med det senaste datumet då den togs emot eller beslutades. Gallringen känner nu till djur, policyer och skador.

## Hur det fungerar

1. `RetentionService.activityOf(partyId)` frågar sina källor. Den nya källan är `claimsActivity(policies, claims)` i `api/src/wiring.ts`.
2. Källan hämtar `PolicyService.holderPeriods(partyId)`, alltså varje period då parten var försäkringstagare enligt de gällande versionerna.
3. För varje period frågar den `ClaimsService.claimActivity(policyId, från, till)`. Den svarar med:
   - `open`: om någon skada med behandling i perioden saknar beslut, har ett beslutsförslag som väntar på attest eller har en öppen begäran om omprövning
   - `lastAt`: den senaste tidpunkten då en av skadorna togs emot eller beslutades
4. En öppen skada ger `ongoing`. Annars blir det senaste datumet relationens slut.

## Val och avvägningar

- **Skademotorn känner inte till parter.** Kopplingen går via policyns perioder, så en skada efter ett ägarbyte räknas till den nya försäkringstagaren och inte till den förra.
- **Behandlingsdagen avgör vilken period en skada hör till**, eftersom försäkringsfallet är det som räknas (FAL 7 kap. 4 §).
- **Sista beslutet räknas som relationens slut.** En omprövning flyttar då fram lagringstiden.

## Att känna till

- Betalningar (M5) blir en fjärde källa.
- I dev-servern behöll en provkörning de två parterna med pågående försäkringar.

## Filer

- `modules/claims-core/src/ports.ts`, `modules/claims-core/src/service.ts`, `modules/claims-store-memory/src/index.ts`, `modules/claims-store-postgres/src/index.ts`
- `modules/policies/src/index.ts` (`holderPeriods`)
- `modules/api/src/wiring.ts` (`claimsActivity`), `modules/api/src/app.ts`, `modules/api/src/dev-server.ts`
- `modules/claims-core/test-suites/claims-store.ts`, `modules/api/test/wiring.test.ts`
