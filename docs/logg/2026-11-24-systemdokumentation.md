# Systemdokumentation i back office (PR #NN)

**Datum:** 2026-11-24 **ADR:** 0035, 0018 **Moduler:** `apps/backoffice`, `docs/processer`

## Vad
Back office har en sökbar dokumentation under **Dokumentation** i menyn. Den visar affärsprocesserna och affärsreglerna, funktionerna och besluten. De första processerna gäller pengarna: premie och faktura, inbetalning, obetald premie, kreditering och tillgodohavanden, utbetalning och bokföring. Det blir 67 regler med id, källa och inställning.

## Hur det fungerar
1. `src/docs-content.ts` läser `docs/processer`, `docs/funktion` och `docs/adr` med Vites `import.meta.glob(..., { query: '?raw' })` när appen byggs. Mallen `0000-mall.md` hoppas över.
2. `src/docs-logic.ts` är ren och testad med Node:
   - `pagesFrom` gör sidor med titel och sortering.
   - `partsOf` delar en sida i avsnitt vid rubrikerna, men inte inne i kodblock.
   - `search` ger avsnitten där alla ord finns, rankade.
   - `rewriteLinks` gör om länkar mellan sidorna till `/docs/...` och tar bort länkar till sidor som inte visas.
3. `src/views/docs-view.ts` (`<pv-docs>`) visar sidorna med `marked`, som repot redan har i samma version. Rubrikerna får samma ankare som på dokumentationssajten. Sökningen sparas i `?q=` med `history.replaceState`.
4. `app-shell.ts` laddar vyn med `import()` när den öppnas. Sidorna är cirka 550 kB och ska inte göra huvudfilen större för den som aldrig öppnar dokumentationen.
5. Menyposten har `anyOf: []`, som nu betyder att alla inloggade ser den.

## Val och avvägningar
- **Byggd från `docs/`, inte en egen kopia.** Dokumentationen har en källa, som CLAUDE.md redan kräver att PR:erna håller aktuell. Nackdelen är att en ändring syns först efter nästa bygge av back office.
- **I back office, inte bara på sajten.** Användaren bad om dokumentationen i gränssnittet. Sajten (`npm run site`) finns kvar för den som inte har inloggning, och den ritar diagrammen.
- **Egen sökning i stället för ett bibliotek som Lunr eller MiniSearch.** Drygt 60 sidor söks på några millisekunder med `includes`. Ett bibliotek hade gett stamning och felstavning, men det var inte värt ett nytt beroende.
- **Rankningen.** Ett ord på en rad som börjar med det ger extra poäng. Annars kom `BET-10`, som hänvisar till `OBET-05`, före regeln själv. Webbläsartestet hittade det.
- **Regel-id per process** (`PREM`, `BET`, `OBET`, `KRED`, `UTB`, `BOK`). Ett id byts aldrig. En upphävd regel behåller sitt id. Då går det att hänvisa till ett id i ett ärende, en ADR eller ett test.
- **Mermaid ritas inte i back office.** Biblioteket är stort, och diagrammen är läsbara som text. Sajten ritar dem.

## Att känna till
- **Processerna för teckning, policyns livscykel, skadereglering, meddelanden och personuppgifter är inte skrivna än.** De beskrivs i funktionssidorna, som också är sökbara.
- **Reglerna är skrivna från koden och funktionssidorna.** Inställningarnas namn är kontrollerade mot koden. Inget test kopplar ett regel-id till koden än.
- **Länkar till `docs/teknik` och `docs/logg`** blir text i back office.

## Filer
- `apps/backoffice/src/docs-logic.ts`, `docs-content.ts`, `views/docs-view.ts`
- `apps/backoffice/test/docs-logic.test.ts`, `e2e/docs.spec.ts`
- `docs/processer/*.md`
