# 0035. Ett gränssnitt för handläggare och back office

- Status: Föreslagen
- Datum: 2026-11-16

## Sammanhang

Petvold är headless (ADR 0002). Allt sker via API:t, och bolaget bygger sina egna gränssnitt. Men för att visa, prova och sälja Petvold behövs ett gränssnitt. Det behövs också för att ett bolag ska komma igång innan det har byggt sitt eget. API:t är nu stabilt nog:
- adresserna följer konventionerna (ADR 0034)
- `GET /v1/me` säger vad anroparen får göra
- listorna har sidindelning
- CORS är byggt
- exempeldatan fyller varje kö

Användarna är handläggare och back office:
- skadehandläggare och attestanter
- de som prövar ansökningar
- kundservice
- den som tar hand om meddelanden och webhooks som fastnat
- de som underhåller produkter, regler, roller och bolagets texter

En kundportal är ett senare beslut. Den kräver inloggning för kunder och fler överväganden om integritet.

## Beslut

1. **En app för back office i samma repo**, `apps/backoffice`, som ett eget paket i workspacen.
   - Den bygger statiska filer som bolaget lägger på valfri webbserver, i samma installation som Petvold (ADR 0010).
   - Appen pratar bara med API:t och har ingen egen server.

2. **Lit och Web Awesome, med Vite och TypeScript.**
   - Lit 3 för komponenterna och Web Awesome 3 för färdiga komponenter och tema. Web Awesome är byggt på Lit, så det blir en sorts komponenter.
   - **Bara kärnan i Web Awesome**, som har MIT-licens. Det som bara finns i Pro används inte: datatabellen, datumväljaren, comboboxen och diagrammen. Ett bolag behöver då ingen licens för att köra appen.
   - Tabeller byggs med vanlig `<table>` och Web Awesomes stilar. Sidindelningen sker i API:t med `cursor`.
   - Datum skrivs med `<wa-input type="date">`.

3. **Kontraktet styr typerna.**
   - Typerna genereras från `openapi.yaml` med openapi-typescript, och anropen görs med openapi-fetch. En adress eller ett fält som inte finns i kontraktet ger alltså fel vid typkontrollen.
   - CI genererar typerna och stoppar om de skiljer sig från de incheckade, och typkontrollerar appen.
   - Händelserna i `asyncapi.yaml` används inte av appen.

4. **Inloggning med OIDC**, authorization code med PKCE, mot bolagets identitetstjänst. Det är samma utfärdare som API:t litar på (drift.md).
   - Biblioteket är oidc-client-ts.
   - Access token finns bara i minnet och skickas som `Bearer`. Inget sparas i `localStorage`.
   - Lokalt väljer man en av dev-serverns tokens på en inloggningssida som bara finns i utvecklingsläget.

5. **API:t avgör behörigheten.** Appen läser `GET /v1/me` och visar bara menyer och knappar som anroparen har rätt till. Varje anrop prövas ändå av API:t. Ett `403` eller `404` visas som ett vanligt besked, aldrig som ett fel i appen.

6. **Svenska och engelska.**
   - Appens texter översätts med `@lit/localize`, och Web Awesomes egna texter med dess svenska översättning.
   - Datum och belopp formateras med `Intl` efter marknaden.
   - Skälkoder och förklaringar kommer redan översatta från API:t med `Accept-Language`.

7. **Personuppgifter.**
   - Personnummer visas maskade, som API:t ger dem.
   - Sökning på personnummer går genom `POST /v1/parties/searches`, så numret aldrig hamnar i en adress.
   - Inget sparas i webbläsaren utöver sessionen.
   - Utloggning rensar allt.

8. **Tillgänglighet:** WCAG 2.1 nivå AA som mål. Det gäller särskilt tangentbordet i köerna, där handläggare arbetar länge.

9. **Test:**
   - Logik utan gränssnitt, som formatering, rättigheter och sidindelning, testas med `node:test` som resten av Petvold.
   - Flödena testas med Playwright mot dev-servern i CI: logga in, öppna en kö, besluta och attestera.

10. **Rent ursprung (ADR 0009).** Formgivningen är egen, med Web Awesomes standardtema. Den ska inte likna något försäkringsbolags eller arbetsgivares system.

11. **Ordning:**
    1. **Grunden:** appen, inloggningen, `me`, navigeringen, språk och genererade typer, och skadornas köer och ett ärende med bedömning och förklaring, bara läsning.
    2. **Skador:** beslut, beslut mot förslaget, attest och prövning.
    3. **Policyer och ansökningar:** sökning, policy med historik, kön för manuell prövning och förslag om överlåtelse.
    4. **Meddelanden och webhooks:** kön för meddelanden, döda händelser och att skicka igen.
    5. **Inställningar:** roller och gränser, produkter och regler med fyra ögon, och bolagets texter.

## Konsekvenser

- **Petvold går att visa och använda direkt.** Bolaget kan börja med appen och byta ut den, eller bygga sin egen med API:t.
- **API:t får en första riktig konsument.** Brister i kontraktet syns tidigt, till exempel en lista som saknar ett filter.
- **En byggkedja till:** Vite, Playwright och en webbläsare i CI. Beroendena låses på versioner som är minst två veckor gamla.
- **Web Awesomes Pro används inte.** Det kostar några egna komponenter för tabeller och datum. I gengäld behöver ingen installation en licens.
- **Appen följer kontraktet.** En brytande ändring i `/v1` syns som ett typfel i appen.

## Alternativ

- **React med ett komponentbibliotek för React.** Det har störst ekosystem, men det blir ett ramverk ovanpå webbkomponenterna. Lit och Web Awesome bygger på webbstandarder och är mindre.
- **Web Awesome Pro med datatabell och datumväljare.** Det går snabbare att bygga, men varje installation skulle behöva en licens.
- **Eget repo.** Det ger en tydligare gräns, men kontraktet måste publiceras och följas mellan repona, och en ändring i API:t kan inte göras i samma PR som i appen.
- **Serverrenderat, till exempel med htmx.** Det är enklare att leverera, men svårare att hålla typerna i synk med kontraktet, och sämre för täta arbetsytor.
- **En kundportal först.** Den kräver inloggning för kunder, samtycken och fler integritetsbeslut innan något kan visas.

## Källor

- Lit: lit.dev (BSD-3-Clause), version 3.3
- Web Awesome: webawesome.com, `@awesome.me/webawesome` 3.14 (MIT). Pro-komponenterna enligt webawesome.com/pro. Svensk översättning i `dist/translations/sv.js`.
- openapi-typescript och openapi-fetch (MIT), oidc-client-ts (Apache-2.0), Playwright (Apache-2.0), Vite (MIT)
- OAuth 2.0 för webbläsarbaserade appar (IETF draft-ietf-oauth-browser-based-apps): authorization code med PKCE, och inga tokens i `localStorage`
- WCAG 2.1
- ADR 0002, 0009, 0010, 0016, 0034
