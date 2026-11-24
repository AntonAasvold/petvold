# Affärsprocesser för teckning, policy, skada, meddelanden och personuppgifter (PR #155)

**Datum:** 2026-11-24 **ADR:** 0018, 0028, 0029, 0030, 0031, 0032, 0036 **Moduler:** `docs/processer`

## Vad
Fem nya processer i `docs/processer`: teckning, policyns livscykel, skadereglering, meddelanden till kunden och personuppgifter. De har 112 nya regler, så processerna har nu 179 regler totalt, sökbara i back office under **Dokumentation**.

## Hur det fungerar
Sidorna följer samma form som processerna för pengar (PR #154):
- en inledning med rollerna
- ett flöde, med diagram där det hjälper
- regler i tabeller med id, källa och inställning
- ett räknat exempel
- länkar till funktionssidan och ADR:erna

Back office läser in dem när det byggs. Ingen kod ändras.

## Val och avvägningar
- **Reglerna är skrivna från funktionssidorna och ADR:erna**, som redan beskriver det som är byggt. Där en källa var osäker kontrollerades den mot ADR:en, till exempel att förköpsinformationen kommer från FAL 2 kap. 2 § och distansavtalslagen 3 kap. 4–5 §§.
- **Teckning och pris är en process.** Priset räknas vid tecknandet. Reglerna för priset (`TECK-21` till `TECK-25`) gäller också vid ändring och förnyelse, och där hänvisar policyns livscykel till dem.
- **Grupper och kullar har inga egna regler**, utöver att en policy lämnar gruppen vid en överlåtelse (`POL-14`). Grupper påverkar priset och fakturan men inte någon process.
- **Personuppgifter tar med pengarna** (`PERS-16`), så att det framgår att fakturor och verifikationer inte raderas. Det framgår också att betaluppgifter inte raderas än.

## Att känna till
- **Djurregistret, produktkonfigurationen och körningarna** har ingen egen process. De beskrivs i funktionssidorna.
- **Ett regel-id kopplas inte till koden** med något test än.

## Filer
- `docs/processer/teckning.md`, `policyns-livscykel.md`, `skadereglering.md`, `meddelanden.md`, `personuppgifter.md`
- `docs/processer/README.md`
