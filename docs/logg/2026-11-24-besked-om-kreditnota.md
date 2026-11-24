# Besked om kreditnota till kunden (PR #164)

**Datum:** 2026-11-24 **ADR:** 0040 punkt 5, 0032 **Moduler:** `communications`, `api`, `apps/backoffice`

## Vad
Kunden får ett meddelande när en faktura krediteras. Det gäller både en kreditnota som en person gör och en kreditnota efter en ändring, ett avslut eller en överlåtelse. En avskrivning ger inget besked.

## Hur det fungerar
1. `invoice.credited` från `billing` når redan `communications.handleBillingEvent` genom relän. Den gör nu också ett meddelande av typen `credit-note` (`credit-note.v1`).
2. Porten `InvoiceSource` har `creditNote(id)`, som ger `CreditNoteView`. `invoiceSource` i `wiring.ts` läser den med `BillingService.creditNote`. `cause` är kreditnotans `source.eventType`: policyhändelsen, `manual` eller `credit-proposal`.
3. En kreditnota med `kind: 'write-off'` ger `null` och inget meddelande.
4. Typen är inte lagkrav och ska skickas snarast. Den kan stängas av med `disabledTypes`.
5. Migration 0067 lägger till typen i `notice_type_check`.

## Val och avvägningar
- **Inget besked vid avskrivning.** En avskrivning är bolagets beslut i bokföringen. Det är inte självklart att bolaget vill tala om för kunden att skulden inte drivs vidare. Bolaget kan skicka ett eget brev.
- **Handläggarens skäl kommer inte med.** Det är fritext och kan vara en intern anteckning. Beskedet säger i stället vad som gav kreditnotan.
- **Beskedet gäller också kreditnotor från policyhändelser.** Kunden får redan en bekräftelse på avslutet, men kreditnotan är det dokument som visar att fakturan har ändrats.

## Att känna till
- **Petvold har ingen egen mall** för kreditnotan. Med `documentMaker: petvold` gör bolagets dokumentsystem den ändå.
- **Kreditnotor från tidigare** ger inga besked i efterhand.

## Filer
- `modules/communications/src/index.ts`
- `modules/api/src/wiring.ts`, `composition.ts`, `openapi.yaml`, `test/credit-notes.test.ts`
- `apps/backoffice/src/views/labels.ts`, `locales/sv.ts`, `api/schema.d.ts`
- `db/migrations/0067_communications_credit_notes.sql`
