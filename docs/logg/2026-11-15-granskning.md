# Granskning av arkitektur och funktion (PR #59)

**Datum:** 2026-11-15 **ADR:** – **Moduler:** inga, bara dokumentation

## Vad

En genomgång av arkitekturen och funktionen efter M3 och halva M4, med fynd i prioritetsordning och en rekommenderad ordning.

## Hur den gjordes

- **Storlek och beroenden.** Rader kod och test per modul räknades, och beroendena lästes ur `package.json`.
- **Modulgränser.** Jag sökte efter SQL mot andra modulers scheman i varje `postgres.ts` och hittade inga.
- **Löften i ADR:erna mot koden:**
  - Sidindelning finns i ADR 0002 men inte i kontraktet.
  - AsyncAPI är medvetet uppskjutet i ADR 0008.
  - JWT finns i ADR 0016 men saknar adapter.
- **Tidszon.** Jag sökte efter hur "i dag" räknas och hittade 13 ställen med UTC.
- **Kundresan.** Den gicks igenom från pris till skada, mot det som är byggt och det som lagen kräver.

## Val och avvägningar

- **Granskningen ligger i `docs/granskning/`** som ett daterat dokument som inte ändras. Åtgärderna förs in i roadmapen under "Före första kund".
- **Ingen kodgranskning rad för rad.** Den är en egen granskning (`/code-review`).

## Filer

- `docs/granskning/2026-11-15-arkitektur-och-funktion.md`, `docs/granskning/README.md`
- `docs/roadmap.md`, `docs/status.md`, `docs/README.md`
