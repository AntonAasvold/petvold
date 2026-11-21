# Webhookens sida enligt designsystemet (PR #125)

**Datum:** 2026-11-21 **ADR:** 0033 **Moduler:** apps/backoffice

## Vad
En prenumerations sida följer detaljsidans mönster.
- **Huvud:**
  - brödsmulor
  - beskrivningen, eller adressen om beskrivning saknas, som rubrik
  - märken för id och status: helfylld när den är aktiv, streckad när den är avstängd
  - "Fallerar sedan" som streckat märke
- **Fakta:** adressen, marknaderna och den senaste ändringen.
- **Vänster kolumn:**
  - utskicken i ett kort med flikar: kom inte fram, väntar, levererade
  - uppgifterna: händelser, varför den är avstängd, hur länge den förra hemligheten signerar, och revision
- **Höger kolumn:**
  - hemligheten, när den just visas
  - åtgärderna i ett kort med kraftig ram: skicka alla igen (när något inte kom fram), stänga av eller sätta på, och ny hemlighet, med en rad om hur länge den förra hemligheten gäller

## Att känna till
- **Ingen historik på sidan.** Prenumerationen har bara sin senaste ändring och ingen historik i API:t, så sidan saknar logg.

## Filer
- `apps/backoffice/src/views/webhook-detail.ts`, `src/locales/sv.ts`
- `docs/funktion/backoffice.md`, `docs/roadmap.md`
