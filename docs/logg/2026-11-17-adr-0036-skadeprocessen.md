# ADR 0036: skadeprocessen (PR #91)

**Datum:** 2026-11-17 **ADR:** 0036 (föreslagen) **Moduler:** inga än

## Vad
Ett förslag till beslut om resten av skadeprocessen före utbetalningen:
- komplettering
- rättelse
- återkallelse och avvisning
- bilagor
- skadenummer från servern
- skadebesked till kunden

Ingen kod ändras i den här PR:en.

## Hur det är tänkt
- **Läget räknas fortfarande fram** ur det som är sparat. Två nya lägen kommer till, väntar på underlag och stängt (återkallat eller avvisat), och läggs in i den befintliga ordningen.
- **Komplettering** är en begäran med svar, påminnelse och utgång. Dagarna finns i produktens skaderegler, så att de är versionerade och går att styrka.
- **Rättelse** ger ärendet revisioner. Policy, djur, marknad och valuta går inte att rätta.
- **Bilagor** är referenser till bolagets arkiv, som produktens dokument i ADR 0032.

## Val och avvägningar
- **Fristen i FAL 7 kap. 1 §** räknas från när underlaget lades fram. Därför får ärendet `basisCompleteAt`. Räntan beräknas i M5, men fristen ska gå att följa redan nu.
- **En utgången komplettering avslår inte.** Ett avslag kräver en person (ADR 0018), och FAL 7 kap. 2 § kräver att försummelsen har skadat bolaget.
- **Rättelse efter ett beslut** av en person öppnar ärendet för en ny bedömning av en person. Efter ett automatiskt beslut omprövas ärendet som i dag.
- **Avvisning är inte avslag.** En dubblett ska inte ge kunden ett avslag med rätt till prövning.

## Att känna till
- **Lagtexten** är hämtad från riksdagen.se. Bestämmelserna om skadereglering finns i 7 kap. 1–4 §§. Kapitlet heter "Regleringen av försäkringsfall, m.m." och gäller konsumentförsäkring (1 kap. 1 §).
- **Bilagor från back office** kräver en port för lagring och kommer senare. Tills dess anges bilagans adress.
- **Påminnelser och utgång** kräver en schemalagd körning. Den behöver samma lås vid flera instanser som reläet, och det är fortfarande öppet.

## Filer
- `docs/adr/0036-skadeprocessen.md` (ny), `docs/adr/README.md`, `docs/roadmap.md`, `docs/status.md`
