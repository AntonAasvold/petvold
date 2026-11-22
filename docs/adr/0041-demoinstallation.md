# 0041. Demon: en installation på en egen server, med demoanvändare och testdata

- Status: Beslutad
- Datum: 2026-11-22

## Sammanhang

Petvold går att köra lokalt med `npm run dev`. Exempeldatan är tunn: Bella, Doris, ett hushåll i Malmö och några ansökningar. Det finns inget sätt att visa Petvold för någon utan att de klonar repot.

Vi vill ha en demo som:
- går att nå med en adress, med back office, API:t och API-sidan
- har så mycket data att flödena syns: kunder med flera djur, policyer som förnyats, ändrats och avslutats, skador i alla köer, fakturor, kreditnotor och meddelanden
- visar händelserna i demotjänsten (specen *Petvold Demo*), som tar emot dem, spelar bank och kontrollerar att allt stämmer
- kan återställas till samma läge när någon har ändrat i den

Servern för drift (`server.ts`) kräver bolagets identitetstjänst, Postgres med en roll per modul, Gotenberg och en S3-lagring (ADR 0010, 0016 och 0038). Dev-servern har fasta token men kör i minnet eller mot lokala containrar och lägger in exempeldata vid varje start.

## Beslut

### 1. En egen server med Docker Compose

Demon körs på en virtuell server (VPS) med Docker Compose, beslutad 2026-11-22. Samma tjänster som i `compose.yaml` lokalt, plus Petvold själv:

| Tjänst | Vad |
| --- | --- |
| `caddy` | HTTPS med certifikat från Let's Encrypt, inloggning för hela demon och vidarekoppling |
| `petvold` | API:t (`server.ts`), reläet, webhooks och körningarna |
| `web` | Back office som statiska filer |
| `migrate` | Kör migreringarna med dbmate och avslutar. `petvold` startar först när den är klar. |
| `postgres` | En databas med en roll per modul, som lokalt |
| `gotenberg` | PDF, utan nätåtkomst för Chromium |
| `seaweedfs` | S3 för dokumentarkivet |
| `demo` | Demotjänsten (`apps/demo`), när den finns |

- **Filerna ligger i `deploy/demo/`**: `compose.yaml`, `Caddyfile` och en `.env.example` med varje hemlighet som ska slumpas fram.
- **En containeravbildning för Petvold** byggs med en `Dockerfile` i repot. Den har två mål: `api` (Node 24 med `server.ts`) och `web` (back office byggd utan OIDC, serverad av Caddy). Avbildningarna byggs i CI och märks med commit.
- **En adress för allt:** `/` är back office, `/v1`, `/openapi.yaml` och `/docs` går till API:t, och `/demo` till demotjänsten.
- Andra sätt att köra den, till exempel Fly.io eller Kubernetes med CloudNativePG, väljs bort för demon. En VPS är billigast och mest lik utvecklingsmiljön, och inget i Petvold binder demon till den.

### 2. Demoanvändare i stället för en identitetstjänst

- **Ett demoläge för inloggningen:** `PETVOLD_AUTH=demo` ger samma fasta token som dev-servern (`dev-all`, `dev-handler`, `dev-customer` och de andra). Tokenen flyttas från `dev-server.ts` till en egen fil som båda läser.
- **Demoläget måste begäras uttryckligen.** Utan `PETVOLD_AUTH=demo` kräver servern identitetstjänsten som i dag. I demoläget skriver servern en varning i loggen vid start och i svaret från `/health`.
- **Hela demon ligger bakom inloggning i Caddy**, med ett gemensamt lösenord. Demotoken är publika i repot, så utan lösenordet kan vem som helst ändra i demon. Undantag är `/d/` (dokumentlänkar, som redan är signerade), `/provider-notifications/` (signerade av låtsasbanken) och `/health`.
- Keycloak eller en annan identitetstjänst väljs bort för demon. Det är mer att sätta upp och sköta, och visar inget som demotoken inte visar.

### 3. Testdata som skapas genom API:t, med en klocka som går

- **Testdatan görs av ett program**, `npm run demo:seed`, och inte av SQL eller direkt i lagringen. Programmet anropar API:t i samma process (`createApp` med `compose`), så att varje regel, händelse och beslut blir som i verkligheten och kan styrkas (ADR 0018).
- **Klockan går.** Programmet börjar sex månader bakåt och stegar dag för dag fram till i dag. Varje dag tecknar det policyer, anmäler skador, beslutar, ändrar och avslutar, och kör dagens körningar (förnyelse, fakturering, påminnelser och gallring) och reläet. Då har fakturorna, förnyelserna och meddelandena riktiga datum, och tidslinjen i demotjänsten blir lång.
- **Samma frö ger samma data.** Slumpen har ett fast frö (`--seed`), så att en återställning ger samma kunder och samma händelser.
- **Omfattning:** omkring hundra kunder med ett till tre djur, de flesta i Sverige. Skador i varje kö, några med komplettering och omprövning. Policyer med alla intervall, ändringar, överlåtelser, dödsfall och ånger. Datan växer när Petvold kan mer.
- **Inga riktiga personer** (ADR 0009). Namn och adresser kommer från egna listor med vanliga för- och efternamn och påhittade gator. När en part behöver ett personnummer används Skatteverkets publicerade testpersonnummer.
- **Inbetalningar** görs av låtsasbanken genom `POST /provider-notifications/fake`. De flesta fakturor betalas i tid, några för sent och några inte alls.

### 4. Återställning

`deploy/demo/reset.sh` stoppar demon, tömmer databasen och arkivet, kör migreringarna och `demo:seed` och startar igen. Det tar några minuter. Ingen återställning görs automatiskt.

### 5. Ordning

1. ADR 0041 (den här).
2. `Dockerfile` med målen `api` och `web`, byggd i CI.
3. Demoläget för inloggningen (`PETVOLD_AUTH=demo`).
4. Testdatan: `npm run demo:seed` med klockan som går.
5. `deploy/demo/` med Compose, Caddy och `reset.sh`, och en sida i `docs/teknik/` om hur demon sätts upp.
6. Demotjänsten, fas 1: ta emot och visa händelserna. Den byggs separat och läggs till i Compose när den finns.

## Konsekvenser

- Demon är en installation som de andra. Det som inte fungerar i demon fungerar troligen inte hos ett bolag heller, så demon prövar också `server.ts`, migreringarna och rollerna.
- Demoläget för inloggningen är kod i servern för drift. Det är en risk om någon slår på det av misstag. Därför måste det begäras med namn och syns i loggen och i `/health`.
- Testdatan blir ett program som måste följa med när API:t ändras. Det fångar också fel, eftersom det kör hela kedjan varje dag i sex månader.
- Låtsasbanken (ADR 0017) och demoläget får aldrig slås på i en installation med riktiga pengar och personer. Det står i [Drift](../teknik/drift.md).

## Källor

- Docker Compose, *Compose file reference*. docs.docker.com/reference/compose-file
- Caddy, *Automatic HTTPS* och *basic_auth* (Apache-2.0). caddyserver.com/docs
- Skatteverket, *Testpersonnummer* (öppna data). skatteverket.se
- ADR 0001, 0009, 0010, 0016, 0017, 0018, 0037 och 0038 i det här repot. Specen *Petvold Demo* (2026-11-21).
