# Menyns ordning (PR #NN)

**Datum:** 2026-11-24 **ADR:** 0035 **Moduler:** `apps/backoffice`

## Vad
Menyn i back office är sorterad med det man använder mest och oftast överst. Först kommer det dagliga arbetet, sedan köerna, sedan det man gör sällan. Dokumentationen står sist.

## Hur det fungerar
`SECTIONS` i `src/permissions.ts` har den nya ordningen, i grupper med en kommentar för varje grupp. `sectionsFor` filtrerar på behörigheten och behåller ordningen. Varje roll ser alltså sin del i samma ordning. Ett test bevakar ordningen.

## Val och avvägningar
- **Skador först.** Skadereglering är det de flesta användarna gör varje dag.
- **Parter och Djur hör ihop med Policyer.** När kunden ringer är det de man söker i.
- **Köerna efter det dagliga arbetet**, med Pengar före Meddelanden. Meddelanden behöver bara en person när något har fastnat.
- **Radering flyttades ner.** Den låg tidigt i menyn men används sällan, och bara av den dataskyddsansvarige.
- **Inga rubriker i menyn.** De flesta roller ser bara några få poster, och rubriker hade tagit mer plats än de hjälper.

## Att känna till
Ordningen är en bedömning av hur ofta delarna används. Den kan ändras när det finns riktiga användare att fråga.

## Filer
- `apps/backoffice/src/permissions.ts`
- `apps/backoffice/test/format.test.ts`
