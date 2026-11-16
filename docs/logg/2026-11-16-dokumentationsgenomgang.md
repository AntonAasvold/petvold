# Genomgång av dokumentationen (PR #75)

**Datum:** 2026-11-16 **ADR:** 0034 **Moduler:** inga, dokumentation och byggskript

## Vad
Tredje delen av granskningen. Texter som inte längre stämde är rättade, och arkitekturen beskriver alla moduler. `status.md` har bara det senaste passet, och kontraktet är sorterat per resurs. Bygget av sajten stoppar på trasiga länkar.

## Hur det fungerar
- **Kontroll av länkar** i `scripts/build-site.ts`. `rewrite` lägger en länk i `broken` om filen inte finns, eller om rubriken efter `#` inte finns på sidan. `headingIds` räknar fram rubrikernas id på samma sätt som renderaren, med `slug` och en räknare för dubbletter. Kodblock hoppas över. Bygget stoppar om något är trasigt.
- **Sorteringen av kontraktet** gjordes en gång med ett skript. Det delade upp `paths` vid varje adress och sorterade på taggens plats i `tags` och sedan på adressen. En jämförelse rad för rad visade att innehållet är detsamma.
- **Statusarkivet:** passen före pass 25 flyttades oförändrade till `docs/status-arkiv.md`.

## Val och avvägningar
- **Arkivet ändras inte.** Där står gamla adresser och antal, och det är rätt eftersom arkivet beskriver läget vid varje pass. Det gäller också byggloggen och ADR:erna.
- **Inga antal i löpande dokumentation.** "Alla 19 listor" blev "alla listor". Antal ändras med varje PR och glöms bort.
- **Ingen kontroll av "Inte byggt än".** Den skulle behöva förstå vad som är byggt. Regeln i `docs/README.md` och granskningen får räcka.

## Att känna till
- En länk till en rubrik måste matcha rubrikens text efter `slug`. Byter man en rubrik, stoppar bygget tills länkarna är rättade.

## Filer
- `scripts/build-site.ts`
- `modules/api/openapi.yaml` (bara ordningen)
- `docs/README.md`, `docs/status.md`, `docs/status-arkiv.md`, `docs/roadmap.md`
- `docs/teknik/arkitektur.md`, `docs/funktion/behorighet.md`, `produktkonfiguration.md`, `policyer.md`, `parter.md` och `teckning.md`
