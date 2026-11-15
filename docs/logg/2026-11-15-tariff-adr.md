# ADR om tariffen (PR #54)

**Datum:** 2026-11-15 **ADR:** 0030 (Föreslagen) **Moduler:** inga, bara dokumentation

## Vad

Ett förslag till hur Petvold räknar premier i M4. Ingen kod.

## Hur det ska fungera

- **Tariffen är data i `decisioning`.** Den har samma livscykel, fyra ögon, kontrollsumma och simulering som skadereglerna (ADR 0021). Produktversionen pekar på en tariffserie.
- **Priset räknas av en ren funktion** i `pricing-core`. Grundpremien per art och försäkringsbelopp multipliceras med faktorer i baspunkter (ålder, rasens riskgrupp, självrisk och eventuellt zon). Sedan läggs rabatter, lägsta premie och avrundning på.
- **Samma funktion överallt:** prisindikationen (`POST /v1/quotes`) och policymodulen via `PricingPort`.
- **Priset sparas med underlaget:** tariffversion, kontrollsumma, `inputHash` och `breakdown`. Det kan därför räknas om som ett skadebeslut.

## Val och avvägningar

- **Heltal och BigInt, och avrundning en gång.** Flyttal ger öresfel som syns när ett pris räknas om.
- **Tariffen utanför produkten.** Priser ändras oftare än produkter, och av samma skäl ligger skadereglerna utanför produkten.
- **Inga uppgifter om ägaren** utom eventuellt postnumrets zon (GDPR artikel 5.1 c).
- **Teckningsregler får en egen ADR.** De påverkar om en ansökan godkänns och vilka förbehåll som gäller, inte priset.

## Att känna till

- Produkter utan `tariffSeries` fortsätter att ta premien från anroparen.
- Skatt på premien ligger i marknadsprofilen. Sverige har ingen.

## Filer

- `docs/adr/0030-tariff.md`
