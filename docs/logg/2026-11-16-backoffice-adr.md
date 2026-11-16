# ADR om ett gränssnitt för back office (PR #79)

**Datum:** 2026-11-16 **ADR:** 0035 (Föreslagen) **Moduler:** inga, bara dokumentation

## Vad
Ett förslag om ett gränssnitt för handläggare och back office: Lit och Web Awesome med Vite och TypeScript, under `apps/backoffice` i samma repo.

## Val och avvägningar
- **Användare, repo, teknik och omfång** valdes av Anton: back office, samma repo, Lit och Web Awesome i stället för React, och alla fyra flöden.
- **Bara Web Awesomes kärna.** Datatabellen, datumväljaren, comboboxen och diagrammen finns bara i Pro. Utan dem behöver ingen installation en licens. Tabeller och datum byggs med vanliga element.
- **Licenser och versioner** är kontrollerade med `npm view` och på webawesome.com:
  - Web Awesome 3.14 har MIT-licens, beror på Lit 3 och har en svensk översättning.
  - Lit, `@lit/localize` och `@lit/context` har BSD-3-Clause.
  - openapi-typescript och openapi-fetch har MIT.
  - oidc-client-ts och Playwright har Apache-2.0.

## Att känna till
- Byggets versioner låses när steg 1 byggs, på versioner som är minst två veckor gamla.

## Filer
- `docs/adr/0035-granssnitt-for-back-office.md`, `docs/adr/README.md`, `docs/roadmap.md`, `docs/status.md`
