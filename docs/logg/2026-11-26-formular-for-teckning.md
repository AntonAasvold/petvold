# Formulär för teckningsregler (PR #181)

**Datum:** 2026-11-26 **ADR:** 0031, 0021, 0035 **Moduler:** `apps/backoffice`

## Vad
Teckningsreglerna redigeras i ett formulär i stället för JSON. Det är det sista innehållet under Regeluppsättningar som saknade formulär.

## Hur det fungerar
- **`src/underwriting-form.ts`** är ren och testad.
  - Åldersgränser och raser skrivs en per rad, till exempel `dog; 42; 9`. Ett tomt sista fält betyder ingen övre gräns.
  - Frågorna och reglerna är listor med fält.
  - Kontrollerna följer motorns `validateUnderwriting`. En fråga behöver giltigt id och text. En regel behöver en känd fråga och en skälkod. `onlyFor` finns bara för en diagnosfråga. Ett förbehåll behöver en beskrivning, och vid en ja- eller nej-fråga också diagnoskoder.
  - En regel som inte är ett förbehåll tappar koder och beskrivning, som motorn kräver.
- **`<pv-underwriting-content>`** i `content-forms.ts` visar varje fråga och regel som en grupp med fält, på samma sätt som självriskerna i produktformuläret. Fälten för diagnoser och förbehåll visas bara när de gäller.

## Val och avvägningar
- **Grupper med fält för frågor och regler** men rader för åldrar och raser. Frågorna har text på flera språk och reglerna har fält som beror på varandra, vilket blir svårläst på en rad.
- **Egna meddelandenycklar `uwform.*`.** `uw.refer` och `uw.decline` var redan utfallen i ansökningsvyn.
- **Testet kör motorns egen kontroll** på det formuläret ger tillbaka.

## Filer
- `apps/backoffice/src/underwriting-form.ts`, `components/content-forms.ts`, `components/versions-panel.ts`, `views/labels.ts`, `locales/sv.ts`
- `apps/backoffice/test/underwriting-form.test.ts`, `e2e/catalog.spec.ts`
