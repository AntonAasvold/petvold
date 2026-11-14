# Status

Läses i början och uppdateras i slutet av varje arbetspass. Senaste först.

## 2026-11-14 (pass 11)

**Gjort**
- #12 mergad: valuta i kontonamnen för försäkringsbelopp.
- ADR 0016 om behörighet, föreslagen: rättigheter per anrop i kontraktet (`x-permission`), roller översätts till rättigheter per installation, inget `system` som släpper igenom allt, omfång per marknad och klinik (404 utanför omfånget), beloppsgränser och fyraögonsprincip i kärnan.
- CloudEvents och AsyncAPI väntar tills det finns en mottagare utanför Petvold (tillägg i ADR 0008, flyttat i roadmap). Bara Postgres: pollning nu, LISTEN/NOTIFY om det behövs, pg-boss för jobb.

**Nästa steg**
1. Anton beslutar om ADR 0016.
2. Behörighet del 1: `x-permission` i kontraktet, kontroll i API-lagret, standardroller, lint-regel, ta bort `system`.
3. Behörighet del 2: omfång per marknad och klinik, med migration för klinik-id.
4. Kedjan reserv, beslutsförslag, beslut, attest och betalning, med beloppsgränser (behörighet del 3).

**Öppet**
- Läsningar och förhandsbedömning är oskyddade tills del 1 är klar. Spelar ingen roll lokalt, men måste vara klart före drift.

## 2026-11-14 (pass 10)

**Gjort**
- #11 mergad: dev-servern på Postgres.
- Valuta i kontonamnen för försäkringsbelopp (ADR 0014): `limit_consumed:<valuta>:<djur>:<moment>:<årsstart>`, som `claim_*`-kontona redan har.
- Kontonamnen byggs på ett ställe, `accounts` i `claims-core/src/ledger.ts`. Lagringarna och sviten använder samma funktioner.
- `getConsumed` tar en `LimitKey` (djur, moment, försäkringsår och valuta). Belopp i en annan valuta räknas aldrig med (nytt test i sviten).
- Tjänsten vägrar bokföra om ärendet och policyn har olika valuta. Bedömningen avslår redan sådana ärenden, så det är ett skydd för en journal med en enda valuta.
- Migration 0004 byter namn på befintliga konton med journalens valuta. Provad upp, ner och upp igen med data i gammalt format.
- 98 tester och 36 databastester.

**Nästa steg**
1. ADR om behörighet.
2. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.
3. Kedjan reserv, beslutsförslag, beslut, attest och betalning (resten av M1).
4. Gemensamma kontraktsdelar (Money, Problem, paginering, Ref) och Biome.

## 2026-11-14 (pass 9)

**Gjort**
- #10 mergad: outbox och relä.
- Dev-servern på Postgres: väljer lagring efter `CLAIMS_DATABASE_URL` i `.env`, ansluter som `claims_service` och skriver ut vilken lagring som används. Utan variabeln körs allt i minnet som förut.
- `PostgresIdempotencyStore` i `claims.idempotency`: ett upprepat anrop ger samma svar även efter omstart (4 tester).
- Slumpade id:n i dev-servern, så att id:n inte upprepas mellan omstarter.
- Verifierat: registrera, starta om, samma nyckel ger samma beslut, ärendet och förbrukat belopp finns kvar, och ett nytt anrop för samma ärende ger 409.
- 97 tester och 35 databastester.

**Nästa steg**
1. Valuta i kontonamnen `limit_*` (ADR 0014).
2. ADR om behörighet.
3. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.
4. Kedjan reserv, beslutsförslag, beslut, attest och betalning (resten av M1).

## 2026-11-14 (pass 8)

**Gjort**
- #9 mergad: all kod på engelska.
- Outbox (ADR 0008): `saveClaim` och `commitDecision` tar emot händelser och skriver dem till outboxen i samma transaktion. Tjänsten publicerar inte längre själv.
- Ny port `ClaimsOutbox` (`pendingEvents`, `markPublished`) och `relayOutbox` i kärnan: publicerar i ordning, markerar efter leverans, stannar vid fel och fortsätter från samma händelse nästa gång.
- Sviten utökad med 5 outbox-tester (händelser skrivs atomiskt, inga händelser vid fel, ordning, gräns, publicerade försvinner). Båda lagringarna klarar dem.
- Dev-servern kör reläet varje sekund och loggar händelserna.
- 97 tester och 31 databastester.

**Nästa steg**
1. Dev-servern på Postgres (`npm run dev` sparar data mellan omstarter).
2. Valuta i kontonamnen `limit_*` (ADR 0014).
3. ADR om behörighet.
4. AsyncAPI för händelserna och CloudEvents-kuvert i reläet.

**Öppet**
- Bara ett relä per outbox åt gången. Flera samtidiga reläer kräver radlås (`for update skip locked`).

## 2026-11-14 (pass 7)

**Gjort**
- ADR 0015 beslutad, #8 mergad.
- Regel: all kod på engelska, inklusive kommentarer, felmeddelanden, loggar, testnamn, SQL, konfiguration, kontrakt och exempeldata (`CLAUDE.md`, `docs/arbetssatt.md`). Dokumentation och commits fortsätter på svenska.
- `npm run lint:lang` i CI: stoppar å, ä och ö i koden. Undantag: den svenska språkkatalogen och körda migreringar.
- All befintlig kod översatt: kärnan, API:et, kontraktet med exempel, lagringarna, testerna, `examples/claims.http`, `compose.yaml`, CI och `db/init` (bytt namn till `01-roles-and-databases.sql`). Problem-texterna i API:et är nu på engelska.
- Exempeldata (Bella, fakturarader) på engelska.

**Nästa steg**
1. Outbox: händelser skrivs i samma transaktion som ärendet och beslutet.
2. Dev-servern på Postgres.
3. Valuta i kontonamnen `limit_*` (ADR 0014).
4. ADR om behörighet.

**Öppet**
- Migreringarna 0001–0003 har kommentarer på svenska. De ändras inte eftersom de redan körts.
- Kontrollen hittar inte svenska utan å, ä eller ö. Granskning fångar resten.

## 2026-11-14 (pass 6)

**Gjort**
- `modules/claims-store-postgres`: `PostgresClaimsStore` klarar alla 16 tester i den gemensamma sviten, ansluten som `claims_service`.
- Tjänsten körd mot Postgres: automatisk reglering, handläggarbeslut, förbrukat belopp, omprövning och självriskperiod (3 tester).
- Migration 0003: fakturaradernas ordning (`line_no`) och valuta på journaler (ADR 0014), med ifyllnad av befintliga rader. `LedgerJournal` har `currency`.
- CI backar nu senaste migreringen med data i tabellerna och kör den igen. Det fångade att första versionen av 0003 inte klarade befintliga rader.
- `.env` hade av misstag kommit med i #5. Borttagen ur git (bara lokala dev-värden).
- ADR 0015 beslutad: node-postgres och ren SQL.
- 26 databastester och 88 övriga tester.

**Nästa steg**
1. Outbox: händelser skrivs i samma transaktion som ärendet och beslutet.
2. Dev-servern på Postgres (`npm run dev` sparar data mellan omstarter).
3. Valuta i kontonamnen `limit_*` (ADR 0014).
4. ADR om behörighet: rättigheter i kontraktet, roller per installation, egna ärenden för kliniker, beloppsgränser och fyra ögon.

## 2026-11-14 (pass 5)

**Gjort**
- API-sida på `/docs` i dev-servern (Scalar 1.76.4, genererad från kontraktet, `dev-handler` förifylld).
- Exempel i kontraktet: öroninflammation (automatisk), korsbandsskada (till handläggare), behandling före start (avslag), plus beslut och omprövning. Tester kontrollerar att exemplen följer schemat och ger beskrivet utfall.
- `examples/claims.http` med hela flödet och felfall, och REST Client som föreslaget VS Code-tillägg.
- ADR 0014 beslutad. #6 och #7 mergade.

**Nästa steg**
- Se pass 4: `claims-store-postgres` först.

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
