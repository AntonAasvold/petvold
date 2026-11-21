# Ansökans sida enligt designsystemet (PR #123)

**Datum:** 2026-11-21 **ADR:** 0031 **Moduler:** apps/backoffice

## Vad
Ansökans sida följer detaljsidans mönster i designsystemet, som skadans och policyns:
- **Huvud:** brödsmulor och rubriken "Ansökan för Rocky", med id och status. Statusen är streckad medan ansökan väntar på prövning och helfylld när den är avgjord.
- **Fakta:** djuret och sökanden som länkar med namn, startdag, när ansökan kom in och sista dag för beslut. Är ansökan godkänd visas också policyn.
- **Vänster kolumn:** reglernas kontroller med regelversionen, svaren och uppgifterna (art, ras, födelsedag, produkt, premie, kampanjkod och marknad).
- **Höger kolumn:**
  - **prövningen** som kort med kraftig ram: godkänn eller avslå som val med en rad om vad som händer, och motivering
  - **beslutet** när det är fattat, med utfall, skälkod, förbehåll, motivering, vem och när
  - **återkallelse**
  - **historiken** i den mörka loggen: inkommen med det reglerna gav, och beslutet

## Hur det fungerar
- **Djuret och sökanden** hämtas efter ansökan och visas med id om rätten att läsa dem saknas.
- **Valen** använder designsystemets `pv-choice`, som beslutet på skadan, i stället för `wa-radio-group`.

## Filer
- `apps/backoffice/src/views/application-detail.ts`, `src/locales/sv.ts`, `e2e/policies.spec.ts`
- `docs/funktion/backoffice.md`, `docs/roadmap.md`
