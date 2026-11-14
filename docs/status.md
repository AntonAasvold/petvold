# Status

Läses i början och uppdateras i slutet av varje arbetspass. Senaste först.

## 2026-11-14 (pass 4)

**Gjort**
- Gemensam testsvit för `ClaimsStore` (`modules/claims-core/test-suites/claims-store.ts`, 16 tester). Porten säger nu exakt vad som gäller: allt eller inget vid beslut, beslut i löpnummerordning, halvöppna perioder, och `StoreConflictError` för dubbletter och överlapp.
- Sviten hittade fyra skillnader mellan minneslagret och Postgres: dubblett av ärende skrevs över, fel feltyp vid dubblett av beslut, beslut för okänt ärende godtogs, och överlappande perioder godtogs. Alla rättade.
- Tjänsten gör krockar i lagringen till `conflict` (409) i stället för internt fel.
- ADR 0014 beslutad: belopp som heltal med valutan en gång per objekt. Ersätter 0005.
- 85 tester totalt.

**Nästa steg**
1. `claims-store-postgres` som går igenom samma svit, med outbox i samma transaktion och valuta på journalerna (ADR 0014).
2. ADR 0015 om behörighet: rättigheter i kontraktet, roller per installation, egna ärenden för kliniker, beloppsgränser och fyra ögon.
3. Gemensamma kontraktsdelar och Biome.

**Öppet**
- OrbStack-licens när Petvold blir kommersiellt.
- Postgres-versionen i `compose.yaml` och i driften hålls lika för hand.

## 2026-11-14 (pass 3)

**Gjort**
- Utvecklingsmiljö (ADR 0013, beslutad, och `docs/utvecklingsmiljo.md`): `.node-version` (24), `compose.yaml` med Postgres 18.7, dbmate för migreringar, testdatabas och tjänsteroll `claims_service`.
- Migration `0002_claims_grants.sql`: tjänsterollen får bara läsa och lägga till, plus ersätta självriskperioder och markera händelser som publicerade.
- Databastester (`db/test/`, lager 6): balanserade journaler, inga överlappande perioder, historik går inte att ändra eller radera för tjänsterollen.
- CI: samma Node-version som lokalt, och ett jobb som kör `npm run dev:up`, databastesterna och backning av migreringarna.
- Verifierat lokalt med OrbStack: `dev:up` och alla databastester gröna.
- ADR 0011–0013 beslutade. #2, #5 (ersätter #3) och #4 mergade till `main`.

**Nästa steg**
1. Gemensam testsvit för `ClaimsStore` (lager 4) och sedan `claims-store-postgres`.
2. Gemensamma kontraktsdelar: `Money`, `Problem`, sidindelning och `Ref`.
3. Biome för formatering och lint, som egen PR.

**Öppet**
- OrbStack är gratis bara för privat bruk. Köp licens eller byt till Colima när Petvold blir kommersiellt.
- Postgres-versionen i `compose.yaml` och i driften hålls lika för hand. Överväg Renovate.

## 2026-11-14 (pass 2)

**Gjort**
- ADR 0010 beslutad och mergad: en installation per kund.
- `modules/common` med `Money`, `MinorUnits`, `applyBp`, `MarketCode`, `CurrencyCode`, `ISODate`, `DateRange`. 12 nya tester, 55 totalt.
- `claims-core` använder `common`. `Ore` heter nu `MinorUnits`, och `kr()` är borttagen (oanvänd, och text hör inte hemma i kärnan).
- Fel rättat: `assertDate` godkände datum som inte finns, t.ex. `2026-02-30`.
- ADR 0011 (beslutad): gemensam kärna för värdetyper.
- Teststrategi: ADR 0012 (beslutad) och `docs/testning.md`. fast-check införd, 13 egenskapstester för `common` och ersättningsberäkningen, 68 tester totalt. Kontrollerat att ett inplanterat fel (taket borttaget) fångas.

**Nästa steg**
1. Gemensamma kontraktsdelar: `Money`, `Problem`, sidindelning och `Ref` som delad OpenAPI-fil.
2. Docker compose med Postgres och migrationen.
3. `ClaimsStore` mot Postgres.

**Öppet**
- ADR 0005 säger att `Money` är `{ amount, currency }`, men kontraktet och `claims-core` använder heltal med valutan på det omgivande objektet. Välj ett sätt innan fler moduler byggs.
- Licens (se roadmap).

## 2026-11-14 (pass 1)

**Gjort**
- ADR 0010 (beslutad): en installation per kund (silo). Kunderna är etablerade försäkringsbolag eller en egen försäkringsverksamhet, så ingen `tenant_id`.
- Repot skapat. Skademotorn inflyttad och omdöpt till `@petvold/*`. 43 tester gröna, kontraktslint OK.
- Arbetssätt, roadmap, ADR 0001–0009 och CI på plats.

**Nästa steg**
1. Gemensamt schemabibliotek (`modules/common`) och flytta `Money` dit.
2. Docker compose med Postgres och migrationen.
3. `ClaimsStore` mot Postgres.

**Öppet**
- Licens (se roadmap).
