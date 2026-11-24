# Pengar, steg 8c: betaluppgifter och kliniker i back office (PR #NN)

**Datum:** 2026-11-24 **ADR:** 0040, 0035 **Moduler:** `apps/backoffice`

## Vad
Partens sida visar betaluppgifterna och utbetalningarna, och nya uppgifter kan ges. **Pengar** har två nya flikar:
- **Väntar på betaluppgifter**
- **Kliniker:** avtal om direktreglering görs och avslutas, och klinikens betaluppgifter ges.

## Hur det fungerar
1. `src/payee-logic.ts` är ren och testad:
   - `ibanOk` räknar ISO 13616: siffrorna mod 97 ska bli 1, räknat bit för bit så att inget stort tal behövs.
   - `payeeProblems` och `payeeBody` kontrollerar ett svenskt konto efter kontraktets mönster och tar bort mellanslag och bindestreck.
   - `agreementProblems`, `agreementBody`, `inForce` och `endingProblems` hör till avtalen. `validTo` ingår inte, som i API:t.
2. `src/components/payee-accounts.ts` (`<pv-payee-accounts>`) visas för en part (`party-id`) eller en klinik (`clinic-id`). Komponenten läser uppgifterna, och för en part också utbetalningarna, och har formuläret.
3. `<pv-money>` har två nya flikar. *Väntar på betaluppgifter* läser `GET /v1/payouts?status=awaiting-details`. *Kliniker* läser `GET /v1/clinic-agreements`. Ett valt avtal visar `<pv-payee-accounts>` för kliniken.
4. `payoutStatusLabel` i `labels.ts`.

## Val och avvägningar
- **En komponent för både part och klinik.** Uppgifterna och reglerna är desamma. Bara adressen i API:t skiljer.
- **Formuläret för ett nytt avtal visas när inget avtal är valt.** Då behövs ingen dialog, och fliken börjar med det man oftast gör.
- **En utbetalning som väntar på uppgifter till en part** leder till partens sida. Där finns uppgifterna och historiken, och det är där kundservice ändå arbetar.

## Att känna till
- **Numret visas som API:t maskerar det.** Back office ser aldrig hela numret efter att det sparats.
- **Betaluppgifter raderas inte än när en part anonymiseras** (ADR 0040, punkt 11). Kortet visas inte för en anonymiserad part.

## Filer
- `apps/backoffice/src/payee-logic.ts`, `components/payee-accounts.ts`, `views/money-view.ts`, `views/labels.ts`
- `apps/backoffice/test/payee-logic.test.ts`, `e2e/payees.spec.ts`
