# Meddelandets sida enligt designsystemet (PR #124)

**Datum:** 2026-11-21 **ADR:** 0032, 0038 **Moduler:** apps/backoffice

## Vad
Meddelandets sida följer detaljsidans mönster, som skadans, policyns och ansökans.
- **Huvud:** brödsmulor och typen som rubrik, till exempel "Försäkringsbrev".
  - Märken visar id och status: streckad medan meddelandet väntar, helfylld när det är skickat eller misslyckat.
  - Flaggorna (sent, försenat, text saknas) visas som streckade märken.
- **Fakta:**
  - mottagaren som länk med namn och språk
  - policyn, ansökan eller skadan som länk, med skadenumret
  - sista dag att skicka
- **Vänster kolumn:**
  - innehållet med schemat
  - lagrummet
  - utskicken
  - uppgifterna: vilken händelse meddelandet gjordes av, vem som gör dokumentet och inställningarnas version
- **Höger kolumn:**
  - PDF:en från Petvold
  - rapporten om ett utskick, med "Skickat" och "Misslyckat" som val (`pv-choice`) med en rad om vad som händer
  - historiken i den mörka loggen: skapat, PDF:en och varje rapport om utskick

## Hur det fungerar
- **Mottagarens namn** hämtas efter meddelandet. Utan `parties:read` visas id:t.
- **Fält med flera värden** i innehållet, som villkoren och förbehållen, tar hela raden under etiketten och är vänsterställda.
- **Inställningssidan** importerar nu själv `wa-radio-group` och `wa-radio`. Förut fick den dem via meddelandets sida, och valet "Vem gör dokumenten" försvann när den sidan slutade använda dem.

## Filer
- `apps/backoffice/src/views/notice-detail.ts`, `src/views/settings-view.ts`, `src/locales/sv.ts`
- `docs/funktion/backoffice.md`, `docs/roadmap.md`
