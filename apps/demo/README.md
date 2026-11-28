# Petvold Demo

Tjänsten som spelar försäkringsbolagets andra system i demon: den tar emot Petvolds händelser som webhooks, kontrollerar signaturen och visar dem. Den körs aldrig i drift. Specen och läget finns i [Demotjänsten](../../docs/teknik/demotjanst.md).

```
npm run dev:up                    # Postgres
npm run dev                       # Petvold på :8787
npm run dev -w @petvold/demo      # demotjänsten på :8790
```

Tjänsten använder bara Petvolds publika kontrakt: API:t och webhooks. Den har en egen databas, `petvold_demo`, och importerar ingen kod från Petvolds moduler. Typerna genereras från `modules/api/openapi.yaml` med `npm run types -w @petvold/demo`.

| Fil | Gör |
| --- | --- |
| `src/subscription.ts` | Hittar, skapar eller byter hemlighet på prenumerationen |
| `src/signature.ts` | Kontrollerar signaturen enligt Standard Webhooks |
| `src/app.ts` | Mottagaren på `/webhooks/petvold` och sidorna |
| `src/store.ts`, `src/postgres.ts` | Lagringen i minnet och i Postgres |
| `src/views.ts`, `src/texts-sv.ts` | Sidorna och deras svenska texter |
