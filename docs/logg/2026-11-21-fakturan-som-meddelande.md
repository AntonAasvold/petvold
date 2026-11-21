# Pengar, steg 2b-2: fakturan som meddelande (PR #133)

**Datum:** 2026-11-21 **ADR:** 0040, 0032 **Moduler:** `communications`, `api`, back office

## Vad
När faktureringen gör en faktura blir den ett meddelande till kunden av typen `invoice`. Bolagets dokumentsystem hämtar det, gör fakturan och rapporterar utskicket, som för andra meddelanden.

## Hur det fungerar
1. Reläets källa `billing` (`composition.ts`) lämnar `invoice.issued` till `CommunicationsService.handleBillingEvent` innan händelsen går till webhooks.
2. `handleBillingEvent` läser fakturan via den nya porten `InvoiceSource`. Den kopplas i `wiring.ts` (`invoiceSource`) till `BillingService.invoice`.
3. Den bygger meddelandet med `make`, på samma sätt som de andra typerna:
   - innehållet `invoice.v1`
   - mottagaren är fakturans part
   - `invoiceId` i stället för `policyId`
   - sista dag är regeln `sent-on`, med fakturans dag
4. **Texten `payment`** är en ny text i bolagets inställningar, till exempel bankgironumret. Den krävs för `invoice` (`REQUIRED_TEXTS`), och utan den blir meddelandet `incomplete` och hamnar i kön.
5. **Migration 0052:**
   - lägger till `invoice_id` på `communications.notice`
   - tillåter en rad med bara faktura, inte policy eller ansökan
   - lägger till typen i kontrollen
6. `GET /v1/notices?invoiceId=…` filtrerar på faktura, och `notice.created` har `invoiceId`.

## Val och avvägningar
- **Sista dagen är fakturans dag, inte "snarast".** FAL 5 kap. 1 § räknar tiden att betala från den dag kravet skickades, och fakturans förfallodag räknas från fakturans dag. Ett meddelande som skickas sent blir `late`, och då bör någon kontrollera förfallodagen. Petvold flyttar den inte.
- **Fakturan och inte policyn.** En faktura kan samla flera av kundens policyer. Därför har meddelandet `invoiceId` och ingen `policyId`. En kundportal bunden till policyer ser alltså inte fakturameddelandet, och fakturan läses i stället med `GET /v1/invoices`.
- **Vart kunden betalar är bolagets text**, inte en inställning i `billing`. Bankgironumret är bolagets uppgift och skrivs på fakturan som avsändaren, och samma mekanism finns redan för `sender` och `review`.
- **Ingen mall för PDF än.** Med `documentMaker: petvold` gör Petvold bara de typer det har mallar för, så fakturan stannar hos bolagets dokumentsystem tills en mall finns.

## Att känna till
- Bolaget behöver lägga in `payment` i inställningarna för varje marknad och språk. Annars hamnar varje faktura i kön.
- Fakturan säger inte än hur den betalas med autogiro eller kort. Det kommer med `payments` (steg 3).

## Filer
- `modules/communications/src/index.ts` (`invoice`, `handleBillingEvent`, `InvoiceSource`, texten `payment`)
- `db/migrations/0052_communications_invoices.sql`
- `modules/api/src/composition.ts`, `wiring.ts`, `app.ts`
- `apps/backoffice/src/views/settings-view.ts`
