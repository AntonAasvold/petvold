# ADR om gallring och anonymisering (PR #41)

**Datum:** 2026-11-15 **ADR:** 0028 (Föreslagen) **Moduler:** inga, bara dokumentation

## Vad

Ett förslag till hur Petvold ska uppfylla lagringsminimering och rätten till radering (GDPR artikel 5.1 e och 17) utan att bryta historiken. Ingen kod.

## Hur det ska fungera

- **Personuppgifter finns bara i `parties`.** Jag kontrollerade skademotorns underlag (`PolicySnapshot`, `Claim`): de innehåller bara id:n som `policyId` och `animalId`, och inga namn eller personnummer.
- **Anonymisering, inte radering.** Personfälten i alla revisioner töms, och id-numren tas bort, men part-id:t finns kvar. Kedjorna från ägarskap, policyer och beslut håller.
- **En databasfunktion med `security definer`** är det enda som får skriva över historik. Tjänsterollen får bara köra den, och varje körning loggas i `parties.erasure` utan personuppgifter.
- **Sista relationen via en port.** Varje modul svarar på `lastActivity(partyId)`. Partmodulen räknar ut när lagringstiden går ut.

## Val och avvägningar

- **Tio år för Sverige** följer försäkringsavtalslagen 7 kap. 4 § (talan inom tio år från försäkringsfallet). Det är längre än bokföringslagens sju år, så båda täcks.
- **Fyra ögon** eftersom anonymiseringen inte går att ångra.
- **Crypto-shredding** valdes bort för nu. Det skulle skydda säkerhetskopior bättre men fungerar dåligt med sökning på personnummer.

## Att känna till

- Lagringstiderna är försäkringsbolagets ansvar. Petvold föreslår värden med källor.
- Fritext, till exempel fakturarader, kan innehålla personuppgifter som någon har skrivit in. Det är inte löst.
- Användar-id:n i `changedBy` hör till de anställda och ligger utanför beslutet.

## Filer

- `docs/adr/0028-gallring-och-anonymisering.md`
