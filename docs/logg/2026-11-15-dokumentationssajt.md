# Dokumentationen och API-specen på GitHub Pages (PR #36)

**Datum:** 2026-11-15 **ADR:** – **Moduler:** `scripts`, CI

## Vad

Allt i `docs/`, README och API-kontraktet publiceras som en webbplats på https://antonaasvold.github.io/petvold/ efter varje merge till `main`.

## Hur det fungerar

1. `npm run site` kör `scripts/build-site.ts`.
2. Skriptet läser README och alla `.md` under `docs/`. Varje fil blir en HTML-sida på samma sökväg (`docs/adr/0025-….md` → `docs/adr/0025-….html`), och README blir `index.html`. Titeln är filens första rubrik.
3. Markdown görs om med `marked` (GFM, så tabeller fungerar). Rubrikerna får id som på GitHub, så länkar som `#anrop` fungerar.
4. Länkar skrivs om i `walkTokens`. En länk till en annan `.md` blir en relativ länk till sidan, och en länk till en mapp går till mappens README. Övriga länkar, till exempel till kod, går till filen på GitHub.
5. Menyn har README, sidorna direkt i `docs/`, API-sidan och en grupp per mapp med mappens README-rubrik som namn.
6. `api/index.html` görs med samma `docsPage` som dev-serverns `/docs`, men utan förifylld token, och `openapi.yaml` kopieras bredvid.
7. Till sist kontrolleras att varje relativ länk pekar på en fil i `_site/`. Annars avbryts bygget.

Arbetsflödet `.github/workflows/pages.yml` bygger sajten och publicerar den med `actions/deploy-pages`. CI kör också `npm run site`, så en trasig länk stoppar PR:en.

## Val och avvägningar

- **GitHub Pages** eftersom repot redan är publikt, och sajten uppdateras av sig själv.
- **Ett eget litet skript i stället för en sajtgenerator** som VitePress eller MkDocs. Det behövs bara ett nytt beroende (`marked`, låst till en version), och Markdown-filerna behöver ingen extra konfiguration.
- **Inga svenska ord i skriptet.** Menyns namn kommer från rubrikerna i dokumenten, så `lint:lang` behöver inget undantag.
- **Scalar laddas från ett CDN** på API-sidan. Det är samma avvägning som för dev-servern: sajten är dokumentation, inte en kunds driftmiljö.

## Att känna till

- `_site/` checkas inte in.
- En länk till kod pekar på `main`, inte på den version sidan byggdes från.
- Bilder i dokumenten skulle länkas till GitHub. Det finns inga ännu.

## Filer

- `scripts/build-site.ts`
- `.github/workflows/pages.yml`, `.github/workflows/ci.yml`
