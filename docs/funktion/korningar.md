# Körningar

Petvold har arbete som ska ske varje dag utan att någon trycker på en knapp: förnyelse, utgång och gallring. Sedan ADR 0037 kör Petvold det självt, en server i taget, och sparar vad varje körning gjorde.

## Körningarna

| Körning | Gör | Förval (marknadens tid) |
| --- | --- | --- |
| `policies.application-expiry` | Ansökningar till manuell prövning vars sista dag passerat blir `expired` (ADR 0031) | 01:00 |
| `policies.proposal-expiry` | En överlåtelse som inte accepterats i tid avslutar policyn från försäljningsdagen (ADR 0029) | 01:15 |
| `policies.renewal` | Policyer vars term slutar inom produktens framförhållning förnyas. Det som inte kan förnyas hamnar under "behöver beslut" (ADR 0029). | 02:00 |
| `parties.retention` | Parter vars lagringstid har gått ut får en begäran om anonymisering, som en dataskyddsansvarig beslutar om (ADR 0028) | 03:00 |

- **En gång per dag och marknad.** Varje körning går en gång per marknad som installationen har, alltså marknader med en produkt eller en regel för gallring. Tiden räknas i marknadens tidszon, och en körning i en marknad påverkar aldrig en annan.
- **En server i taget.** Körs Petvold på flera servrar tar en av dem ett lån för körningen och marknaden. De andra hoppar över den. En server som stannar mitt i släpper lånet när det går ut efter tio minuter.
- **En missad dag körs en gång.** Var servern nere vid tiden körs körningen när den startar igen, en gång och inte en gång per missad dag. Körningarna räknar själva fram vad som är förfallet.
- **Sommartid.** En tid som inte finns en natt, till exempel 02:30 när klockan ställs fram, körs vid nästa tid som finns.
- **Ett fel stoppar inte de andra.** Misslyckas en körning i en marknad sparas felet, och nästa marknad och nästa körning går som vanligt. Nästa dag försöker den igen.

## Historiken

Varje körning sparas med:
- körning och marknad
- hur den startades: schema, för hand eller anrop
- vem som startade den
- start och slut
- läge (`running`, `succeeded`, `failed`, `skipped`)
- resultatet och felet

Resultatet har bara antal och id:n, aldrig personuppgifter. En ansökans svar om hälsa eller en parts datum stannar i sina moduler. Historiken sparas i 400 dagar.

| Körning | Resultat |
| --- | --- |
| `policies.application-expiry` | `expired`, `applicationIds` |
| `policies.proposal-expiry` | `expired`, `proposalIds` |
| `policies.renewal` | `checked`, `renewed`, `cancelled`, `notYet`, `needsDecision` (policy och skäl), `renewedPolicyIds` |
| `parties.retention` | `settingsVersion`, `checked`, `due`, `ongoing`, `withinRetention`, `pendingRequest`, `requestIds` |

## Reläet

Reläet levererar varje moduls händelser i ordning (ADR 0008). Med flera servrar är en av dem reläet: den håller lånet `relay` och förnyar det varje sekund. De andra väntar och tar över om den stannar.

En händelse som inte går att leverera efter tio försök blir en död post. Den sparas och finns kvar efter en omstart, tills någon skickar den igen. `/healthz` visar antalet och om servern är reläet.

## Det som kommer

Steg 1 och 2 i ADR 0037 är byggda: schemaläggaren, lånen, historiken och reläet bakom ett lån. Det som återstår:

- **Steg 3:** anrop under `/v1/jobs` och sidan Körningar i back office, med historik, "Kör nu" och paus. Anropen som finns i dag (`POST /v1/renewal-runs` och de andra) börjar då också spara historik.
- **Steg 4:** schemaändringar med fyra ögon, händelsen `job.failed` och larm i `/healthz`.
- **Steg 5:** påminnelser och utgång för komplettering av skador.

Tills dess går tiderna inte att ändra, och historiken går bara att läsa i databasen (`scheduling.run`).
