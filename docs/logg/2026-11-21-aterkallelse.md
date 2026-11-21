# Återkallelse av ett avslut mot fakturorna (PR #137)

**Datum:** 2026-11-21 **ADR:** 0040 (punkt 4), 0029 **Moduler:** `billing`

## Vad
När ett avslut återkallas (`policy.reinstated`) får kunden tillbaka sin plan: delbetalningarna som avslutet tog bort kommer tillbaka, och det som krediterades faktureras igen.

## Hur det fungerar
`BillingService.adjust` tar händelsen och hittar varje plan i kraft med `adjustment.kind = 'cancellation'` och samma transaktion som `reverses`. För varje sådan plan:
1. Den läser planen före avslutet (`replaces`) och tar dess delbetalningar som inte var fakturerade.
2. Den summerar kreditnotorna från avslutets händelse för termen och kontot, och gör summan till en egen delbetalning med förfallodag samma dag. Faktureringen ger sedan lagens minsta tid.
3. Har avslutets egen delbetalning, den nya debiteringen, redan fakturerats, dras den från de återställda delbetalningarna med `reduceInstallments`.
4. Den nya planen ersätter avslutets plan med `adjustment.kind = 'reinstatement'`, och premien och skatten läggs tillbaka.

## Val och avvägningar
- **Det krediterade faktureras igen, och kreditnotorna står kvar.** En kreditnota ändras aldrig, så rättelsen är en ny debitering. Det är samma regel som för fakturor.
- **Bara en avslutsplan i kraft kan återkallas.** Har en ändring kommit efter avslutet gör återkallelsen ingenting i `billing`. Det borde inte hända, eftersom policymodulen inte ändrar en avslutad policy, men ett fel loggas inte. Det är skrivet i funktionssidan.
- **Egenskapstestet** prövar avslut, eventuell fakturering av avslutets debitering och återkallelse: termen faktureras då exakt vad den kostade före avslutet.

## Att känna till
Steg 2 i ADR 0040 är klart. Nästa steg är `payments` med inbetalningar och utbetalningar.

## Filer
- `modules/billing/src/index.ts`
- `modules/billing/test/adjustments.test.ts`, `adjustments.property.test.ts`
