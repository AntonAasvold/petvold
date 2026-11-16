# API-konventioner

Reglerna för `modules/api/openapi.yaml` (ADR 0034). `npm run lint:openapi` kontrollerar de regler som är märkta **(CI)**.

## Adresser

- **Alla adresser börjar med `/v1/`** **(CI)**.
- **Delar med små bokstäver och bindestreck:** `policy-groups`, `rule-sets` **(CI)**.
- **Samlingar heter som substantiv i plural:** `/v1/policies`, `/v1/applications`.
- **En resurs är `/{samling}/{id}`**, och en underresurs ägs av sin förälder: `/v1/claims/{claimId}/decisions`.
- **En samling på toppnivå läggs aldrig under en annan resurs** **(CI)**. Policyns försäkringsbelopp är `/v1/policies/{policyId}/limits`, inte `/v1/policies/{policyId}/animals/{animalId}/limits`.
- **Direkt under en samling kommer ett id**, eller `searches` **(CI)**. Ett urval är ett filter i frågan, inte en egen adress: `/v1/product-versions?onSale=2026-11-16`, inte `/v1/products/on-sale`.
- **En vy med en annan behörighet är en egen samling**, till exempel `/v1/animal-summaries` för klinikens uppslag. Den kräver `animals:lookup`, medan `/v1/animals` kräver `animals:read`.

## Handlingar

- **En handling på en resurs är POST till ett substantiv i plural** **(CI):** `/cancellations`, `/approvals`, `/withdrawals`, `/sales-endings`. Svaret är `201` med resursen efter handlingen.
- **En schemalagd körning är `POST /v1/{sak}-runs`**, till exempel `/v1/renewal-runs` och `/v1/policy-proposal-expiry-runs`. Namnet börjar med samlingen den gäller.
- **En sökning med uppgifter som inte får stå i adressen**, som personnummer, är `POST /v1/{samling}/searches` **(CI)**.

## Inställningar

- **Inställningar ligger under `/v1/settings/{namn}`** **(CI):** `/v1/settings/roles`, `/v1/settings/retention` och `/v1/settings/notices`.
- **`GET` ger versionen som gäller, och `.../versions` ger alla.** En ändring är `POST .../versions` med `basedOnVersion` och `reason`, och svaret är `409` om någon annan hann före.

## Parametrar och fält

- **Fält och parametrar i camelCase** **(CI)**.
- **Sökvägsparametrar:**
  - Ett id heter `{xId}` och har ett mönster med sitt prefix, till exempel `^pol_[A-Za-z0-9]+$` **(CI)**.
  - Naturliga nycklar behåller sina namn: `{product}`, `{version}`, `{series}`, `{kind}`, `{code}` och `{seq}`.
- **Var något är i sin livscykel heter `status`, aldrig `state`** **(CI)**.
- **Ett filter på en part heter `{roll}PartyId`** **(CI)**. Rollerna är `owner`, `policyholder` och `recipient`. En ny roll läggs till i `PARTY_ROLES` i `conventions.ts`.
- **Datum som `YYYY-MM-DD`**, i marknadens kalender. Tidpunkter enligt RFC 3339 i UTC.
- **Belopp som heltal i minsta enhet**, med valutan en gång per objekt (ADR 0014).
- **Marknaden är alltid uttalad** på det som hör till en marknad.

## Id

Ett id är ett prefix, ett understreck och bokstäver och siffror, till exempel `pol_91c2…`. Prefixet visar typen:

| Prefix | Typ | Prefix | Typ |
| --- | --- | --- | --- |
| `clm_` | skada | `pol_` | policy |
| `ani_` | djur | `pty_` | part |
| `lit_` | kull | `app_` | ansökan |
| `pgr_` | grupp av policyer | `ppr_` | förslag om policy |
| `ptx_` | policytransaktion | `pev_` | händelse från policymodulen |
| `era_` | begäran om radering | `ntc_` | kundmeddelande |
| `ndl_` | utskick av meddelande | `rdr_` | förbehåll |
| `pv_` | policyversion | `aev_` | händelse från djurregistret |
| `dec_` | skadebeslut | `prp_` | beslutsförslag i en skada |
| `rvw_` | begäran om prövning | `po_` | utbetalningsorder |
| `jrn_` | journal i ledgern | `dp_` | självriskperiod |
| `whs_` | prenumeration på webhooks | `whd_` | utskick av webhook |

Ett nytt prefix har två till fyra bokstäver och läggs till i tabellen. En skadas id väljs av den som anmäler skadan och får också innehålla `_`, till exempel `clm_otit_204311`.

## Versioner

"Version" betyder olika saker beroende på vad det gäller:

| Vad | Form | Exempel | Ändras när |
| --- | --- | --- | --- |
| API:t | `/v1/` i adressen | `/v1/policies` | Något bryter mot kontraktet efter att en kanal är i drift (ADR 0034) |
| Produktversion | Valfri text som bolaget sätter | `SE-HUND-PLUS@2026.1` | Bolaget publicerar en ny version av produkten (ADR 0023) |
| Regeluppsättning, tariff, prisvillkor, teckningsregler | Heltal per serie | `SE-HUND-UW@1` | En ny version publiceras med fyra ögon (ADR 0021) |
| Inställning | Heltal | `version: 3` | Någon ändrar rollerna, gallringen eller meddelandena |
| Beräkningsmodell | Namn med `.vN` | `tariff.v1`, `underwriting.v1` | Beräkningen ändras. Gamla modeller tas aldrig bort (ADR 0018). |
| Schema för innehåll | Namn med `.vN` | `renewal-notice.v1` | Ett fält ändras så att det bryter (ADR 0032) |
| Händelse | Typ med `.vN` | `petvold.policy.issued.v1` | Händelsens innehåll ändras så att det bryter (ADR 0033) |

En produktversion och en version av en regeluppsättning skrivs `{namn}@{version}`.

## Fel

- **`application/problem+json`** (RFC 9457), med `title` och, om det behövs, `detail` och `errors` per fält.
- **Statuskoder:**
  - `401` utan giltig token
  - `403` utan rättigheten
  - `404` för något som inte finns eller ligger utanför anroparens omfång (ADR 0016)
  - `409` för en konflikt med det som redan finns
  - `422` för ett anrop som bryter mot kontraktet eller en regel

## Listor

- **Varje lista svarar med `{ items, nextCursor? }`** och tar `limit` (1–200, förval 50) och `cursor` (ADR 0002).
- **Äldst först**, om inget annat står i operationens beskrivning.

## Övrigt

- **`Idempotency-Key`** krävs på anrop som skapar något.
- **Varje operation har en rättighet i `x-permission`** (ADR 0016), ett `operationId` i camelCase och en tagg **(CI)**.
- **Webhooks och händelser** beskrivs i AsyncAPI i steg 2 av ADR 0033. Till dess beskriver schemat `CloudEvent` i OpenAPI-kontraktet kuvertet.
