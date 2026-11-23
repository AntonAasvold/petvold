# Pengar, steg 3c-2: direktreglering till kliniker (PR #147)

**Datum:** 2026-11-23 **ADR:** 0040 **Moduler:** `payments`, `api`, `webhooks`

## Vad
En klinik med avtal om direktreglering får ersättningen för de skador den anmält, i stället för försäkringstagaren. Avtalen och klinikens betaluppgifter sköts i API:t. Därmed är steg 3 i ADR 0040 klart.

## Hur det fungerar
- `handleClaimEvent` läser `clinicId` i `claim.payout_ordered`. Har kliniken ett avtal som gäller den dagen (`agreementInForce`) blir kliniken mottagare, annars försäkringstagaren.
- En mottagare (`Payee`) är en part eller en klinik, aldrig båda. Betaluppgifter och utbetalningar har `partyId` eller `clinicId`, och migration 0057 kontrollerar att exakt en finns.
- Ett avtal ändras aldrig. Ett avslut läggs till bredvid, en gång (`clinic_agreement_ending`).
- Allt annat är detsamma som för en part: väntan utan uppgifter, spärr för nya uppgifter och frisläppning med fyra ögon.

## Val och avvägningar
- **Kliniken identifieras med `clinicId`** från dess token och skador, eftersom Petvold inte har något klinikregister. Konventionen om prefix på id:n i adressen fick ett uttryckligt undantag för `clinicId`, med skälet i koden och i API-konventionerna.
- **Avtalet gäller ordern, inte behandlingen.** Det är dagen för utbetalningsordern som avgör, eftersom det är då pengarna ska ut. En klinik som lämnar avtalet får inga fler utbetalningar efter den dagen, också för äldre behandlingar.
- **Ingen överlappning:** två avtal för samma klinik och marknad får inte gälla samma dag. Då är det alltid entydigt vem som får betalt.
- **Kontrakten från 3c-1 ändrades** så att `partyId` inte längre krävs på utbetalningar, betaluppgifter och `payout.*`. De var några timmar gamla och har inga mottagare utanför Petvold än.

## Att känna till
- En klinik ser inte sina egna utbetalningar eller avtal än. Rollen `clinic` saknar `payments:read`.
- I demon har klinik 001 (`dev-clinic`) avtal från start: av 30 utbetalningar på sex månader gick 22 till kliniken.

## Filer
- `modules/payments/src/payouts.ts`, `index.ts` och `postgres.ts`
- `db/migrations/0057_payments_clinics.sql`
- `modules/api/src/app.ts`, `conventions.ts` och `demo-data.ts`
