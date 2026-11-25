# Policyn en viss dag i back office (PR #176)

**Datum:** 2026-11-25 **ADR:** 0006, 0035 **Moduler:** `apps/backoffice`

## Vad
Policyns sida har kortet **Policyn en viss dag**. Det visar det skademotorn ser en dag, så som det var känt vid en tidpunkt.

## Hur det fungerar
- `src/snapshot-logic.ts` är ren och testad. `snapshotQuery` kontrollerar dagen och gör om "känt vid" från webbläsarens lokala tid till UTC. `deductibleParts` delar upp självrisken.
- `<pv-policy-snapshot>` anropar `GET /v1/policies/{id}/snapshot?date=&knownAt=` och visar versionen, statusen, produkten, försäkringsåret, villkoren och förbehållen. Ett `404` visas som att policyn inte gällde den dagen.

## Val och avvägningar
- **Samma vy som skademotorn**, utan försäkringstagare och premie. Kortet svarar på frågan "vad visste vi när skadan beslutades", och det är ögonblicksbilden som beslutet sparar.
- **Tidpunkten i lokal tid**, eftersom handläggaren tänker i sin egen tid. API:t får UTC.

## Filer
- `apps/backoffice/src/snapshot-logic.ts`, `components/policy-snapshot.ts`, `views/policy-detail.ts`, `locales/sv.ts`
- `apps/backoffice/test/snapshot-logic.test.ts`, `e2e/policy-snapshot.spec.ts`
