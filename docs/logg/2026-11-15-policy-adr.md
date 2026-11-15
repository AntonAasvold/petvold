# ADR om policyns livscykel (PR #45)

**Datum:** 2026-11-15 **ADR:** 0029 (Beslutad) **Moduler:** inga, bara dokumentation

## Vad

Ett förslag till hur policymodulen (M3) ska teckna, förnya, avsluta och överlåta policyer, och vilka lagregler som gäller i Sverige. Ingen kod.

## Hur det ska fungera

- **Policy, term, version och transaktion.** Begreppen följer ADR 0006.
- **Lagregler i koden.** De ligger i en marknadsprofil med paragrafer som källa, och bolagets val ligger i produkten. En produkt kan inte stänga ångerrätten eller avslut när försäkringsbehovet faller bort.
- **Djurregistrets händelser.** `animal.died` och `animal.ownership_changed` skapar förslag till avslut. De byggs därför samtidigt som policymodulen.
- **Policymodulen uppfyller två portar:** `PolicyPort` för skademotorn och `ActivitySource` för gallringen.

## Val och avvägningar

- **Samma policy byter försäkringstagare vid försäljning**, enligt ditt beslut. Bytet är en ny version med giltighet från försäljningsdagen, så historiken visar vem som var försäkringstagare varje dag och när bytet registrerades. Den nya ägaren måste godkänna villkoren, och godkännandet sparas.
- **Två sätt att avsluta under termen:** bindningstiden ut eller direkt uppsägning med premie tillbaka. Produkten väljer.
- **Förnyelse 45 dagar före förfallodagen** som förval, inställbart per produkt.
- **Pris som anges av anroparen tills M4.** Då kan policyer tecknas innan tariffen finns, och priset sparas på samma sätt som när det senare räknas fram.
- **Avslut bakåt i tiden** när behovet föll bort tidigare. Det kräver att skademotorn kan ompröva skador efter ett retroaktivt avslut.

## Att känna till

- Lagtexten är hämtad från lagen.nu: FAL 3 kap. 2, 3, 4, 6 och 7 §§, 5 kap. 2 och 6 §§, och distansavtalslagen 3 kap. 13, 15, 17 och 20 §§.
- Bara Sverige har en profil. Andra marknader behöver en egen profil med källor.

## Filer

- `docs/adr/0029-policyns-livscykel.md`
