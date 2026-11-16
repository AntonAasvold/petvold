# Adresserna enligt konventionerna (PR #74)

**Datum:** 2026-11-16 **ADR:** 0034 **Moduler:** api, claims-core

## Vad
De 29 avvikelserna från API-konventionerna är rättade i `/v1`, och listan `KNOWN_DEVIATIONS` är tom. Det bryter mot `/v1`, vilket ADR 0034 tillåter tills första kanalen är i drift.

| Förut | Nu |
| --- | --- |
| `/v1/access/roles` | `/v1/settings/roles` |
| `/v1/retention-settings` | `/v1/settings/retention` |
| `/v1/notice-settings` | `/v1/settings/notices` |
| `GET /v1/animal-lookup` | `GET /v1/animal-summaries` |
| `POST /v1/party-searches` | `POST /v1/parties/searches` |
| `GET /v1/products/on-sale?date=` | `GET /v1/product-versions?onSale=` |
| `/v1/policies/{policyId}/animals/{animalId}/limits` | `/v1/policies/{policyId}/limits` |
| `.../sales-ends` | `.../sales-endings` |
| `.../members/{policyId}/ends` | `.../members/{policyId}/endings` |
| `/v1/proposal-expiry-runs` | `/v1/policy-proposal-expiry-runs` |
| `GET /v1/claims?state=`, fältet `state` | `?status=`, fältet `status` |
| `GET /v1/policy-groups?holderPartyId=` | `?policyholderPartyId=` |

## Hur det fungerar
- **Adresserna** är bytta i `openapi.yaml` och `app.ts`. Tester, `examples/claims.http`, `README.md`, `AGENTS.md`, dev-serverns utskrifter och dokumentationen i `docs/funktion` och `docs/teknik` är uppdaterade. Byggloggen och ADR:erna beskriver hur det var och är inte ändrade.
- **Försäkringsbeloppet:** `ClaimsService.getLimits(policyId, onDate)` tar djuret från policyn via `PolicyPort`. Det fungerar även när skademotorn läser policyer från ett externt system.
- **Skadornas köer:** butiken räknar fortfarande ut `state` (`ClaimState`) som förut. API-lagret döper om fältet till `status` i svaret och tar filtret `status`.
- **Id-mönster:** `claimId` och skadans `id` kräver `^clm_[A-Za-z0-9_]+$`, och beslutsförslagens `proposalId` kräver `^prp_`.

## Val och avvägningar
- **Inga alias för de gamla adresserna.** Ingen kanal är i drift, och alias skulle göra kontraktet större.
- **`state` döps om bara i API:t.** Typen och SQL-frågan i skademotorn behåller namnet, eftersom det är internt. Det kan rättas om modulen ändras av andra skäl.
- **Skadans id får innehålla `_`.** Klienten väljer id:t, och exemplen använder till exempel `clm_ex_otit`.
- **Gruppens fält `holderPartyId` behålls i innehållet.** Konventionen gäller filter, och fältet är gruppens egen försäkringstagare. Bara filtret byter namn, så att det följer `{roll}PartyId`.

## Att känna till
- **Ett fel i kontraktet hittades.** `/v1/products/on-sale` hade `Limit` och `Cursor` mitt i parametern `date`, så `date` saknade `in`. Det är rättat i den nya adressen.
- **En förhandsbedömning kräver också `clm_`** i sitt id.

## Filer
- `modules/api/openapi.yaml`, `src/app.ts`, `src/conventions.ts`, `src/dev-server.ts`, `src/seed.ts`, `test/`
- `modules/claims-core/src/service.ts`, `test/service.test.ts`, `modules/claims-store-postgres/test-db/service.test.ts`
- `examples/claims.http`, `README.md`, `AGENTS.md`, `docs/funktion/`, `docs/teknik/`
