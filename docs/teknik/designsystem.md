# Designsystemet Petvold

Svartvitt, med ramar i stället för skuggor. Designsystemet gäller back office och de gränssnitt som byggs mot Petvold. Varje skärm ska göra det tydligt vad som är sant, vad som väntar och vad som händer när man trycker på knappen.

Systemet finns också som en bläddringsbar referens med förhandsvisningar: [Petvold på claude.ai](https://claude.ai/artifact/Ffvnwb6avL6cZkw9J2zwx9). Filerna i repot är källan för koden.

## Filer

| Fil | Vad |
| --- | --- |
| `design/tokens.json` | Källan: färger i ljust och mörkt tema, typsnitt och textstilar, avstånd, hörnradier, kontrollhöjder och linjer |
| `apps/backoffice/src/styles/petvold-tokens.css` | Tokens som CSS-variabler (`--ink`, `--space-6`, `--radius-md` …) och textklasser (`.pv-text-heading-3` …). Genereras från `tokens.json`, ändras inte för hand. |
| `apps/backoffice/src/styles/petvold-theme.css` | Temat för Web Awesome: kopplar `--wa-*` till Petvolds tokens. Klassen `wa-theme-petvold` på `<html>` slår på det. |
| `design/components.css` | Komponenterna som vanlig HTML med klasser som börjar på `pv-`: uppmärkning och värden. |

## Principer

1. **Svartvitt först.** `--ink` på `--paper`, med gråsteg för hierarki. Tillstånd visas med fyllning och linjetyp, aldrig med färg: helfylld betyder verklig eller klar, streckad betyder väntar eller simulerad.
2. **Underlaget bredvid beslutet.** Beräkningen står intill knappen som beror på den. Kortet där användaren gör något får `--border-strong`, allt annat en tunn linje på 1 px.
3. **Säg vad som händer.** Knappar har verb och objekt, med beloppet när pengar flyttas: "Godkänn utbetalning · 12 165 kr", "Genomför ändringen".
4. **Visa systemet.** En logg visar anropen och händelserna bakom varje åtgärd, så att handläggare och utvecklare ser samma sak.
5. **Siffror som går att kontrollera.** Siffror med samma bredd, högerställda belopp, ISO-datum och varje avdrag förklarat med sin regel.

## Text

- Versal bara först i meningen: "Väntar på beslut", inte "Väntar På Beslut".
- Svenska och engelska är lika viktiga. Gränssnittet följer användarens språkval, och en skärm blandar inte språk.
- Belopp: `7 093 kr` på svenska, `SEK 12,165.00` på engelska. Ange alltid vad beloppet gäller: "per år", "320 dagar".
- Datum i ISO-format, `2026-03-01`, med monospace. Tider `2026-11-13 14:32`, kort `11-13 14:32` i loggar.
- Id (`PM-100482-01`, `clm_048213`, `ORT-KORSBAND-V`) i monospace, gärna med klartext bredvid.
- När en regel skickar något till en person, säg vilken regel.
- Inga utropstecken och inga emoji.

## Grunder

**Färg.** `--ink` och `--paper` gör jobbet. `--text-secondary` för stödtext och `--text-muted` för metadata. `--line` delar rader, `--line-control` är ramen kring kontroller som inte är valda och `--surface-muted` är tysta ytor och valda lägen. Omvända ytor (toppraden, loggar och den viktigaste siffran) använder `--panel-inverse` med `--on-inverse`. Alla tokens har ett mörkt tema.

**Typsnitt.** Space Grotesk (`--font-display`) i rubriker och viktiga siffror, Inter (`--font-sans`) i all brödtext och IBM Plex Mono (`--font-mono`) för id, datum, API-anrop och överrubriker. Skala: `display` 48, `heading-1` 36, `heading-2` 28, `heading-3` 20, `figure` 30, `body` 15, `small` och `label` 13, `overline` 12 med versaler och 0,12em spärrning.

**Avstånd.** Steg om 4 px: `--space-1` (4) till `--space-16` (64). Kort har `--space-6` inuti, sidor `--space-8` i kanten, och kolumner och kort `--space-6` emellan.

**Form.** `--radius-md` (4 px) på knappar, fält, kort och menyval, `--radius-sm` (3 px) på märken och `--radius-full` på stegpunkter och antal. `--radius-lg` (10 px) är ett alternativ för kundens skärmar: byt överallt eller inte alls.

**Linjer, inte skuggor.** Kort har en tunn svart ram. Inga skuggor och inga övertoningar. Det enda mönstret är den diagonala skrafferingen för avdrag i beräkningen.

**Layout.** Sidor är flytande: meny (220–300 px), innehåll (`flex: 999 1 560px`) och en valfri högerspalt (340–420 px) för beslut eller logg. Allt bryts under ungefär 900 px. Kontroller är minst 44 px höga.

## Komponenter

Komponenterna beskrivs med klasserna i `design/components.css`. I back office byggs de med Web Awesome och Lit, och tabellen säger vad som motsvarar vad.

Lit-komponenter har shadow DOM, så globala klasser når inte in av sig själva. Det finns tre sätt att styla dem, enligt [Lits dokumentation om stilar](https://lit.dev/docs/components/styles/):

- **CSS-variabler ärvs in.** Därför räcker temat för Web Awesome och för våra egna komponenter som använder `--wa-*` eller Petvolds variabler.
- **Delade stilar i `static styles`.** En egen komponent tar in `pvComponents` från `apps/backoffice/src/styles/pv-components.ts`. Det är `design/components.css`, inläst som text vid bygget, så att filen är den enda källan. `app-shell.ts` gör det för toppraden och menyn.
- **`::part()` och `:host`** för att styla en komponents delar utifrån, när komponenten exponerar dem.

| Komponent | Används till | I back office |
| --- | --- | --- |
| Button | Primär, sekundär och textknapp | `wa-button variant="brand"` (primär), `appearance="outlined"` (sekundär), `appearance="plain"` (text) |
| Badge | Tillstånd (helfylld eller streckad), tjänst, roll och id | `wa-badge`; streckad ram med egen CSS |
| Field | Fält och listor med etikett | `wa-input`, `wa-select`, `wa-textarea` med `label` |
| ChoiceCard | Val med en rad om vad som händer | `wa-radio-group` med `wa-radio` och en beskrivning |
| Card | Grundbehållaren; `--strong` för kortet där man gör något | `wa-card` eller en `section` med ram i `--ink` |
| Note | Sammanhang före en åtgärd | `wa-callout variant="neutral"` |
| DataList | Etikett och värde | `<dl>` i komponentens CSS |
| Figure | Viktiga belopp, före och efter | Egen CSS med `.pv-text-figure` |
| Waterfall | Ett belopp uppdelat i avdrag | Egen komponent, se `design/components.css` |
| StepList | Steg i ett flöde: klara, aktuellt och kommande | Egen komponent |
| SideNav | Back office-menyn med antal i kön | Menyn i `app-shell.ts`, med `pv-nav`-klasserna |
| TopBar | Namn, flikar, sök och konto | Toppraden i `app-shell.ts`, med `pv-topbar`-klasserna |
| EventLog | Anrop och historik, nyast först | Egen komponent på `--panel-inverse` |

Regler för knappar och märken:

- **Knappar** har verb och objekt. Den primära knappen finns en gång per område. En inaktiv knapp säger varför, till exempel "Välj ett skäl för att avslå".
- **Helfyllt märke** betyder verklig tjänst eller klart beslut. **Streckat** betyder väntar på någon. **Streckat grått** betyder simulerat eller externt.

## Typsnitt

Inter, Space Grotesk och IBM Plex Mono kommer från npm (`@fontsource/*`, licens SIL Open Font License 1.1) och byggs in i appen, så att inget hämtas från ett CDN. Bara vikterna som används laddas: Inter 400–700, Space Grotesk 500 och 700, IBM Plex Mono 400 och 500.

## Ikoner

Font Awesome Free via `wa-icon`, som i resten av back office. 18 px i menyer och 16 px i text. Dekorativa ikoner döljs för skärmläsare, och knappar med bara en ikon får en `label`.

## Tillgänglighet

- Text har kontrast 4,5:1 i båda temana, också `--text-muted` på `--surface-muted`.
- Fokus: 2 px `--focus` med 2 px avstånd på allt som går att klicka på.
- Riktiga element: `<button>`, `<a href>`, etiketter på fält, `<fieldset>` med `<legend>` för val och `<dl>` för etikett och värde.
- Inget hänger på färg, eftersom systemet inte har någon.

## Så används det

1. `apps/backoffice/src/main.ts` laddar stilarna i den här ordningen: Web Awesomes `webawesome.css`, typsnitten, `styles/petvold-tokens.css` och `styles/petvold-theme.css`.
2. `<html>` i `apps/backoffice/index.html` har `class="wa-theme-petvold"`. Lägg till `wa-dark` för det mörka temat.
3. Använd Web Awesomes variabler (`--wa-space-m`, `--wa-color-text-quiet` …) i komponenterna som i dag. Använd Petvolds variabler direkt när Web Awesome saknar en motsvarighet, till exempel `--panel-inverse` eller `--line-control`.
4. Skriv aldrig färger eller storlekar som har en token som fasta värden.
5. Ändra en token i `design/tokens.json` och i designsystemet på claude.ai, och generera sedan `petvold-tokens.css` på nytt.

*Inte byggt än:*

- Inget skript genererar `petvold-tokens.css` från `tokens.json` än.
- Waterfall, StepList, Figure och EventLog finns inte som Lit-komponenter.
