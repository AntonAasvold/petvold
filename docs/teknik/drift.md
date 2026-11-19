# Drift

Så körs Petvold i en installation (ADR 0010). En installation per försäkringsbolag, med en Postgres och en tjänsteroll per modul.

## Starta

```
npm start            # node --import tsx modules/api/src/server.ts
```

`server.ts` kopplar ihop alla moduler med kompositionsroten (`composition.ts`). Den lägger inte in exempeldata, och den läser aldrig `.env`. All konfiguration kommer från miljön.

## Konfiguration

| Variabel | Krävs | Betyder |
| --- | --- | --- |
| `CLAIMS_DATABASE_URL`, `ACCESS_DATABASE_URL`, `DECISIONING_DATABASE_URL`, `CATALOG_DATABASE_URL`, `ANIMALS_DATABASE_URL`, `PARTIES_DATABASE_URL`, `POLICIES_DATABASE_URL`, `COMMUNICATIONS_DATABASE_URL`, `WEBHOOKS_DATABASE_URL`, `SCHEDULING_DATABASE_URL` | Ja, alla | En databasadress per modul, med modulens egen tjänsteroll (ADR 0001) |
| `PETVOLD_VERSION` | Ja | Versionen som sparas med varje beslut (ADR 0018) |
| `PETVOLD_CLAIM_NUMBER_PREFIX` | Nej | Skadenumrets prefix per marknad, till exempel `SE=S,NO=N` (ADR 0036). Förval `S`. Ett prefix är versaler och siffror, högst åtta tecken. Ett felaktigt värde stoppar starten. |
| `PETVOLD_AUTH_ISSUER` | Ja | Utfärdaren av tokens, till exempel bolagets identitetstjänst |
| `PETVOLD_AUTH_AUDIENCE` | Ja | Petvolds `aud` i tokens |
| `PETVOLD_AUTH_JWKS_URL` | Om utfärdaren saknar OpenID-konfiguration | Var de publika nycklarna finns. Annars läses de från `{issuer}/.well-known/openid-configuration`. |
| `PETVOLD_AUTH_ALGORITHMS` | Nej | Tillåtna algoritmer, förval `RS256,ES256`. Bara asymmetriska algoritmer godtas. |
| `PETVOLD_AUTH_ROLES_CLAIM`, `PETVOLD_AUTH_MARKETS_CLAIM`, `PETVOLD_AUTH_CLINIC_CLAIM`, `PETVOLD_AUTH_POLICIES_CLAIM` | Nej | Var i token roller, marknader, klinik och försäkringar finns. Förval `roles`, `petvold_markets`, `petvold_clinic_id` och `petvold_policy_ids`. |
| `PETVOLD_WEBHOOK_KEY` | Ja | 32 slumpade byte i base64, till exempel från `openssl rand -base64 32`. Krypterar hemligheterna för webhooks (ADR 0033). Förvara den som en hemlighet. Om den byts kan sparade hemligheter inte läsas, och varje prenumeration behöver en ny hemlighet. |
| `PETVOLD_WEBHOOK_ALLOW_HOSTS` | Nej | Värdar som en webhook får peka på fast de är lokala eller använder `http`, kommaseparerat. Förval inga. |
| `PORT` | Nej | Förval 8080 |
| `PETVOLD_CORS_ORIGINS` | Om ett gränssnitt i webbläsaren anropar API:t från en annan adress | Tillåtna ursprung, kommaseparerat, till exempel `https://portal.bolaget.se`. Varje värde måste vara ett exakt ursprung. `*` godtas inte. Förval inga. |

Om något som krävs saknas stoppar servern direkt med en lista.

## Inloggning

Petvold lagrar inga användare (ADR 0016). Varje anrop har en access token (JWT, RFC 9068) från bolagets identitetstjänst. Den kontrolleras mot:
- utfärdarens publika nycklar (JWKS), som hämtas och cachas
- `iss`, `aud` och `exp`, med 30 sekunders marginal för klockskillnad
- en tillåten algoritm. Symmetriska algoritmer och `none` godtas aldrig (RFC 8725).

Ur token läses `sub` (vem), roller, marknader (en lista eller `*`), och för roller som är bundna, kliniken eller försäkringarna. Rollerna översätts till rättigheter med installationens rollinställning (ADR 0020). En ogiltig token ger `401`.

**Exempel på token från en handläggare:**

```json
{ "iss": "https://login.bolaget.se/", "aud": "petvold", "sub": "anna.handlaggare",
  "roles": ["handler"], "petvold_markets": ["SE"], "exp": 1794700000 }
```

## Databasen

- **Migreringar** körs före start med dbmate, som ägarrollen (`npm run db:migrate` eller motsvarande i installationen). Tjänsterollerna kan inte ändra schemat.
- **Tjänsteroller** skapas av installationen, till exempel med CloudNativePG `spec.managed.roles`. Lokalt skapas de av `db/init/`. Rollen måste finnas innan migreringen som ger den rättigheter körs. Migration 0031 kräver till exempel `communications_service`.
- **Efter en återställning** från säkerhetskopia körs `npm run erasures:reapply` innan servern startar (ADR 0028).
- **Efter en uppgradering** visar `npm run roles:sync` nya standardroller, och `-- --apply` sparar dem (ADR 0020).

## Händelser

Varje modul skriver sina händelser i en egen outbox i samma transaktion som ändringen (ADR 0008). Reläet (`relay.ts`) körs i servern varje sekund:
- **Ordning och leverans.** Händelser levereras i ordning per outbox. En händelse markeras som publicerad först när den har levererats, så leveransen sker minst en gång. Mottagarna tål upprepning.
- **Omförsök.** En händelse som inte går att leverera försöker igen med växande paus: 1, 2, 4 sekunder och så vidare, upp till 5 minuter. Under tiden väntar resten av samma outbox.
- **Död kö.** Efter 10 försök blir händelsen en **död bokstav**. Den loggas och ligger kvar opublicerad i outboxen, men hoppas över så att resten kan flöda. `/healthz` visar antalet.
- **Mottagare i dag:** djurregistrets händelser blir förslag i policymodulen, policymodulens ersatta versioner ger omprövning i skademotorn, och skademotorns händelser loggas.

Om flera instanser av servern körs, kör var och en sitt eget relä. Leveransen sker ändå minst en gång, men samma händelse kan levereras av två instanser samtidigt. Ett relä med lås per outbox, till exempel med pg-boss, är en öppen punkt.

## Hälsa och avstängning

- **`GET /healthz`** finns utanför kontraktet och kräver ingen inloggning:
  - `200` med `{"status":"ok"}` när alla databaser svarar
  - `{"status":"degraded"}` när det finns döda bokstäver
  - `503` när en databas inte svarar
- **SIGTERM och SIGINT:** servern slutar ta emot anrop, stoppar reläet efter pågående runda och stänger databasanslutningarna.

## Schemalagda körningar

Dessa anropas av installationens schemaläggare med en token för respektive roll:

| Körning | Anrop | Roll | Förslag |
| --- | --- | --- | --- |
| Förnyelse | `POST /v1/renewal-runs` | `renewal-job` | Varje dag |
| Överlåtelser som löpt ut | `POST /v1/policy-proposal-expiry-runs` | `renewal-job` | Varje dag |
| Gallring | `POST /v1/retention-runs` | `retention-job` | Varje vecka |
