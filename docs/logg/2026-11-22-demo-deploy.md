# Demon på en server (PR #143)

**Datum:** 2026-11-22 **ADR:** 0041 **Moduler:** inga, bara drift, och testdatan i `api`

## Vad
`deploy/demo/` sätter upp demon på en server med Docker Compose: Caddy med HTTPS och lösenord, Petvold, back office, Postgres, SeaweedFS och Gotenberg. `setup.sh` gör hemligheterna, och `reset.sh` fyller demon med testdata.

## Hur det fungerar
- **`compose.yaml`** har en gemensam del för `api`, `migrate` och `seed`, med samma avbildning och konfiguration. `migrate` kör dbmate som ägarrollen, och `api` startar först när den är klar. `seed` har profilen `seed`, så att den bara körs när man ber om det.
- **`initdb/01-roles.sh`** skapar en roll per modul med lösenordet från `SERVICE_DB_PASSWORD`, som `db/init` gör lokalt.
- **SeaweedFS** får sin nyckel från miljön. Konfigurationen skrivs vid start, så att ingen nyckel ligger i repot.
- **`reset.sh`** stoppar `api` innan testdatan görs. Testdatan driver reläet och körningarna med sin egen klocka, och en körande server hade tagit reläets lån och levererat händelserna med den riktiga klockan.

## Val och avvägningar
- **Lösenordet frågas efter på `/login`, och sedan räcker en kaka.** Först låg Basic-inloggning på allt. Det krockar med back office, som skickar sin token i samma rubrik (`Authorization`), så API:t hade aldrig svarat. Kakan har ett eget slumpat värde (`DEMO_GATE`), så den går inte att gissa.
- **Caddy-direktivens ordning:** `redir` körs före `basic_auth` om de står direkt i ett block, och `handle` före `route`. Därför ligger `/login` i `handle /login { route { … } }`. Med `redir / 302` tolkade Caddy `/` som matchning och `302` som adress, så det står `redir * / 302`. Båda felen syntes först när demon prövades lokalt med `curl`.
- **Postgres, SeaweedFS och Gotenberg är bara på det interna nätet.** Inga portar öppnas utom 80 och 443.
- **Avbildningarna från registret, eller byggda på plats** (`--build`), så att demon går att sätta upp också innan paketen är publika.

## Rättat i testdatan
Den lokala demon visade 24 skador som väntade på beslut sedan juli. Generatorn tittade inte på svaren och missade felen.
- **Reglerna föreslår avslag** när ersättningen blir noll, till exempel under självrisken, och Petvold tillåter inte att ett sådant förslag godkänns. Handläggaren följer nu förslaget och går emot det var tionde gång, med skälkod.
- **Självrisken** byts mellan produktens två val (`standard` och `high`) i stället för en som inte finns.
- **Ångerfristen** räknas från dagen policyn tecknades, inte från startdagen.
- Ett beslut som misslyckas stoppar nu generatorn i stället för att hoppas över.

## Att känna till
- Avbildningarna i GitHubs register är privata från början. Se [Demon](../teknik/demo.md#sätta-upp-demon).
- Tokenen i back office finns bara i minnet, så en omladdning ber om den igen.
- Demotjänsten läggs till i `compose.yaml` när den finns. `PETVOLD_WEBHOOK_ALLOW_HOSTS=demo` är redan satt, så att den kan ta emot webhooks över http på det interna nätet.

## Filer
- `deploy/demo/compose.yaml`, `Caddyfile`, `setup.sh`, `reset.sh` och `initdb/01-roles.sh`
- `modules/api/src/demo-data.ts`
- `docs/teknik/demo.md`
