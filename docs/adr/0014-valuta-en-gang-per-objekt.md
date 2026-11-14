# 0014. Belopp som heltal med valutan en gång per objekt

- Status: Beslutad
- Datum: 2026-11-14
- Ersätter: 0005

## Sammanhang

ADR 0005 säger att `Money` är `{ amount, currency }`. Kontraktet och `claims-core` gör annorlunda: beloppen är heltal, och valutan står en gång på objektet som bär dem (`Claim.currency`, `Calculation.currency`, `Limits.currency`). Beslutet och koden måste stämma innan fler moduler (policy, tariff, billing, ledger) bygger vidare. Ändringen är billig nu, eftersom kontraktet inte har några externa klienter.

Det finns två vägar.

**A. Valutan en gång per objekt.** Heltal för belopp och ett `currency`-fält per objekt. Alla belopp i objektet är i den valutan. Stripe gör så här.

**B. `Money`-objekt för varje belopp.** `{ "amount": 1216500, "currency": "SEK" }` för varje belopp. Adyen gör så här.

| | A. Valuta per objekt | B. `Money` per belopp |
| --- | --- | --- |
| Blandade valutor i ett ärende | Kan inte uttryckas | Kan uttryckas och måste valideras bort |
| Ett belopp som lyfts ur sitt objekt | Tappar valutan | Bär valutan med sig |
| Storlek och läsbarhet | Kompakt | En `Calculation` får 15 upprepningar av `"SEK"` |
| Kontraktet och kärnan i dag | Stämmer redan | Brytande ändring i 18 fält, plus en mappning i API:et |

## Beslut

Vi väljer **A**:

- Belopp är heltal i minsta valutaenhet (`MinorUnits`). Procentsatser anges i baspunkter. Avrundning sker halvt uppåt på ett enda ställe (`applyBp` i `@petvold/common`). Valutor växlas aldrig inne i flödena. Detta är oförändrat från 0005.
- **Varje objekt som bär belopp har exakt ett `currency`, och alla belopp i objektet är i den valutan.** I Petvold är en valuta per ärende, policy och faktura en domänregel, eftersom vi aldrig växlar. Då ska kontraktet göra blandade valutor omöjliga att uttrycka, inte bara ogiltiga.
- **`Money` (`{ amount, currency }`) används bara där ett belopp står för sig själv** utan ett objekt med valuta runt sig. Exempel är ett ensamt belopp i en händelse, eller en lista där raderna kan ha olika valuta, som ett kundsaldo över flera marknader.
- **Fältnamn:** beloppsfält heter som det de är (`payout`, `annualLimit`) utan suffix i kontraktet. I databasen har kolumnerna suffixet `_minor`, som i dag.
- **Ledgern ska vara självbeskrivande.** Varje journal får en valuta, och konton för försäkringsbelopp får valutan i namnet, som `claim_*`-kontona redan har. Detta görs med en ny migration när `claims-store-postgres` byggs.

## Konsekvenser

- Ingen brytande ändring i kontraktet. `Money` i `@petvold/common` behålls för fristående belopp och för beräkningar som ska kontrollera valutan.
- Klienter måste läsa beloppet tillsammans med objektets `currency`. Kontraktets beskrivning av `Money`-fälten säger det redan.
- En regel för kontraktslinten blir möjlig: ett schema med beloppsfält måste ha `currency`.
- Ledgern behöver en migration: `currency` på `claims.journal` och valuta i kontonamnen `limit_*`. Genomfört i migration 0003 (journalens valuta) och 0004 (kontonamnen).

## Alternativ

- **B, `Money` per belopp:** säkrast när belopp flyttas runt fritt, men det gör blandade valutor möjliga där domänen förbjuder dem, och kontraktet blir mycket pratigare.
- **Decimalsträngar (`"12165.00"`):** vanligt i vissa API:er men kräver decimalbibliotek i klienterna och strider mot heltalsregeln.

## Källor

- Stripe API Reference, *Charges* och *Invoices* (`amount` som heltal i minsta enhet, `currency` på objektet): docs.stripe.com/api
- Adyen API Explorer, *Amount* (`{ value, currency }`): docs.adyen.com/api-explorer
- ISO 4217 för valutakoder och antal decimaler.
