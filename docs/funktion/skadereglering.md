# Skadereglering

Hur skademotorn bedömer, räknar ut och beslutar ett ärende. Exemplen bygger på exempeldata: Bella, en labrador född 2019, försäkrad i Sverige. Samma siffror används i testerna.

## Flödet

1. **Förhandsbesked** *(valfritt)*. Kliniken eller kunden skickar en tänkt skada och får bedömningen tillbaka. Inget sparas, och inget försäkringsbelopp reserveras.
2. **Anmälan.** Skadan registreras med fakturarader, diagnos och behandlingsdatum. Motorn bedömer den direkt. Skickar klienten inget id eller skadenummer ger Petvold dem (ADR 0036), se [Skadenummer](#skadenummer).
3. **Automatiskt beslut eller handläggare.** Om alla regler går igenom och ersättningen är under produktens gräns beslutas skadan automatiskt. Annars hamnar den hos en handläggare.
4. **Beslut.** Handläggaren godkänner det som bedömningen föreslår eller avslår. Beslutet bokförs.
5. **Omprövning.** Om policyn ändras i efterhand bedöms ärendet om, till exempel om en ny självrisk gäller retroaktivt eller om policyn avslutas från ett tidigare datum. Det sker automatiskt när policymodulen ersätter den version som beslutet fattades på (`policy.version_superseded`). Om ersättningen ändras blir det ett nytt beslut som bokför skillnaden.

*(Planerat i M1: reserv när skadan anmäls, attest av beslut över en beloppsgräns, och utbetalning. Se ADR 0016.)*

## Arbetsköer

`GET /v1/claims` (rättighet `claims:read`) listar ärenden inom anroparens omfång, äldst först. Varje rad visar ärendet, var det står och det senaste beslutet. Det är underlaget för arbetsköer i ett gränssnitt.

| `status` | Betyder | Kö för |
| --- | --- | --- |
| `awaiting-decision` | Inget beslut än, eller ett förslag som skickats tillbaka | Handläggare |
| `awaiting-approval` | Ett förslag över gränsen väntar på attest | Attestant |
| `awaiting-information` | En begäran om komplettering väntar på kunden eller kliniken | – |
| `review-requested` | Kunden har begärt mänsklig prövning | Handläggare |
| `decided` | Beslutat och inget öppet | – |
| `withdrawn` | Kunden har återkallat anmälan, utan beslut | – |
| `dismissed` | Avvisat utan beslut, till exempel som dubblett | – |

Om flera stämmer gäller den som står först av `withdrawn` eller `dismissed`, `awaiting-approval`, `awaiting-information`, `review-requested`, `decided` och `awaiting-decision`. Fler lägen kan tillkomma (ADR 0036), så en klient ska visa ett okänt läge i stället för att fallera. Listan filtreras med `status`, `market`, `policyId` och `animalId`. En klinik ser bara sina egna ärenden och kundkanalen bara ärenden på sina försäkringar.

Varje rad har också `basisCompleteAt`, alltså när underlaget blev komplett (se [Komplettering](#komplettering)). En rad har `informationMissing` när den senaste begäran gick ut utan svar.

**Exempel:** `GET /v1/claims?status=awaiting-decision&market=SE&limit=20` ger handläggarens kö i Sverige, 20 åt gången.

## Komplettering

En handläggare kan begära underlag som saknas av kunden eller kliniken (ADR 0036). Ärendet väntar då i `awaiting-information` och kan inte beslutas förrän begäran är besvarad, återkallad eller har gått ut.

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/claims/{id}/information-requests` | `claims:request-information` | Begär komplettering med `recipient` (`customer` eller `clinic`), `items`, `note` och ett valfritt `dueDate` |
| `GET /v1/claims/{id}/information-requests` | `claims:read` | Ärendets begäranden, äldst först |
| `POST …/information-requests/{requestId}/answers` | `claims:register` | Underlaget har kommit in, med ett valfritt `receivedAt` och `note` |
| `POST …/information-requests/{requestId}/cancellations` | `claims:request-information` | Begäran behövs inte längre, med `reason` |

- **Vad som saknas** anges som koder: `itemised-invoice` (specificerad faktura), `medical-record` (journal), `referral` (remiss) och `other`. Fritexten i `note` säger resten. Den stannar i Petvold.
- **Påminnelse och svarsdatum** kommer från produktens skaderegler, `informationRequest.reminderAfterDays` (standard 14) och `expiresAfterDays` (standard 30), räknat från dagen för begäran i marknadens tid. Handläggaren kan välja ett eget svarsdatum, efter i dag och högst ett år fram. En påminnelse som skulle infalla på eller efter svarsdatumet utelämnas. Begäran sparar vilka regler dagarna kom från (`rulesVersion`).
- **En begäran per mottagare.** Kunden och kliniken kan ha var sin öppen begäran samtidigt. Det går inte att begära komplettering på ett stängt ärende eller när ett förslag väntar på attest.
- **Körningen `claims.information-requests`** går varje morgon klockan 06:00 i varje marknad (se [Körningar](korningar.md)). Den markerar påminnelsen på påminnelsedagen och låter begäran gå ut dagen efter svarsdatumet. Svarsdatumet är alltså den sista dagen att svara.
- **En utgången begäran avslår inte ärendet.** Ärendet går tillbaka till kön med markeringen att underlaget inte kom in (`informationMissing`). Bara en person får avslå på den grunden, och lagen tillåter bara nedsättning om försummelsen har skadat bolaget (FAL 7 kap. 2 §).
- **Ett sent svar** registreras ändå. Det stänger även en utgången begäran, och markeringen försvinner.
- **Ett stängt ärende** återkallar sina öppna begäranden med samma skäl.
- **Kunden får ett meddelande** när en begäran till kunden görs, påminns och går ut: `claim-information-request`, `claim-information-reminder` och `claim-information-expired`. Bolaget kan stänga av det sista i inställningarna. En begäran till kliniken ger inget meddelande. Se [Meddelanden](meddelanden.md).

**Klockan för FAL 7 kap. 1 §.** Ersättningen ska betalas senast en månad efter att utredningen som skäligen kan begäras har lagts fram. Ärendet visar därför `basisCompleteAt`, som räknas fram så här:
- Utgångspunkten är när ärendet togs emot.
- Ett svar flyttar tiden till när underlaget kom in (`receivedAt`).
- En begäran som gått ut flyttar tiden till utgången, eftersom handläggaren sedan beslutar på det som finns.
- En återkallad begäran behövdes inte och flyttar inte tiden.
- Medan en begäran är öppen saknas `basisCompleteAt`.

`GET /v1/claims/{id}` visar också `daysSinceBasisComplete`. Back office visar hur många dagar som är kvar av de 30. Ett beslut som fattas mer än 30 dagar efter att underlaget var komplett märks i historiken.

**Exempel:**

```
POST /v1/claims/clm_048213/information-requests
Idempotency-Key: 6f1c…
{ "recipient": "clinic", "items": ["itemised-invoice", "medical-record"],
  "note": "Specificerad faktura och journalen från första besöket." }

201 { "id": "inf_…", "status": "open", "dueDate": "2026-12-20", "remindOn": "2026-12-04",
      "rulesVersion": "SE-HUND-VV@1", … }
```

## Reglerna

Varje bedömning prövar reglerna i denna ordning och visar resultatet för var och en. Utfallet är *godkänd* (pass), *avslag* (fail), *granskas* (review) eller *information* (info).

| Regel | Prövar | Avslag när | Granskas när |
| --- | --- | --- | --- |
| `POLICY_FOUND` | Finns en policy som gällde behandlingsdagen? | Ingen policy gällde | |
| `MARKET_CURRENCY` | Samma marknad och valuta på skadan och policyn | Olika marknad eller valuta | |
| `ANIMAL_MATCHES` | Skadan gäller det försäkrade djuret | Annat djur | |
| `POLICY_ACTIVE` | Policyn är aktiv | Policyn är uppsagd | Policyn upphör under behandlingen |
| `COVERAGE` | Policyn har momentet veterinärvård | Momentet saknas | |
| `WAITING_PERIOD` | Karenstiden från första tecknandet har passerat | Behandlingen började under karenstiden | |
| `DIAGNOSIS_KNOWN` | Diagnosen finns i produktens diagnosgrupper | | Okänd diagnos |
| `RIDER` | Undantag (klausuler) för just detta djur | Diagnosen är undantagen | Diagnosen är i samma grupp som ett undantag |
| `LIMIT` | Försäkringsbeloppet räcker | | *(info)* Ersättningen begränsas av återstående belopp |

**Förslag till beslut:**
- Om någon regel ger avslag, eller ersättningen blir 0, föreslås *avslag*.
- Om ersättningen begränsas av försäkringsbeloppet, eller om delar av fakturan inte ersätts, föreslås *delvis godkänd*.
- Annars föreslås *godkänd*.

**Automatiskt beslut** kräver att alla regler är godkända eller information, att förslaget inte är avslag, och att ersättningen är högst produktens gräns för automatisk reglering (`autoSettleMax`).

**Varför en handläggare.** `GET /v1/claims/{claimId}/assessment` svarar med `routing`: `mode` och en lista med skäl, var och ett med `reason`, `params` och text på anroparens språk.

| Skäl | Betyder | `params` |
| --- | --- | --- |
| `routing.rule_review` | En regel kräver att en handläggare granskar | `code`, `rule` |
| `routing.rule_fail` | En regel är inte uppfylld | `code`, `rule` |
| `routing.proposal_rejected` | Förslaget är avslag utan att någon regel säger varför | – |
| `routing.above_auto_limit` | Ersättningen är över gränsen för automatisk reglering | `payout`, `limit`, `currency` |

Listan är tom när ärendet kan regleras automatiskt. Den räknas fram när bedömningen läses och sparas inte med beslutet, så sparade bedömningar räknas om exakt som förut.

## Rättelse

En uppgift som registrerats fel rättas med `POST /v1/claims/{id}/corrections` (rättighet `claims:register`, ADR 0036). Anropet har de nya uppgifterna, ett skäl (`reason`) och revisionen som rättas (`expectedRevision`).

- **Vad som går att rätta:** behandlingsdagarna, diagnoskoden, fakturaraderna och kanalen. Uppgifter som utelämnas behåller sitt värde.
- **Vad som inte går att rätta:** policy, djur, marknad och valuta, eftersom de styr försäkringsbeloppet och självriskperioderna. Ett ärende på fel policy avvisas och registreras på nytt.
- **Revisioner:** ärendet har `revision`, 1 som registrerat och en till för varje rättelse. Tidigare revisioner sparas och ändras aldrig. `GET /v1/claims/{id}/revisions` visar varje revision med uppgifterna och rättelsen.
- **Beslutet** sparar vilken revision det fattades på (`claimRevision`). Underlaget i beslutet har hela ärendet som det var, så gamla beslut räknas om som förut.
- **En annan revision emellan** ger `409`. Den som rättar har då sett en gammal version.
- **Rättelse går inte** på ett stängt ärende eller när ett förslag väntar på attest.

**Rättelse efter ett beslut:**

| Senaste beslutet | Efter rättelsen |
| --- | --- |
| Fattat av en person | Ärendet öppnas igen (`reopened`), läget blir `awaiting-decision`, och en person fattar ett nytt beslut. Maskinen ersätter aldrig en persons bedömning, och en omprövning efter en policyändring väntar också. |
| Automatiskt, samma utfall och belopp | Beslutet står kvar. |
| Automatiskt, annat utfall som fortfarande får beslutas automatiskt | Ett nytt automatiskt beslut fattas på den nya revisionen, och skillnaden bokförs. Det kommer i svaret (`decision`). |
| Automatiskt, men ärendet behöver nu en handläggare | Ärendet öppnas igen för en person. |

**Exempel:**

```
POST /v1/claims/clm_048213/corrections
Idempotency-Key: 9a2e…
{ "diagnosisCode": "ORA-OTIT", "reason": "Journalen säger öroninflammation.", "expectedRevision": 1 }

201 { "correction": { "revision": 2, "fields": ["diagnosisCode"], "reopens": false, … },
      "claim": { "revision": 2, … }, "decision": null }
```

## Bilagor

Faktura, journal, remiss, foto och andra dokument kopplas till ärendet som referenser till bolagets arkiv (ADR 0036). Petvold sparar aldrig filen, bara adressen och kontrollsumman. Arkivet har redan åtkomstkontroll och gallring.

| Anrop | Rättighet |
| --- | --- |
| `POST /v1/claims/{id}/attachments` | `claims:register` |
| `GET /v1/claims/{id}/attachments` | `claims:read` |

- **En bilaga har:**
  - typ: `invoice`, `medical-record`, `referral`, `photo` eller `other`
  - mediatyp och storlek i byte
  - kontrollsumma (sha256)
  - adressen i arkivet: en `https`-adress eller en URN
  - vem som lade till den och när
  - valfritt den begäran om komplettering den svarar på
- **En bilaga ändras aldrig.** En ny kan ersätta den (`replaces`), till exempel en bättre skanning, och en bilaga ersätts bara en gång.
- **Beviset:** varje beslut sparar de bilagor som gällde när det fattades, med id och kontrollsumma. De visas i förklaringen under `basis.attachments`. Bilagorna är inte indata till reglerna, så de ingår inte i `inputHash`, och gamla beslut räknas om som förut.
- **Ett stängt ärende** får inga bilagor.

**Exempel:**

```
POST /v1/claims/clm_048213/attachments
{ "kind": "invoice", "mediaType": "application/pdf", "size": 184320,
  "sha256": "9f2c…", "url": "https://arkiv.bolaget.se/docs/7c1f9e2a" }
```

## Stänga utan beslut

Ett ärende som inte ska prövas kan stängas innan det beslutas (ADR 0036). Det går inte att ångra.

| Anrop | Rättighet | När |
| --- | --- | --- |
| `POST /v1/claims/{id}/withdrawals` med `reason` | `claims:register` | Kunden drar tillbaka anmälan |
| `POST /v1/claims/{id}/dismissals` med `reasonCode`, `reason` och vid dubblett `duplicateOf` | `claims:decide` | `duplicate`, `registered-in-error` eller `not-a-claim` |

- **Bara före ett beslut.** Ett beslutat ärende rättas eller omprövas i stället, och beslut tas aldrig bort. Ett stängt ärende kan inte beslutas. Båda reglerna finns också i databasen.
- **Vid avslutet** skickas ett öppet förslag tillbaka och öppna begäranden om komplettering återkallas, båda med skälet. Reserven löses upp. Inget av försäkringsbeloppet förbrukas, och ingen självriskperiod öppnas.
- **En avvisning är inte ett avslag.** Kunden får inget beslut, ingen förklaring och ingen rätt till prövning. En dubblett ska inte ge kunden ett avslag.
- **Ärendet visar avslutet** i `closure`: typ, skälkod, motivering, dubblettens ärende, vem och när.
- **Händelserna** `claim.withdrawn` och `claim.dismissed` går till webhooks utan motiveringen, som kan innehålla personuppgifter.

## Skadenummer

Ett ärende har ett id (`clm_…`) och ett skadenummer som människor använder, till exempel `S-2026-000123`. Båda är unika.

- **Utan id eller skadenummer** i anmälan ger Petvold dem. Skadenumret består av marknadens prefix, året då skadan kom in räknat i marknadens tidszon, och nästa nummer i årets serie med sex siffror.
- **Serien gäller hela installationen** och börjar om varje år. Två marknader får aldrig samma nummer, inte heller med olika prefix.
- **Prefixet** är en inställning per marknad (`PETVOLD_CLAIM_NUMBER_PREFIX`, till exempel `SE=S,NO=N`). Utan inställning är prefixet `S`.
- **En klient med egna nummer**, till exempel ett äldre skadesystem, kan fortsätta skicka dem. Ett nummer som redan används ger `409`. Serien hoppar över nummer som en klient redan har tagit.
- **En förhandsbedömning** tar inget nummer ur serien.

| Anmälan | Marknad | Kom in | Skadenummer |
| --- | --- | --- | --- |
| Utan nummer, första i året | SE, prefix `S` | 2026-11-13 14:00 UTC | `S-2026-000001` |
| Utan nummer | SE, prefix `SKD` | 2026-12-31 23:30 UTC (2027 i Stockholm) | `SKD-2027-000001` |
| Med eget nummer `S-2026-000001` | SE | | `S-2026-000001`, och serien hoppar sedan över det |

## Beräkningen

Steg för steg, i den ordning motorn räknar:

1. **Fakturerat:** summan av fakturaraderna.
2. **Ersätts inte:** rader i kategorier som produkten aldrig ersätter, till exempel foder.
3. **Moms:** om produkten inte ersätter moms dras momsen på övriga rader bort.
4. **Underlag** = fakturerat − ej ersättningsbart − moms.
5. **Fast självrisk:** dras om ingen självriskperiod är öppen för djuret och diagnosgruppen (eller på varje skada, beroende på produkten). Aldrig mer än underlaget.
6. **Rörlig självrisk:** en procentsats av det som är kvar. Satsen kan öka med djurets ålder. Avrundas till närmaste öre, halvt uppåt.
7. **Att betala före tak** = underlag − fast − rörlig självrisk.
8. **Tak:** ersättningen begränsas till det som återstår av årets försäkringsbelopp.
9. **Kundens del** = fakturerat − ersättning.

### Exempel 1: öroninflammation, automatiskt beslut

Bella behandlas 4 juni 2026. Fakturan är på 4 000 kr: undersökning 650 kr och öronspolning med medicin 3 350 kr. Villkoren är fast självrisk 2 000 kr per period om 125 dagar, rörlig självrisk 25 % och försäkringsbelopp 60 000 kr.

| Steg | Belopp |
| --- | ---: |
| Fakturerat | 4 000,00 kr |
| Underlag | 4 000,00 kr |
| Fast självrisk (ingen öppen period) | − 2 000,00 kr |
| Rörlig självrisk 25 % av 2 000 kr | − 500,00 kr |
| **Ersättning** | **1 500,00 kr** |

Alla regler går igenom och 1 500 kr är under gränsen på 10 000 kr, så skadan beslutas automatiskt. En självriskperiod öppnas för diagnosgruppen *öra* i 125 dagar. En ny öronskada inom perioden får ingen fast självrisk: en skada på 4 000 kr ger då 3 000 kr.

### Exempel 2: korsbandsoperation, till handläggare

Bella opereras 11–13 november 2026. Fakturan är på 18 640 kr och innehåller 420 kr för foder.

| Steg | Belopp |
| --- | ---: |
| Fakturerat | 18 640,00 kr |
| Ersätts inte (foder) | − 420,00 kr |
| Underlag | 18 220,00 kr |
| Fast självrisk | − 2 000,00 kr |
| Rörlig självrisk 25 % av 16 220 kr | − 4 055,00 kr |
| **Ersättning** | **12 165,00 kr** |

Två skäl gör att skadan hamnar hos en handläggare. Ersättningen är över 10 000 kr. Dessutom har Bella en klausul för hälta i höger bakben, och korsbandet hör till samma diagnosgrupp (*ortopedi bakben*), så regeln `RIDER` ger *granskas*. Förslaget är *delvis godkänd*, eftersom fodret inte ersätts.

## Försäkringsbeloppet

Varje beslut bokförs i en ledger med dubbel bokföring. Förbrukat försäkringsbelopp räknas fram ur bokföringen per djur, moment, försäkringsår och valuta. Det finns ingen separat räknare som kan glida isär från bokföringen.

Anropet `GET /v1/policies/{policy}/limits?onDate=` visar årets försäkringsbelopp, vad som förbrukats och vad som återstår.

## Beslut och spårbarhet

- **Beslut mot rätt underlag.** Varje bedömning har en kontrollsumma (`inputHash`) över allt som påverkar den. En handläggare skickar med den när hon eller han beslutar. Om underlaget har ändrats sedan dess, till exempel om en annan skada har förbrukat försäkringsbelopp, avvisas beslutet med 409 och en ny bedömning behövs.
- **Allt sparas.** Beslutet innehåller hela bedömningen: regelversion, produktversion och den policyversion som användes.
- **Beviskedja (ADR 0018).** Med varje beslut sparas exakt det underlag motorn bedömde: ärendet med fakturarader, policyutdraget, självriskperioden, förbrukat belopp och produktens regler. Dessutom sparas beräkningsmodellen (till exempel `vet-care.v1`) och Petvolds version. Underlaget ger samma kontrollsumma som bedömningen, och om det körs genom motorn igen blir bedömningen identisk. Databasen vägrar spara ett beslut utan underlag, och underlaget kan aldrig ändras.
- **Omräkning.** Ett sparat beslut kan räknas om från sitt underlag: `POST /v1/claims/{id}/decisions/{seq}/replays`. Svaret säger om resultatet blev identiskt, och annars exakt vilka värden som skiljer sig. Inget sparas och inget bokförs. Om motorn inte längre har beräkningsmodellen som användes, sägs det uttryckligen i stället för att svaret gissas fram.
- **Avvikelse från förslaget kräver motivering.** Om handläggaren avslår ett ärende som bedömningen föreslår att godkänna, krävs rättigheten `claims:override`, en skälkod och en fritext. Beslutet märks `deviatesFromProposal`, så att avvikelser kan följas upp. Skälkoder: `pre_existing_condition` (fanns före försäkringen), `not_covered` (omfattas inte), `insufficient_documentation` (underlag saknas), `incorrect_invoice` (felaktig faktura), `other` (annat).
- **Vad visste vi då?** En bedömning kan göras som den hade sett ut vid en viss tidpunkt (`knownAt`), till exempel innan en retroaktiv ändring registrerades.
- **Omprövning bokför skillnaden.** Om ersättningen går från 1 500 kr till 1 700 kr bokförs 200 kr. Vid avslag i en omprövning återförs hela beloppet, och självriskperioden stängs.
- **Samma anrop två gånger.** Anrop som skapar något kräver en `Idempotency-Key`. Ett upprepat anrop med samma nyckel ger samma svar och skapar inget nytt.

## Attest och utbetalningsorder

Ett beslut med en ersättning över handläggarens beloppsgräns fattas inte direkt. Det blir ett **beslutsförslag** som någon annan måste attestera (ADR 0019). Gränserna ställs in per roll och valuta (se [Behörighet](behorighet.md#beloppsgränser-och-fyra-ögon)).

| Steg | Anrop | Vad händer |
| --- | --- | --- |
| 1. Handläggaren beslutar | `POST /v1/claims/{id}/decisions` | Inom gränsen: `201` och ett beslut. Över gränsen: `202` och ett förslag. Förslaget bokförs inte och öppnar ingen självriskperiod. |
| 2a. Attest | `POST /v1/claims/{id}/proposals/{p}/approvals` | En annan person med `claims:approve` attesterar. Motorn bedömer ärendet igen, och underlaget måste vara exakt detsamma som i förslaget. Beslutet bokförs med `decidedBy` (handläggaren) och `approvedBy` (attestanten). |
| 2b. Tillbaka | `POST /v1/claims/{id}/proposals/{p}/returns` | Attestanten skickar tillbaka förslaget med en motivering. Inget beslut fattas, och handläggaren kan besluta på nytt. |

Regler:
- **Fyra ögon.** Den som föreslog kan aldrig attestera sitt eget förslag.
- **Ett öppet förslag per ärende.** Medan förslaget är öppet går det inte att fatta något annat beslut i ärendet (`409`).
- **Samma underlag.** Har underlaget ändrats sedan förslaget, till exempel genom en retroaktiv policyändring eller en annan skada som förbrukat försäkringsbelopp, avvisas attesten (`409`). Förslaget skickas då tillbaka och görs om.
- **Avslag kräver aldrig attest**, eftersom ersättningen då är 0.
- **Automatiska beslut och omprövningar** följer produktens regler och kräver ingen attest.

**Exempel:** handläggarens gräns är 10 000 kr. Korsbandsoperationen i exempel 2 ger 12 165 kr, så beslutet blir ett förslag. Attestanten godkänner, och ett beslut på 12 165 kr bokförs med båda namnen.

**Utbetalningsorder.** Varje beslut som höjer ärendets ersättning skriver händelsen `claim.payout_ordered` med ökningen, valutan, försäkringen, kanalen och kliniken. En omprövning från 1 500 kr till 1 700 kr ger en order på 200 kr. En sänkning ger ingen order: återkrav är en öppen fråga. Betalningsmodulen (M5, ADR 0017) tar emot ordern och väljer mottagare, klinik eller kund.

**Reserv.** När en skada går till handläggare bokas den ersättning som bedömningen förväntar sig som en reserv i ledgern, i samma transaktion som skadan registreras. Korsbandsoperationen i exempel 2 reserverar alltså 12 165 kr. Reserven ligger kvar medan ärendet väntar på handläggare eller attest. Beslutet löser upp den i samma transaktion som det bokförs, oavsett om ersättningen beviljas eller skadan avslås. Automatiskt reglerade skador och skador som bedömningen föreslår att avslå får ingen reserv.

*Inte byggt än:* reserven justeras inte om bedömningen ändras innan beslutet, och det finns ännu ingen summering av alla öppna reserver (den kommer med läsmodellen Insikt).

## Förklaring och mänsklig prövning

GDPR ger den som berörs av ett automatiskt beslut rätt att förstå logiken bakom beslutet (artikel 13–15). Den som berörs har också rätt att få beslutet prövat av en människa, att framföra sin synpunkt och att bestrida beslutet (artikel 22). Petvold stödjer det så här (ADR 0018).

**Automatiska beslut är märkta.** Varje beslut har `automated`.
- `true`: ingen människa bedömde utfallet. Det gäller automatisk reglering och omprövning, eftersom en omprövning följer motorns förslag utan att någon prövar det.
- `false`: en handläggare fattade beslutet.

**Förklaring per beslut:** `GET /v1/claims/{id}/decisions/{seq}/explanation`. Förklaringen byggs bara av det sparade beslutet och dess underlag, så den ser likadan ut i dag som om fem år. Samma svar kan visas för kund, handläggare och revisor. Den innehåller:

| Del | Innehåll |
| --- | --- |
| `mainReason` | Det enda skäl som bäst förklarar utfallet (se nedan) |
| `rules` | Alla regler motorn prövade, i ordning |
| `steps` | Beräkningen steg för steg. Avdrag är negativa, så stegen summerar till ersättningen. Tom vid avslag. |
| `deviation` | Handläggarens skälkod och motivering, om beslutet avviker från förslaget |
| `humanReview` | Om kunden kan begära mänsklig prövning nu, och en öppen begäran om det finns en |
| `basis` | Regelversion, produktversion, policyversion, kontrollsumma, beräkningsmodell och motorns version |

Huvudskälet väljs i den här ordningen:
1. handläggarens avvikelse (`deviation.<skälkod>`)
2. den första regeln som inte uppfylldes, till exempel `waiting.within`
3. inget att ersätta (`decision.nothing_payable`)
4. delvis ersättning (`decision.partial`)
5. hel ersättning (`decision.approved`)

Varje del har en stabil nyckel (`reason`) och värden (`params`). Texten (`message`) kommer på det språk som anges i `Accept-Language`.

**Exempel:** förklaring av öroninflammationen i exempel 1, på svenska.

| Steg | Belopp | Text |
| --- | ---: | --- |
| `billed` | 4 000 kr | Fakturerat belopp |
| `deductible_fixed` | −2 000 kr | Fast självrisk |
| `deductible_variable` | −500 kr | Rörlig självrisk, 25 % |
| `payout` | 1 500 kr | Ersättning |

Huvudskälet är `decision.approved`: "Ersättning beviljas med hela beloppet efter självrisk, 1 500,00 kr". `humanReview.available` är `true`.

Om skadan kommer inom en öppen självriskperiod ersätts raden för fast självrisk av `deductible_fixed_in_period` med beloppet 0 kr och periodens datum.

**Begäran om mänsklig prövning:** `POST /v1/claims/{id}/decisions/{seq}/review-requests`, med kundens synpunkt i `statement` (valfri, högst 4 000 tecken). Rättigheten är `claims:request-review`. Regler:
- Prövning kan bara begäras för ärendets senaste beslut, och bara om det är automatiskt. Annars svarar Petvold 409. Den som är missnöjd med en handläggares beslut har en annan väg: försäkringsbolagets klagomålshantering.
- Ett ärende har högst en öppen begäran åt gången.
- Begäran är öppen tills en handläggare fattar nästa beslut i ärendet. Det beslutet är prövningen. Det får `reviewRequestId` och stänger begäran i samma transaktion.
- Prövningen följer samma regler som andra beslut. Handläggaren kan bekräfta beslutet eller avvika med skälkod och motivering.
- En automatisk omprövning under tiden stänger inte begäran.

`GET /v1/claims/{id}/review-requests` visar ärendets begäranden, öppna och stängda.

*Inte byggt än:* tidsgräns för när prövningen ska vara klar, påminnelser och kö för handläggare. De kommer med ärendehanteringen i M6.

## Skadebesked

Varje beslut, också en omprövning, blir ett skadebesked till försäkringstagaren (`claim-decision`, ADR 0036). Beskedet innehåller:
- utfall och belopp
- huvudskälet och beräkningen steg för steg, med samma nycklar som beslutets förklaring
- handläggarens motivering när beslutet gick mot förslaget
- om beslutet var automatiskt, och om kunden kan begära att en person prövar det
- bolagets text om hur beslutet prövas

Meddelandemodulen läser beslutet genom en port till skademotorn, aldrig dess tabeller. Bolagets dokumentsystem gör brevet. Se [Meddelanden](meddelanden.md).

## Händelser

Händelser skrivs i samma transaktion som ändringen:

| Händelse | När |
| --- | --- |
| `claim.registered` | En skada registreras |
| `claim.decided` | Ett beslut fattas |
| `claim.decision_proposed` | Ett beslut över gränsen blir ett förslag |
| `claim.proposal_returned` | Ett förslag skickas tillbaka |
| `claim.payout_ordered` | Ett beslut höjer ersättningen |
| `claim.review_requested` | Kunden begär mänsklig prövning |
| `claim.information_requested` | En handläggare begär komplettering |
| `claim.information_reminded` | En öppen begäran når sin påminnelsedag |
| `claim.information_received` | Underlaget har kommit in |
| `claim.information_expired` | Svarsdatumet har passerat utan svar |
| `claim.information_cancelled` | En begäran återkallas, eller ärendet stängs |
| `claim.withdrawn`, `claim.dismissed` | Ärendet stängs utan beslut |
| `claim.attachment_added` | En bilaga läggs till, med adress och kontrollsumma |
| `claim.corrected` | Ärendet rättas och får en ny revision. Händelsen säger vilka fält som ändrades, inte värdena eller skälet. |

Händelserna levereras minst en gång, i ordning. Bolagets system får dem med [webhooks](webhooks.md), utan den sökandes ord eller vem som beslutade (ADR 0033).
