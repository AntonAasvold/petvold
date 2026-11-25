# Dokumentationen i back office är för användarna (PR #NN)

**Datum:** 2026-11-25 **ADR:** 0035 **Moduler:** `apps/backoffice`

## Vad
Dokumentationen i back office visar bara processerna och reglerna, och funktionerna. Arkitekturbesluten (ADR) är borttagna därifrån. Tillsammans med den tekniska dokumentationen, API:ts kontrakt och byggloggen finns de på GitHub och på dokumentationssajten.

## Hur det fungerar
`docs-content.ts` läser inte längre `docs/adr`. `DocSection` har två delar, och vägen `/docs/adr/…` finns inte. En länk från en process till en ADR går genom `rewriteLinks` och blir text, som länkar till teknisk dokumentation redan blev.

## Val och avvägningar
- **Användarna i back office är handläggare, ekonomi och dataskyddsansvariga.** Besluten om arkitekturen hjälper dem inte, och de gjorde sökträffarna längre.
- **Källhänvisningarna i reglerna** står kvar som text, till exempel "ADR 0040, punkt 8". De visar varifrån en regel kommer, också för den som inte läser beslutet.

## Att känna till
- **Funktionssidorna innehåller fortfarande API:ts anrop**, i tabeller med rubriken "Anrop" och i exempel. Ska de också bort från back office behöver sidorna delas i en del för användare och en för utvecklare.

## Filer
- `apps/backoffice/src/docs-content.ts`, `docs-logic.ts`, `views/docs-view.ts`, `components/app-shell.ts`, `locales/sv.ts`, `test/docs-logic.test.ts`
