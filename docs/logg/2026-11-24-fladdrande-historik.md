# Det fladdrande testet för skadans historik (PR #159)

**Datum:** 2026-11-24 **ADR:** 0036 **Moduler:** `apps/backoffice`

## Vad
Testet `register.spec.ts` för en rättad skada fallerade ibland i CI. Det fallerade senast på PR #158.

## Hur det fungerar
Testet väntade sig att `claim.corrected` stod överst i historiken. Skadebeskedet (`notice.created`) görs av meddelandemodulen via relän efter beslutet. Hinner testet rätta skadan innan relän gått, får beskedet en senare tid och står överst. Historiken visar den senaste först, så ordningen är rätt. Felet låg i testets antagande.

## Val och avvägningar
Testet kontrollerar nu att rättelsen finns i historiken, inte att den står överst. Det andra alternativet var att vänta in beskedet först. Det hade gjort testet beroende av relän utan att pröva något mer.

## Att känna till
Andra tester som läser historiken bör inte heller räkna med ordningen mot händelser som kommer via relän.

## Filer
- `apps/backoffice/e2e/register.spec.ts`
