# Inför ett gränssnitt: vem är jag, CORS och exempeldata (PR #63)

**Datum:** 2026-11-15 **ADR:** 0016, 0020 **Moduler:** api

## Vad
Ett gränssnitt i webbläsaren kan nu fråga vem som är inloggad och vad den får göra (`GET /v1/me`) och anropa API:t från en annan adress (CORS). Exempeldatan har ärenden i varje arbetskö och fler hushåll. `AGENTS.md` ger Cursor och andra agenter reglerna och hur man bygger mot API:t.

## Hur det fungerar
- **`GET /v1/me`.** Kontraktet har `x-permission: signed-in`. `SIGNED_IN` och `isOperationPermission` i `permissions.ts` gör markören giltig i kontraktet, men den finns inte i `PERMISSIONS`, så ingen roll kan få den. Middleware i `app.ts` släpper igenom alla inloggade till operationen och räknar ut omfånget som vanligt. Handlern bygger svaret med `permissionsOf`, omfånget och `amountLimitsOf`.
- **CORS.** `createApp` tar `corsOrigins`. När listan inte är tom läggs `hono/cors` först, före inloggningen, så att en preflight (`OPTIONS`) besvaras utan token. Bara ett ursprung i listan får `Access-Control-Allow-Origin`. `corsOriginsFromEnv` läser `PETVOLD_CORS_ORIGINS` och avvisar `*` och värden med sökväg. `server.ts` har inga ursprung som förval, och `dev-server.ts` har `localhost:5173` och `localhost:3000`.
- **Exempeldata.** `seedClaims` registrerar Bellas fyra skador genom skademotorns tjänst. Den ena får en begäran om prövning, och den stora beslutas med handläggarens gräns så att den blir ett förslag. `seedHouseholds` lägger in parter och djur med fasta id och tecknar policyerna med `PolicyService.issue`, så att tariffen prissätter dem och Ludde får grupprabatt i hushållsgruppen.

## Val och avvägningar
- **En markör i stället för en rättighet som alla roller har.** En rättighet `me:read` skulle behöva läggas i varje roll, även i en installations egna roller, och en roll utan den skulle ge ett gränssnitt som inte vet vad det får visa. Markören är begränsad till en operation, och ett test stoppar den på andra.
- **Omfånget kontrolleras även för `/v1/me`.** En klinikroll utan klinik-id i token får `403` här också, så felet syns tidigt.
- **Policyerna tecknas genom tjänsten och inte direkt i lagret,** som Bellas gör. Då syns prissättningen, men id:n blir slumpade och startdatum blir dagen för första start.
- **Ursprung räknas upp.** Ingen jokertecken, eftersom API:t används med en bearer-token och varje webbapp ska vara känd.

## Att känna till
- En befintlig lokal databas får de nya delarna vid nästa start. Bellas skador läggs bara in om deras id saknas.
- Om ett ärende i exempeldatan ändras för hand, till exempel om förslaget attesteras, ligger det kvar så vid omstart.
- Städer i exempeldatan skrivs utan å, ä och ö i koden (`Gothenburg`, `Malmo`), eftersom `lint:lang` gäller där.

## Filer
- `modules/api/src/app.ts` (`/v1/me`, CORS, `corsOriginsFromEnv`)
- `modules/api/src/permissions.ts` (`SIGNED_IN`, `isOperationPermission`)
- `modules/api/src/seed.ts`
- `modules/api/test/api.test.ts`, `modules/api/test/composition.test.ts`
- `AGENTS.md`
