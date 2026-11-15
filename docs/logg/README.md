# Bygglogg

En post per PR som förklarar *hur* något är byggt och *varför*: vägen genom koden, valen som gjordes och vad som valdes bort. Den här loggen kompletterar annan dokumentation:

| Dokument | Svarar på |
| --- | --- |
| `docs/funktion/` | Vad gör Petvold, och hur ställs det in? |
| `docs/teknik/` | Hur ser systemet ut just nu? |
| `docs/adr/` | Vilka beslut är svåra att ändra, och varför fattades de? |
| `docs/status.md` | Vad gjordes i varje pass, och vad är nästa steg? |
| **`docs/logg/`** | **Hur implementerades en ändring, steg för steg, och vad är bra att veta när man läser koden?** |

Posterna ändras inte i efterhand. Om något ändras senare skriver den nya PR:en en ny post.

## Mall

Filnamn: `ÅÅÅÅ-MM-DD-kort-namn.md`.

```markdown
# Rubrik (PR #NN)

**Datum:** … **ADR:** … **Moduler:** …

## Vad
En eller två meningar om vad som går att göra nu.

## Hur det fungerar
Vägen genom koden för ett typiskt anrop, från HTTP till databas, med filer och funktioner.

## Val och avvägningar
Varför det blev så, och vad som valdes bort.

## Att känna till
Fallgropar, begränsningar och vad som inte är byggt.

## Filer
De viktigaste filerna.
```

## Poster

Senaste först.

| Datum | Post | PR |
| --- | --- | --- |
| 2026-11-15 | [ADR om teckningsregler och ansökan](2026-11-15-teckningsregler-adr.md) | #64 |
| 2026-11-15 | [Inför ett gränssnitt: vem är jag, CORS och exempeldata](2026-11-15-infor-gransnitt.md) | #63 |
| 2026-11-15 | [Listor och sidindelning](2026-11-15-listor.md) | #62 |
| 2026-11-15 | [Drift: kompositionsrot, relä och inloggning](2026-11-15-drift.md) | #61 |
| 2026-11-15 | [Datum i marknadens tidszon](2026-11-15-tidszon.md) | #60 |
| 2026-11-15 | [Granskning av arkitektur och funktion](2026-11-15-granskning.md) | #59 |
| 2026-11-15 | [Priset på policyn](2026-11-15-pris-pa-policyn.md) | #58 |
| 2026-11-15 | [Prisvilkor: rabatter efter grundpriset](2026-11-15-prisvillkor.md) | #57 |
| 2026-11-15 | [Produktens tariff och prisindikation](2026-11-15-prisindikation.md) | #56 |
| 2026-11-15 | [Prisfunktion och tariffer](2026-11-15-prisfunktion.md) | #55 |
| 2026-11-15 | [ADR om tariffen](2026-11-15-tariff-adr.md) | #54 |
| 2026-11-15 | [Policygrupper för kull och hushåll](2026-11-15-grupper.md) | #53 |
| 2026-11-15 | [Ändring av val under termen](2026-11-15-andring.md) | #52 |
| 2026-11-15 | [Gallringen känner till skador](2026-11-15-gallring-skador.md) | #51 |
| 2026-11-15 | [Omprövning av skador när en policyversion ersätts](2026-11-15-omprovning-policy.md) | #50 |
| 2026-11-15 | [Överlåtelse och dödsfall från djurregistrets händelser](2026-11-15-overlatelse.md) | #49 |
| 2026-11-15 | [Förnyelse av policyer](2026-11-15-fornyelse.md) | #48 |
| 2026-11-15 | [Avslut av policyer](2026-11-15-avslut.md) | #47 |
| 2026-11-15 | [Policymodulen: tecknande](2026-11-15-policyer.md) | #46 |
| 2026-11-15 | [ADR om policyns livscykel](2026-11-15-policy-adr.md) | #45 |
| 2026-11-15 | [Nya standardroller till en sparad rollinställning](2026-11-15-roles-sync.md) | #44 |
| 2026-11-15 | [Gallring: lagringstider och gallringskörning](2026-11-15-gallring.md) | #43 |
| 2026-11-15 | [Anonymisering och begränsning av parter](2026-11-15-anonymisering.md) | #42 |
| 2026-11-15 | [ADR om gallring och anonymisering](2026-11-15-gallring-adr.md) | #41 |
| 2026-11-15 | [Kullar i djurregistret](2026-11-15-kullar.md) | #39 |
| 2026-11-15 | [Djurregistret kontrollerar ägaren](2026-11-15-agarkontroll.md) | #38 |
| 2026-11-15 | [Parter: personer och organisationer](2026-11-15-parter.md) | #37 |
| 2026-11-15 | [Dokumentationen och API-specen på GitHub Pages](2026-11-15-dokumentationssajt.md) | #36 |
| 2026-11-15 | [Uppslagning av djur för kliniker](2026-11-15-uppslagning-av-djur.md) | #35 |
| 2026-11-15 | [Djurregister: djur, id-nummer och ägarskap](2026-11-15-djurregister.md) | #34 |
| 2026-11-15 | [Produkter och produktversioner](2026-11-15-produktversioner.md) | #33 |
| 2026-11-15 | [Referensdata: arter, raser och kön](2026-11-15-referensdata.md) | #32 |
