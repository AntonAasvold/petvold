# Körningar

Petvold har arbete som ska ske varje dag utan att någon trycker på en knapp: förnyelse, utgång och gallring. Sedan ADR 0037 kör Petvold det självt, en server i taget, och sparar vad varje körning gjorde.

## Körningarna

| Körning | Gör | Förval (marknadens tid) |
| --- | --- | --- |
| `policies.application-expiry` | Ansökningar till manuell prövning vars sista dag passerat blir `expired` (ADR 0031) | 01:00 |
| `policies.proposal-expiry` | En överlåtelse som inte accepterats i tid avslutar policyn från försäljningsdagen (ADR 0029) | 01:15 |
| `policies.renewal` | Policyer vars term slutar inom produktens framförhållning förnyas. Det som inte kan förnyas hamnar under "behöver beslut" (ADR 0029). | 02:00 |
| `parties.retention` | Parter vars lagringstid har gått ut får en begäran om anonymisering, som en dataskyddsansvarig beslutar om (ADR 0028) | 03:00 |
| `billing.invoicing` | Delbetalningar som förfaller inom framförhållningen hamnar på en faktura per betalarkonto (ADR 0040, se [Premier och betalningar](premier.md#fakturor)) | 04:00 |
| `claims.information-requests` | Öppna begäranden om komplettering får sin påminnelse på påminnelsedagen och går ut dagen efter svarsdatumet. Ärendet går då tillbaka till en handläggare (ADR 0036, se [Komplettering](skadereglering.md#komplettering)). | 06:00 |

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
| `billing.invoicing` | `checked`, `invoiced`, `invoiceIds` |
| `claims.information-requests` | `reminded`, `expired`, `remindedRequestIds`, `expiredRequestIds` |

## Se och styra

Sidan **Körningar** i back office (rätten `jobs:read`) visar varje körning och marknad med schema, senaste och nästa körning. "Försenad" står när tiden passerat med mer än fem minuter utan att körningen gjorts, till exempel när ingen schemaläggare kör.

En sida per körning visar historiken och, för den som har `jobs:operate`:

- **Kör nu** i en marknad, med eller utan provkörning. Körningen sker direkt, också när den är pausad, och hamnar i historiken som "Kör nu" med vem som startade den.
- **Pausa** med ett skäl. Gäller direkt i alla marknader, utan fyra ögon: den som ser en körning göra fel ska kunna stoppa den. Schemaläggaren hoppar över den tills den återupptas.
- **Återuppta** med ett skäl. En dag som missades medan den var pausad körs vid nästa omgång.
- **Spåret** visar varje paus och återupptagande med vem, när och varför.

Rollen `operations` har rättigheterna, och dev-tokenen `dev-operations` ger den lokalt.

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `GET /v1/jobs`, `GET /v1/jobs/{job}` | `jobs:read` | Körningarna, med paus och spår |
| `GET /v1/jobs/{job}/runs` | `jobs:read` | Historiken, nyast först |
| `POST /v1/jobs/{job}/runs` | `jobs:operate` | Kör nu i en marknad (`market`, `dryRun`). `409` om en annan server kör den. |
| `POST /v1/jobs/{job}/pauses`, `.../resumptions` | `jobs:operate` | Pausa och återuppta, med `reason` |
| `GET /v1/relay-dead-letters` | `jobs:read` | Reläets döda poster |
| `POST /v1/relay-dead-letters/{deadLetter}/retries` | `jobs:operate` | Skicka en död post igen |

## Ändra schemat

En körnings tid, eller att den är avstängd, ändras med fyra ögon:

1. **Någon med `jobs:configure` föreslår** en ny tid i marknadernas egen tid, eller att körningen stängs av, med ett skäl. En körning har högst en ändring som väntar.
2. **En annan person med `jobs:configure` godkänner.** Den som föreslog kan inte godkänna, och databasen vägrar det också. Ändringen gäller från schemaläggarens nästa omgång och får ett versionsnummer.
3. **Eller avvisar med ett skäl.** Den som föreslog kan dra tillbaka sin ändring på samma sätt.

En avstängd körning körs inte enligt schemat, men "Kör nu" fungerar. Spåret på körningens sida visar varje ändring med vem som föreslog, vem som beslutade och varför.

| Anrop | Rättighet |
| --- | --- |
| `GET`, `POST /v1/jobs/{job}/schedule-changes` | `jobs:read`, `jobs:configure` |
| `POST /v1/jobs/{job}/schedule-changes/{changeId}/approvals` | `jobs:configure`, inte den som föreslog |
| `POST /v1/jobs/{job}/schedule-changes/{changeId}/rejections` | `jobs:configure`, med `reason` |

## Larm

- **`job.failed`** går till webhooks varje gång en körning misslyckas, med körning, marknad, startsätt och start. Felet följer inte med, eftersom det kan nämna en kund. Det finns i historiken.
- **`/healthz`** säger `degraded` och listar under `jobs`:
  - `failed`: körningar vars senaste körning i en marknad misslyckades
  - `late`: körningar som är mer än en timme sena
  - `paused`: pausade körningar

  En avstängd körning är inte försenad: någon har beslutat det med fyra ögon.

**De gamla anropen** (`POST /v1/renewal-runs`, `/v1/retention-runs`, `/v1/application-expiry-runs` och `/v1/policy-proposal-expiry-runs`) svarar som förut. De kör nu körningen en gång per marknad i anroparens omfång och sparar historiken med startsättet "Anrop".

## Reläet

Reläet levererar varje moduls händelser i ordning (ADR 0008). Med flera servrar är en av dem reläet: den håller lånet `relay` och förnyar det varje sekund. De andra väntar och tar över om den stannar.

En händelse som inte går att leverera efter tio försök blir en död post. Den sparas och finns kvar efter en omstart, tills någon skickar den igen. Sidan Körningar listar de döda posterna med "Skicka igen", och menyn räknar dem. `/healthz` visar antalet och om servern är reläet.

## Det som kommer

Alla fem stegen i ADR 0037 är byggda. Påminnelsen och utgången blir meddelanden till kunden när begäran gick till kunden (ADR 0036, se [Meddelanden](meddelanden.md)).

Kö och eftersläpning för reläet och webhook-arbetaren ska också synas i back office.
