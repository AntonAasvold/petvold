# Testdata för demon (PR #142)

**Datum:** 2026-11-22 **ADR:** 0041 **Moduler:** `api`

## Vad
`npm run demo:seed` fyller en ny installation med sex månaders kunder, hundar, policyer, skador, fakturor och inbetalningar, genom API:t och med en klocka som går.

## Hur det fungerar
1. `modules/api/scripts/demo-seed.ts` läser konfigurationen som `server.ts` gör och anropar `compose` med en `DemoClock` och `demoIds(seed)`. Den stoppar om installationen redan har produkter.
2. `runDemo` (`modules/api/src/demo-data.ts`) gör det som en ny installation behöver: `seedInstallation` (regler, referensdata och produkter), bolagets texter via `POST /v1/settings/notices/versions` och `documentMaker: petvold` när Gotenberg finns.
3. Därefter för varje dag:
   - klockan sätts till 04:30 UTC, och `scheduler.tick()` kör nattens körningar
   - kunder, hundar, policyer, ansökningar, skador, beslut, attester, ändringar och avslut görs med `app.request` och demotoken, en minut isär
   - reläet töms
   - fakturorna läses med `GET /v1/invoices`, och låtsasbanken skickar dagens inbetalningar signerade till `POST /provider-notifications/fake`
4. Sist läggs dev-serverns exempeldata in (`seedSampleData`), och programmet skriver en sammanfattning och antalet döda poster.

## Val och avvägningar
- **Genom API:t, inte lagringen.** Allt får sitt underlag och sina händelser, och programmet prövar kedjan från tecknande till inbetalning varje dag i sex månader.
- **Fröade id:n.** `compose` tar nu ett eget `ids`. Utan det sorterades fakturor som gjorts i samma ögonblick efter slumpade id:n, och samma frö gav olika inbetalningar. Nu ger samma frö samma data, id:n och fakturanummer, och ett test prövar det.
- **Banken bestämmer per faktura** när den ser fakturan första gången: 85 procent betalas mellan fakturadagen och förfallodagen, 10 procent 3–20 dagar för sent och 5 procent aldrig.
- **Bolagets texter ligger i JSON** (`modules/api/seed/demo-notice-texts.json`), eftersom de är på svenska. Filen står bland undantagen i `scripts/check-language.ts`, som exempelprodukterna.
- **`dev-all` har nu `billing-clerk`**, och den nya token `dev-billing` har bara den rollen. Programmet läser fakturorna som den.
- **Bara hundar i Sverige**, eftersom exempelprodukterna bara gäller hundar där. Katterna och andra marknader kommer när det finns produkter för dem.

## Att känna till
- Utan `PETVOLD_GOTENBERG_URL` görs inga PDF:er, men meddelandena görs ändå.
- Händelserna går till webhooks bara om någon prenumererar innan programmet körs. Demotjänsten behöver alltså vara igång och prenumerera först, och den behöver godta signaturer med demons klocka, som ligger bakåt i tiden. Det löses i demotjänstens fas 1.
- Inga förnyelser syns på sex månader, eftersom terminerna är ett år. Med `--months 13` kommer de.

## Filer
- `modules/api/src/demo-data.ts` och `modules/api/scripts/demo-seed.ts`
- `modules/api/src/seed.ts`: `seedInstallation` utbruten ur `seedSampleData`
- `modules/api/src/composition.ts`: `ids`
- `modules/api/test/demo-data.test.ts`
- `docs/teknik/demo.md`
