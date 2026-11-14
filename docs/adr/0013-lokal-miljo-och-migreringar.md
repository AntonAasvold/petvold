# 0013. Lokal miljö med docker compose och migreringar med dbmate

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

M1 bygger skademotorns lagring mot Postgres. Då behövs en databas lokalt och i CI som beter sig som den i drift (ADR 0004), ett sätt att köra migreringar på samma sätt överallt, och databasroller per modul (ADR 0001). Lokala versioner och CI-versioner har redan glidit isär: Node 24 lokalt, Node 22 i CI.

## Beslut

- **Node** enligt `.node-version` (24, LTS). CI läser samma fil, och `engines` i `package.json` varnar vid fel version.
- **Postgres lokalt och i CI** via `compose.yaml` med den officiella imagen i samma version och Debian-bas som CloudNativePG-imagen i drift. CloudNativePG-imagen startar bara under operatorn och går inte att köra direkt i compose. Repot kräver bara `docker compose`, inte en viss leverantör.
- **CI kör samma kommando som utvecklaren**, `npm run dev:up`, och sedan databastesterna. Det testar också själva utvecklingsmiljön.
- **Migreringar med dbmate:** ren SQL med `-- migrate:up` och `-- migrate:down` i `db/migrations/`, och spårning av körda versioner i `schema_migrations`. dbmate installeras som npm-paket, så ingen separat installation behövs.
- **Roller utanför migreringarna:** roller finns på klusternivå och skapas av `db/init/` lokalt och av CloudNativePG i drift. Migreringarna ger rättigheter till rollerna.
- **Två databaser lokalt:** `petvold` och `petvold_test`.

## Konsekvenser

- En ny utvecklare behöver Node och `docker compose`, sedan räcker fyra kommandon.
- Databasens regler (balanserade journaler, inga överlappande perioder, oföränderlig historik) testas på varje PR mot riktig Postgres.
- Tjänsterollen får bara läsa och lägga till. Att historik inte kan ändras gäller nu på riktigt för tjänsten, inte bara som kommentar.
- Versionerna i `compose.yaml` och i driften måste hållas lika för hand tills vi har automatiska beroendeuppdateringar.
- `0001_claims.sql` fick markeringarna `migrate:up`/`migrate:down`. Det är tillåtet bara för att migrationen aldrig körts i en varaktig miljö. Från och med nu ändras körda migreringar aldrig.

## Alternativ

- **Egen migreringskörare:** ett verktyg mindre, men vi skulle själva underhålla låsning, spårning och backning.
- **node-pg-migrate eller Prisma Migrate:** knutna till Node eller till en ORM. dbmate är språkoberoende och använder ren SQL.
- **Testcontainers:** startar en databas per testkörning. Bra isolering men långsammare, och utvecklaren och CI skulle använda olika uppsättningar.
- **Devcontainer:** värt det med fler utvecklare eller molnmiljöer. Senare.

## Källor

- dbmate: github.com/amacneil/dbmate
- CloudNativePG, *Database role management* (`spec.managed.roles`): cloudnative-pg.io/documentation
- Docker Official Image `postgres`, avsnittet *Initialization scripts*: hub.docker.com/_/postgres
