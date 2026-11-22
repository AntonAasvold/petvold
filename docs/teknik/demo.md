# Demon

Demon är en installation av Petvold på en egen server, med demoanvändare och testdata (ADR 0041). Sidan växer med stegen i ADR:en. Nu beskriver den testdatan, och uppsättningen på servern kommer i nästa steg.

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

Programmet behöver samma konfiguration som `server.ts` (databaser, nycklar, arkiv och Gotenberg) och `PETVOLD_FAKE_BANK_SECRET`. Det stoppar om installationen redan har produkter, så det fyller bara en ny.

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
6. **Låtsasbanken** betalar fakturorna. De flesta betalas i tid, var tionde för sent och var tjugonde inte alls.

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

Demon startar med `PETVOLD_AUTH=demo` ([Drift](drift.md)) och har samma token som dev-servern. `dev-all` har alla roller som back office använder, och `dev-billing` följer premierna och inbetalningarna.
