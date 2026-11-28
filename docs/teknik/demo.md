# Demon

Demon är en installation av Petvold på en egen server, med demoanvändare och testdata (ADR 0041). Tjänsten som tar emot och visar händelserna beskrivs i [Demotjänsten](demotjanst.md). Allt för servern finns i `deploy/demo/`.

## Sätta upp demon

Det som behövs är en server med Docker och Docker Compose, och ett domännamn som pekar på den. Portarna 80 och 443 ska vara öppna, så att Caddy kan hämta ett certifikat från Let's Encrypt. Om de redan används av något annat, se [På en annan port](#på-en-annan-port-med-certifikat-från-duckdns).

```
git clone https://github.com/AntonAasvold/petvold.git && cd petvold/deploy/demo
./setup.sh demo.example.com 'ett långt lösenord'   # skriver .env med nya hemligheter
./reset.sh                                          # hämtar avbildningarna, fyller med testdata och startar
```

- **`setup.sh`** skriver `deploy/demo/.env` med domänen, lösenordets hash och nya slumpade hemligheter: databasens lösenord, nycklarna för webhooks och dokument, låtsasbankens hemlighet och kakan. Filen får bara ägaren läsa. Den ska aldrig in i git, och `.gitignore` håller den utanför.
- **`reset.sh`** tömmer demon och fyller den igen. Den hämtar avbildningarna från GitHubs register, stoppar Petvold, tar bort databasen och arkivet och kör migreringarna och testdatan. Sedan startar den allt. Caddys certifikat behålls. Med `--build` byggs avbildningarna från repot i stället.
- **Avbildningarna** i GitHubs register är privata från början. Gör paketen `petvold-api` och `petvold-web` publika, logga in med `docker login ghcr.io` på servern, eller använd `./reset.sh --build`.
- **En annan version:** sätt `PETVOLD_TAG` i `.env` till en commit, till exempel `PETVOLD_TAG=922336f…`, och kör `./reset.sh`.
- **Längre historik eller ett annat frö:** `DEMO_MONTHS=13 DEMO_SEED=2 ./reset.sh`.

| Tjänst | Vad |
| --- | --- |
| `caddy` | HTTPS, lösenordet och vidarekopplingen |
| `api` | Petvold (`server.ts` med `PETVOLD_AUTH=demo` och låtsasbanken) |
| `web` | Back office |
| `migrate` | Migreringarna, före `api` |
| `seed` | Testdatan, bara från `reset.sh` |
| `postgres`, `seaweedfs`, `gotenberg` | Databasen, arkivet och PDF:erna, bara på det interna nätet |

### Lösenordet

Adressen frågar efter lösenordet en gång, på `/login`, och sätter då en kaka som gäller i 30 dagar. Alla andra sidor och anrop kräver kakan, och utan den skickas man till `/login`.

- **Lösenordet frågas bara efter på `/login`.** Basic-inloggning på varje anrop hade krockat med back office, som skickar sin token i samma rubrik (`Authorization`).
- **Utan kakan** fungerar bara det som redan är signerat: dokumentlänkarna (`/d/`), låtsasbankens aviseringar (`/provider-notifications/`) och `/health`.
- **Ett nytt lösenord:** ta bort `.env` och kör `setup.sh` igen. Det ger också nya hemligheter, så kör `reset.sh` efteråt.

### På en annan port, med certifikat från DuckDNS

Om portarna 80 och 443 redan leder till en annan maskin, till exempel en Home Assistant hemma, kan demon nås på en annan port. Då kan Let's Encrypt inte kontrollera domänen över http, eftersom den kontrollen alltid sker på port 80 eller 443. Caddy gör i stället kontrollen med en TXT-post hos DuckDNS (DNS-01).

```
read -rs DUCKDNS_TOKEN && export DUCKDNS_TOKEN    # tokenen överst på duckdns.org, utan att den hamnar i historiken
DEMO_PORT=8443 ./setup.sh petvold.namn.duckdns.org 'ett långt lösenord'
./reset.sh
```

- **I routern** vidarebefordras TCP 8443 till port 443 på servern. Inget annat behöver öppnas.
- **Adressen** blir `https://petvold.namn.duckdns.org:8443`. Underdomäner till ett DuckDNS-namn pekar på samma IP-adress utan att något läggs till hos DuckDNS.
- **`setup.sh`** skriver `DEMO_TLS=duckdns`, tokenen och `DEMO_PUBLIC_URL` med porten i `.env`. Petvold använder adressen i dokumentens länkar (`PETVOLD_PUBLIC_URL`).
- **Caddy byggs på servern** med modulen [caddy-dns/duckdns](https://github.com/caddy-dns/duckdns) (`caddy/Dockerfile`), första gången av `reset.sh`. Utan `DEMO_TLS=duckdns` används inte modulen.
- **DuckDNS har en TXT-post per namn.** Om ett annat system förnyar sitt certifikat för samma DuckDNS-namn i samma stund kan en av förnyelserna misslyckas. Caddy försöker då igen.

### Uppdatera till en ny version

Varje merge till `main` publicerar nya avbildningar (`Images` i Actions). På servern:

```
cd ~/petvold && git pull
cd deploy/demo && ./reset.sh                                   # ny testdata
# eller, med datan kvar:
docker compose pull api web && docker compose up -d
```

### Nya produkter och regler, med datan kvar

En ny version kan ha nya produkter och regelserier i exempeldatan, till exempel [testprodukterna](../funktion/testprodukter.md). `reset.sh` tar med dem men tar bort datan. Med datan kvar läggs bara det som saknas till:

```
cd ~/petvold/deploy/demo
docker compose pull api && docker compose up -d
docker compose --profile seed run --rm seed node --import tsx modules/api/scripts/catalog-seed.ts            # visar vad som saknas
docker compose --profile seed run --rm seed node --import tsx modules/api/scripts/catalog-seed.ts --apply    # lägger till det
```

Kommandot ändrar aldrig något som finns, och produkterna går genom granskningen. Det kan köras medan Petvold är igång.

`git pull` behövs när `deploy/demo` har ändrats. Med datan kvar körs först tjänsten `roles`, som skapar de modulroller som saknas, och sedan `migrate`. En ny modul med en egen roll fungerar alltså utan att datan rensas. Rollerna skapas av samma skript som när databasen skapas (`initdb/01-roles.sh`), så listan finns på ett ställe.

### Lokalt

`./setup.sh localhost lösenord` och `./reset.sh --build` kör samma demo på den egna datorn, med Caddys egna certifikat i stället för Let's Encrypt. `docker compose down` i `deploy/demo/` stoppar den.

## Testdata

`npm run demo:seed` fyller en ny installation med sex månaders kunder, hundar, policyer, skador, fakturor och inbetalningar. Programmet anropar API:t i samma process, dag för dag med en klocka som går, så att varje regel, händelse och beslut blir som i en riktig installation.

```
npm run demo:seed -- --months 6 --seed 1 --per-day 0.55
```

| Flagga | Förval | Betyder |
| --- | --- | --- |
| `--months` | 6 | Hur långt bakåt det börjar. Det slutar i dag. |
| `--seed` | 1 | Fröet. Samma frö ger samma kunder, händelser och id:n. |
| `--per-day` | 0,55 | Nya kunder per dag i genomsnitt, så omkring hundra på sex månader. |

Med `DEMO_WEBHOOK_URL` prenumererar programmet först på demotjänstens adress, så att den får hela historiken när Petvold startar ([Demotjänsten](demotjanst.md#1-prenumerationen)). Programmet behöver samma konfiguration som `server.ts` (databaser, nycklar, arkiv och Gotenberg) och `PETVOLD_FAKE_BANK_SECRET`. Det stoppar om installationen redan har produkter, så det fyller bara en ny.

### Vad som händer varje dag

1. **Nattens körningar** körs (ADR 0037): förnyelse, fakturering, påminnelser om komplettering och gallring.
2. **Nya kunder** registreras med en till tre hundar.
   - De flesta tecknar `SE-HUND-BAS` direkt, med år, kvartal eller månad.
   - Var femte ansöker om `SE-HUND-PLUS` med hälsofrågor.
   - Hushåll med flera hundar får ofta en hushållsgrupp.
3. **En försäkringshandläggare** prövar ansökningarna som gick till manuell prövning, några dagar senare.
4. **Skador** anmäls ungefär en gång per hund och år, efter karenstiden, av kliniken eller kunden.
   - Ett öra, en mage eller ett korsband, med belopp som varierar.
   - Små skador regleras automatiskt.
   - En handläggare beslutar om de andra, och en attestant attesterar dem över handläggarens gräns.
5. **Ibland** ändrar en kund självrisken, ångrar sig inom fjorton dagar eller avslutar för att hunden dött.
6. **Låtsasbanken** betalar fakturorna. De flesta betalas i tid, var tionde upp till 30 dagar för sent och var tjugonde inte alls. De sena får en påminnelse och ibland en uppsägning, som återkallas när de betalar. De som aldrig betalar sägs upp, och 20 dagar efter uppsägningen skriver `dev-billing` av det som är kvar. Över gränsen attesterar `dev-billing-manager`. Tre av hundra betalningar saknar OCR och hamnar bland de okopplade inbetalningarna.
7. **Utbetalningar:** fyra av fem kunder ger betaluppgifter när de tecknar. De andra ger dem några dagar efter att en ersättning väntar. Demon spärrar nya uppgifter i två dagar (`PETVOLD_NEW_PAYEE_HOLD_DAYS=2`), och `dev-billing` släpper dem dagen efter. Klinik 001, som `dev-clinic` är, har avtal om direktreglering, så dess skador betalas till kliniken.

Sist läggs exempeldatan från dev-servern in: Bella, Doris, hushållet i Malmö och ansökningarna i Uppsala. Då fungerar tokenen och guiderna som nämner dem, till exempel `dev-customer`.

### Bolagets inställningar

Demons bolag heter *Petvold Demoförsäkring* och är påhittat. Programmet sätter dess texter i meddelandena (`modules/api/seed/demo-notice-texts.json`): avsändare, hur ett beslut prövas och vart en faktura betalas. Med `PETVOLD_GOTENBERG_URL` gör Petvold också PDF:erna (`documentMaker: petvold`).

### Påhittat

Alla uppgifter är påhittade (ADR 0009):
- Namnen kommer från listor med vanliga svenska för- och efternamn, och gatorna är påhittade.
- E-postadresserna slutar på `example.test`.
- Ingen har ett personnummer.

### Hur lång tid det tar

| Var | Tid för sex månader |
| --- | --- |
| I minnet | Några sekunder |
| Postgres | Omkring en halv minut |
| Postgres och Gotenberg | Omkring två minuter, med en PDF för varje försäkringsbrev, faktura och skadebesked |

## Inloggning

Bakom lösenordet loggar man in i back office med en av dev-serverns token, eftersom demon startar med `PETVOLD_AUTH=demo` ([Drift](drift.md)). `dev-all` har alla roller som back office använder, och `dev-billing` följer premierna och inbetalningarna. Tokenen finns bara i minnet, så en ny flik eller en omladdning ber om den igen. API-sidan finns på `/docs`.
