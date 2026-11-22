# Avbildningar för demon (PR #140)

**Datum:** 2026-11-22 **ADR:** 0041 **Moduler:** inga, bara bygget

## Vad
Petvold kan byggas som två containeravbildningar, `api` och `web`, och CI lägger dem i GitHubs register från `main`.

## Hur det fungerar
- **`Dockerfile`** har tre steg. `build` installerar allt och bygger back office med `VITE_API_URL=""`, så att den anropar API:t på samma adress. `api` installerar bara beroenden för körning och kopierar `modules`, `db` och `design/tokens.json`. `web` är Caddy med back office i `/srv` och `deploy/web/Caddyfile`.
- **`.github/workflows/images.yml`** bygger båda målen i varje PR och skickar dem till `ghcr.io` från `main`, märkta med commit och `main`. Byggcachen ligger i GitHub Actions.

## Val och avvägningar
- **`tsx` och `dbmate` blev vanliga beroenden.** Servern startar med `node --import tsx` och migreringarna körs med dbmate, så båda behövs i drift. Att kompilera TypeScript till JavaScript före körningen hade gjort avbildningen mindre, men då hade Petvold haft två sätt att köra, och JSON-importerna och sökvägarna med `import.meta.url` hade behövt ses över.
- **Migreringarna körs med samma avbildning** (`node_modules/.bin/dbmate`), så att versionen av migreringarna alltid hör ihop med versionen av servern.
- **Back office följer med Caddy** i stället för att API:t serverar filerna. Då behöver servern ingen kod för statiska filer, och demons Caddy kan lägga lösenord och HTTPS framför båda.
- **Basavbildningarna har exakta versioner**: Node 24.22.2 (släppt 2026-10-27) och Caddy 2.11.7, båda äldre än två veckor.

## Att känna till
- Mallarna för dokument läser `design/tokens.json` vid start. Den filen saknades först i avbildningen, och servern stannade. Den kopieras nu uttryckligen.
- Back office i avbildningen `web` loggar in med dev-serverns token. Den är för demon, inte för en installation hos ett bolag.
- Avbildningen `api` är omkring 520 MB. Det mesta är `node_modules` för alla moduler.

## Filer
- `Dockerfile`, `.dockerignore` och `deploy/web/Caddyfile`
- `.github/workflows/images.yml`
- `package.json`
