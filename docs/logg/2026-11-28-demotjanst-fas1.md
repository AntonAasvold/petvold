# Demotjänsten, fas 1 (PR #183)

**Datum:** 2026-11-28 **ADR:** 0033, 0041 **Moduler:** ny app `apps/demo`, `deploy/demo`

## Vad
Demotjänsten tar emot Petvolds händelser och visar dem. Den prenumererar själv på alla händelser när den startar, kontrollerar signaturen, sparar händelsen i en egen databas och visar en lista med filter, live. Avvisade anrop och dubbletter syns. Den finns i demons Compose på `/demo/`.

## Hur det fungerar
- **`src/subscription.ts`** letar upp prenumerationen på tjänstens adress med `dev-integration`. Saknas den skapas den. Finns den men tjänsten saknar hemligheten byts hemligheten, och är den avstängd slås den på. Hemligheten sparas i tabellen `setting`.
- **`src/app.ts`** tar emot på `/webhooks/petvold`: signaturen kontrolleras först (`src/signature.ts`, med Standard Webhooks exempel som test), sedan läses CloudEvent, och händelsen sparas med anropet. Svaret är `204` direkt.
- **Lagringen** (`src/store.ts` och `src/postgres.ts`) har en rad per händelse och en per godkänt anrop. En händelse som kommer igen blir ett anrop till, inte en ny händelse. Samtidiga anrop med samma händelse ger en händelse, tack vare `on conflict do nothing`.
- **Sidorna** byggs på servern med `hono/html`. Listan har en server-sent event-ström, och sidan hämtar om sin lista när något kommit in.
- **Compose:** `demo-migrate` skapar `petvold_demo` och kör migreringarna som ägaren, och `demo` loggar in som `demo_service`. Testdatan prenumererar på `http://demo:8790/webhooks/petvold` innan något händer, så efter `reset.sh` får tjänsten hela historiken.

## Val och avvägningar
- **Sidor från servern i stället för Lit och Web Awesome**, som specen sa. Fas 1 är listor och detaljer, och utan byggsteg blir tjänsten lättare att läsa som exempel för ett bolag. Specen är ändrad. Låtsasbanken i fas 3 kan ta in Lit om den behöver det.
- **`503` innan hemligheten finns**, i stället för `401`. Annars skulle historiken efter `reset.sh` fylla listan med avvisade anrop under de sekunder innan tjänsten bytt hemlighet. Petvold försöker igen efter fem sekunder.
- **Tappa nästa svar.** Back office skickar bara om leveranser som gett upp, och de har aldrig nått fram. En dubblett uppstår när mottagaren sparat men svaret inte kommit fram, och knappen gör just det.
- **Caddy tar bort `/demo`** från sökvägen, så tjänsten ser samma sökvägar lokalt och i demon. Mottagaren nås bara på det interna nätet, aldrig genom Caddy.
- **Rättigheterna i migreringen** ges bara om rollen `demo_service` finns. Lokalt loggar tjänsten in som ägaren, och en dev-databas från före den här PR:en har inte rollen.

## Att känna till
- Tjänsten har egna tester: `npm test -w @petvold/demo` och `npm run test:db -w @petvold/demo` (mot `petvold_demo_test`). CI kör dem, och kontrollerar att typerna från kontraktet är aktuella.
- En demo som uppdateras med datan kvar får en ny prenumeration och ser bara händelserna från uppdateringen och framåt.

## Filer
- `apps/demo/` (ny), `Dockerfile` (målet `demo`), `.github/workflows/ci.yml`, `.github/workflows/images.yml`
- `deploy/demo/compose.yaml`, `deploy/demo/Caddyfile`, `deploy/demo/reset.sh`, `deploy/demo/initdb/01-roles.sh`, `db/init/01-roles-and-databases.sql`, `scripts/check-language.ts`
- `docs/teknik/demotjanst.md`, `docs/teknik/demo.md`, `docs/funktion/webhooks.md`, `docs/roadmap.md`, `CLAUDE.md`
