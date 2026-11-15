# Omprövning av skador när en policyversion ersätts (PR #50)

**Datum:** 2026-11-15 **ADR:** 0018, 0029 **Moduler:** `claims-core`, `claims-store-memory`, `claims-store-postgres`, `api`

## Vad

När policymodulen ersätter en version, till exempel vid ett avslut bakåt i tiden, en överlåtelse eller en återkallelse, omprövar skademotorn skadorna som beslutades på den versionen.

## Hur det fungerar

1. Policymodulen skriver `policy.version_superseded` med `versionId` för varje ersatt version (sedan PR #47).
2. Installationens relay anropar `ClaimsService.reassessForPolicyChange([versionId], skäl, 'policy-change')`.
3. `ClaimsStore.claimsDecidedOnPolicyVersions` hittar skador vars **senaste** beslut har versionen i `policy_version_id`.
4. Varje skada går genom den befintliga `reassess`. Den bedömer om mot policyn som gäller nu och skapar ett nytt beslut bara om `inputHash` har ändrats. Ledgern bokför skillnaden.

## Val och avvägningar

- **Bara det senaste beslutet räknas.** En skada som redan har omprövats på en nyare version hittas inte igen.
- **Upprepning är ofarlig.** En händelse som kommer två gånger hittar inga skador, eller ger samma `inputHash` och inget nytt beslut.
- **Nya beslut även när beloppet är detsamma.** Versionens id ingår i underlaget, så en skada före avslutsdagen får ett nytt beslut med samma ersättning. Det visar att beslutet prövades mot den nya versionen.
- **Ingen ny API-operation.** Det är relayn som kopplar ihop modulerna, som för djurregistrets händelser.

## Att känna till

- En sänkt ersättning ger ingen återkravsorder (M5).
- I dev-servern provade jag med Bella. En skada på 1 500 kr avslogs när policyn avslutades från 1 november, och godkändes igen när avslutet återkallades. Bellas policy är tillbaka som förut.

## Filer

- `modules/claims-core/src/service.ts` (`reassessForPolicyChange`), `modules/claims-core/src/ports.ts`
- `modules/claims-store-memory/src/index.ts`, `modules/claims-store-postgres/src/index.ts`
- `modules/api/src/dev-server.ts`
- `modules/claims-core/test/service.test.ts`, `modules/claims-core/test-suites/claims-store.ts`
