# Demoläget för inloggningen (PR #141)

**Datum:** 2026-11-22 **ADR:** 0041 **Moduler:** `api`

## Vad
Servern för drift kan starta med dev-serverns fasta token i stället för bolagets identitetstjänst, med `PETVOLD_AUTH=demo`.

## Hur det fungerar
- **Tokenen** ligger nu i `modules/api/src/demo-tokens.ts` (`DEMO_TOKENS` och `demoAuthenticator`). Dev-servern och `server.ts` läser samma fil.
- **`server.ts`** läser `PETVOLD_AUTH`:
  - `jwt` (förval) eller inget gör som förut.
  - `demo` hoppar över `authenticatorFromEnv`, skriver en varning i loggen, lägger till `"auth": "demo"` i `/healthz` och serverar API-sidan på `/docs`.
  - Allt annat stoppar starten.

## Val och avvägningar
- **Demoläget måste begäras med namn.** Ett saknat `PETVOLD_AUTH_ISSUER` ger fortfarande ett fel, så en installation kan inte hamna i demoläget av misstag.
- **Samma token som dev-servern**, så att back office byggd utan OIDC kan logga in i demon utan ändringar.
- **API-sidan bara i demoläget.** Hos ett bolag får API-sidan sitt eget beslut, eftersom den visar tokenfältet.

## Att känna till
- **Ett fel rättades på vägen:** uppslaget `DEV_TOKENS[t]` hittade `Object.prototype` för token som `constructor`, och gav då tillbaka en funktion som inloggad. Det gällde bara dev-servern, men nu även demon. Uppslaget kontrollerar nu egna nycklar med `Object.hasOwn`, och ett test prövar det.
- Tokenen `dev-customer` är bunden till `pol_bella`. Testdatan för demon (nästa steg) avgör vilka policyer kundtoken ska se.

## Filer
- `modules/api/src/demo-tokens.ts`, `server.ts` och `dev-server.ts`
- `modules/api/test/demo-tokens.test.ts`
