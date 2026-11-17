# Designsystemet Petvold (PR #86)

**Datum:** 2026-11-16 **ADR:** 0035 (back office) **Moduler:** `apps/backoffice`, `design/`

## Vad
Petvold har ett designsystem: svartvitt, med ramar i stället för skuggor. Tokens, ett tema för Web Awesome och riktlinjer finns i repot, så att den som bygger gränssnitt, människa eller kodagent, har en källa att följa.

## Hur det fungerar
- `design/tokens.json` är källan. Formatet är listor med `name`, `value` och `usage`, samma som designsystemet på claude.ai, så att de två går att hålla lika.
- `apps/backoffice/src/styles/petvold-tokens.css` är tokens som CSS-variabler. Ljust tema på `:root` och `.wa-light`, mörkt på `.wa-dark`, alltså samma klasser som Web Awesome använder.
- `apps/backoffice/src/styles/petvold-theme.css` sätter Web Awesomes variabler (`--wa-color-*`, typsnitt, linjer, hörn, fokus och skuggor) till Petvolds tokens under klassen `wa-theme-petvold`. Variablerna ärvs in i Lit-komponenternas shadow DOM, så befintliga vyer får utseendet utan att ändras.
- `main.ts` laddar Web Awesome, typsnitten från `@fontsource/*`, tokens och temat i den ordningen, och `index.html` har `wa-theme-petvold` i stället för `wa-theme-default`.

## Val och avvägningar
- **Ett tema för Web Awesome i stället för egna komponenter.** Back office är byggd med Web Awesome. Ett tema ger hela appen utseendet på en gång, och egna komponenter behövs bara där Web Awesome saknar en (beräkningen, stegen, loggen).
- **Statusfärger är grå.** Success, warning och danger blir gråskala. Tillstånd syns med text, ikon och helfylld eller streckad linje. Danger får en svart ram så att fel ändå syns.
- **`pv-`-klasserna finns i `design/components.css`.** Globala klasser når inte in i shadow DOM, men en Lit-komponent kan ta in dem i `static styles`, och CSS-variabler ärvs in. Se [Lits dokumentation om stilar](https://lit.dev/docs/components/styles/).
- **Typsnitten från npm** i stället för Google Fonts, som ikonerna: inget hämtas från ett CDN.
- **Textklasserna heter `.pv-text-*`** för att inte krocka med andra klasser som `.label`.

## Att känna till
- `design/components.css` hämtade typsnitten från Google Fonts med en `@import`. Raden är borttagen, eftersom typsnitten kommer från `@fontsource` och inget ska hämtas från ett CDN. Det spelar roll när komponenterna tar in klasserna i `static styles`.
- Typsnittspaketen är version 5.3.0 från juli 2026 (OFL-1.1). Bygget har 44 typsnittsfiler och inga adresser till Google Fonts.
- De 19 flödestesterna går igenom med det nya temat, eftersom de letar efter roller och text och inte efter färger.
- Appens utseende ändras överallt. Skärmbilder i e2e-testerna, om sådana tillkommer, behöver tas om.
- `petvold-tokens.css` är genererad men det finns inget skript för det i repot än.
- Exempeltexterna i `tokens.json` är på engelska, eftersom `npm run lint:lang` kontrollerar JSON-filer.

## Filer
- `design/tokens.json`, `design/components.css`
- `apps/backoffice/src/styles/petvold-tokens.css`, `petvold-theme.css`
- `apps/backoffice/src/main.ts`, `apps/backoffice/index.html`, `apps/backoffice/package.json`
- `docs/teknik/designsystem.md`
