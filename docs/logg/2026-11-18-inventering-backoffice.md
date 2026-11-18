# Körningar och det som saknas i back office (PR #95)

**Datum:** 2026-11-18 **ADR:** 0035 **Moduler:** inga, bara roadmapen

## Vad
- **En inventering** av vad back office saknar jämfört med API:t.
- **Ett nytt avsnitt i roadmapen om körningar,** som ska gå att visa, konfigurera och styra i back office.

## Hur inventeringen gjordes
Ett skript jämförde operationerna i `modules/api/openapi.yaml` med anropen i `apps/backoffice/src` (`api.GET('/v1/…')` och de andra metoderna). 68 av 115 operationer används. De som saknas är grupperade efter område i roadmapen.

## Att känna till
- **Körningarna** (`/v1/renewal-runs`, `/v1/retention-runs`, `/v1/application-expiry-runs` och `/v1/policy-proposal-expiry-runs`) startas inte av Petvold själv, och ingen historik sparas. Reläet och webhook-arbetaren startas med ett fast intervall i `server.ts`. Att visa och styra körningar kräver därför först en ADR om schemaläggning, lås och historik.
- **Låset vid flera instanser,** som tidigare stod som nästa steg, ingår i den ADR:en.
- **Siffran 68** är ungefärlig. Ett anrop som byggs på annat sätt än med en fast adress räknas inte.

## Filer
- `docs/roadmap.md`, `docs/status.md`
