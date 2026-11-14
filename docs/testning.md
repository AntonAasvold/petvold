# Testning

Hur vi testar Petvold. Beslutet finns i ADR 0012. Ändra filen när något inte fungerar.

## Lager

| Lager | Vad det skyddar | Var | Verktyg |
| --- | --- | --- | --- |
| 1. Enhetstester | Beräkningar, regler och gränsfall i ren domänkod | `modules/*/test/*.test.ts` | `node:test` |
| 2. Egenskapstester | Invarianter som ska gälla för alla indata | `modules/*/test/*.property.test.ts` | fast-check |
| 3. Scenariotester | Försäkringsfall som data, läsbara utan kod | `scenarios/<modul>/<marknad-produkt>/*.yaml` | egen körare (M1) |
| 4. Porttester | Att alla implementationer av en port beter sig lika | `modules/<modul>-core/test-suites/` | gemensam svit, t.ex. `claimsStoreSuite` |
| 5. Kontraktstester | Att API och händelser följer OpenAPI/AsyncAPI | `modules/*-api/test/` | ajv, `lint:openapi` |
| 6. Databastester | Att databasens regler håller: balans, inga överlapp, inga ändringar | `db/test/` | riktig Postgres (M1) |

Lager 3 byggs i M1. Lager 4 och 6 finns för skademotorn.

## Regler

- **Deterministiskt.** Ingen riktig klocka, inga slumpade id:n och inget nätverk i lager 1–3. `Clock` och `IdGenerator` injiceras.
- **Påhittade data.** Exempel och scenarier hittas på. Regler hämtas från publika villkor med källa (ADR 0009).
- **Namnge testet efter regeln**, på svenska: `'öppen självriskperiod: ingen fast självrisk'`, inte `'test 3'`.
- **Pengar i minsta enhet** i testdata. Skriv beloppet i klartext i en kommentar när det hjälper: `455_500, // 25 % av 18 220 kr`.
- **Kontraktet är facit för API:et.** Varje svar i API-testerna valideras mot `openapi.yaml`.

## Egenskapstester

Ett egenskapstest säger vad som alltid ska gälla, och fast-check letar efter ett motexempel. Hittar det ett fel krymps indata till det minsta fall som fortfarande fallerar.

Bra egenskaper för en försäkringskärna:

- **Bevarande:** ersättning + kundens andel = fakturerat. Varje journal summerar till noll.
- **Gränser:** ersättningen överstiger aldrig återstående försäkringsbelopp och blir aldrig negativ.
- **Monotoni:** mer förbrukat belopp ger aldrig högre ersättning.
- **Oberoende:** en rad som inte ersätts ändrar inte ersättningen.
- **Idempotens:** en omprövning utan ändrat underlag bokar noll.
- **Vändbarhet:** `addDays(addDays(d, n), -n) = d`.

Ett fallerande egenskapstest skriver ut motexemplet och ett `seed`. Gör om motexemplet till ett vanligt enhetstest när felet rättas, så att det stannar kvar som exempel.

## Klart betyder (test)

En ändring är klar när:

- det nya har enhetstester, inklusive minst ett fel- eller gränsfall
- en ny beräkning eller regel har minst en egenskap
- en ny eller ändrad operation i kontraktet har ett API-test som validerar svaret mot kontraktet
- en ny implementation av en port går igenom portens gemensamma svit

## Senare

- Fuzzing av API:et utifrån OpenAPI-schemana.
- Mutationstester (Stryker) på `common` och `*-core`.
- Golvvärde för täckning i CI, som hjälpmedel och inte som mål.
