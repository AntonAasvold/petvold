# Pengar, steg 3a: inbetalningar och låtsasbanken (PR #138)

**Datum:** 2026-11-22 **ADR:** 0017, 0040 **Moduler:** `payments`, `api`, `webhooks`

## Vad
En betaltjänst kan säga till Petvold att pengar kommit in. Inbetalningen sparas en gång och går ut som `payment.succeeded`. Den första adaptern är låtsasbanken `fake`, som demotjänsten ska spela bank med.

## Hur det fungerar
1. Banken skickar `POST /provider-notifications/fake` med ett signerat JSON-dokument (`petvold-fake-bank.v1`). Vägen ligger utanför `/v1/*` och kräver ingen token, på samma sätt som `/d/:token` för dokumentlänkar (`modules/api/src/app.ts`).
2. `PaymentsService.receive` (`modules/payments/src/index.ts`) väljer adaptern efter namnet i adressen. `FakeProvider.parseNotification` (`fake.ts`) kontrollerar signaturen med `verifySignature` och översätter till `ReceivedPayment`.
3. `checkReceived` kontrollerar varje inbetalning: belopp i hela minsta enheter över noll, giltigt datum, referens med bokstäver och siffror, och marknad och valuta bland adapterns `capabilities()`. Ett fel avvisar hela aviseringen.
4. `PaymentsStore.addPayment` sparar inbetalningen och händelsen i samma transaktion. Unikheten `(provider, provider_ref)` gör att en avisering som kommer två gånger bara ger en inbetalning.
5. Reläets nya källa `payments` (`composition.ts`) skickar händelsen till webhooks. I steg 3b får `billing` den också.

## Val och avvägningar
- **Låtsasbanken signerar som Petvolds egna webhooks** (Standard Webhooks, HMAC-SHA256 av `id.timestamp.body`). Demotjänsten verifierar redan det formatet åt andra hållet, så den behöver bara en signeringsfunktion. Riktiga adaptrar har tjänstens egen signatur.
- **Mottagningen ligger utanför OpenAPI-kontraktet.** Kroppen är tjänstens format och inte Petvolds API, och varje adapter har sitt eget. Formatet för `fake` är beskrivet i [Premier och betalningar](../funktion/premier.md#låtsasbanken-fake).
- **Porten har bara det som används.** ADR 0017 beskriver också `collect`, `payout`, `refund` och `getStatus`. De läggs till med de steg som behöver dem, så att ingen adapter behöver låtsas att den kan något.
- **En avisering kan ha flera inbetalningar**, som en `camt.054`-fil har. Då behöver porten inte ändras när bankfilerna kommer.
- **Samma id med annat innehåll avvisas** i stället för att tyst ignoreras. Det är ett fel hos tjänsten, och det ska synas.
- **Inbetalningen har `status: succeeded` och `direction: incoming`** fast inget annat finns än. Tillståndsmaskinen i ADR 0017 och utbetalningarna kommer i senare steg, och kontraktet behöver då inte byta form.
- **Inga uppgifter om betalaren** sparas eller skickas. Namn och konto behövs inte för att koppla till en faktura med OCR, och de är personuppgifter.

## Att känna till
- Inbetalningarna kopplas inte till fakturor än (steg 3b). Därför finns ingen kö för okopplade inbetalningar ännu.
- Servern för drift har låtsasbanken bara när `PETVOLD_FAKE_BANK_SECRET` är satt, och skriver då en rad i loggen. Dev-servern har den alltid, med en fast hemlighet.
- En signatur gäller i fem minuter, så banken och Petvold behöver ungefär samma klocka.
- Produktionen behöver `PAYMENTS_DATABASE_URL` och tjänsterollen `payments_service` före migration 0054.

## Filer
- `modules/payments/src/index.ts`: porten, tjänsten, signaturen och lagringen i minnet
- `modules/payments/src/fake.ts`: låtsasbanken
- `modules/payments/src/postgres.ts` och `db/migrations/0054_payments.sql`
- `modules/payments/test-suites/provider.ts`: sviten varje adapter ska klara
- `modules/api/src/app.ts`, `composition.ts`, `server.ts` och `dev-server.ts`
