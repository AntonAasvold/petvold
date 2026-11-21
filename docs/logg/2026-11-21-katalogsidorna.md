# Produktens och regeluppsättningens sidor enligt designsystemet (PR #126)

**Datum:** 2026-11-21 **ADR:** 0021, 0023 **Moduler:** apps/backoffice

## Vad
En produkts och en regelseries sida följer detaljsidans mönster. Därmed följer alla detaljsidor i back office mönstret.
- **Huvud:** brödsmulor och rubriken, till exempel "Produkt SE-HUND-VV-LIV".
- **Fakta:** den publicerade versionen med datum, antal utkast och versioner under granskning, och antal versioner.
- **Vänster kolumn:** versionerna och den valda versionens innehåll, med sammanfattningen och JSON under en utfällbar rad. Ett utkast redigeras här i ett kort med kraftig ram.
- **Höger kolumn:** den valda versionen med status, vem som skapade, skickade och publicerade den, och åtgärderna under varandra. Kortet har kraftig ram när det finns något att göra.

## Hur det fungerar
- **`<pv-versions-panel>`** ritar fakta och de två kolumnerna. Vyerna i `catalog-views.ts` ritar bara huvudet.
- **Ingen knapp Tillbaka finns kvar** i back office, så texten `common.back` är borttagen.

## Filer
- `apps/backoffice/src/components/versions-panel.ts`, `src/views/catalog-views.ts`, `src/locales/sv.ts`, `e2e/catalog.spec.ts`
- `docs/funktion/backoffice.md`, `docs/roadmap.md`
