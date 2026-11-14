# Skadereglering

Hur skademotorn bedömer, räknar ut och beslutar ett ärende. Exemplen bygger på exempeldata: Bella, en labrador född 2019, försäkrad i Sverige. Samma siffror används i testerna.

## Flödet

1. **Förhandsbesked** *(valfritt)*. Kliniken eller kunden skickar en tänkt skada och får bedömningen tillbaka. Inget sparas, och inget försäkringsbelopp reserveras.
2. **Anmälan.** Skadan registreras med fakturarader, diagnos och behandlingsdatum. Motorn bedömer den direkt.
3. **Automatiskt beslut eller handläggare.** Om alla regler går igenom och ersättningen är under produktens gräns beslutas skadan automatiskt. Annars hamnar den hos en handläggare.
4. **Beslut.** Handläggaren godkänner det som bedömningen föreslår eller avslår. Beslutet bokförs.
5. **Omprövning.** Om policyn ändras i efterhand, till exempel om en ny självrisk gäller retroaktivt, bedöms ärendet om. Om ersättningen ändras blir det ett nytt beslut som bokför skillnaden.

*(Planerat i M1: reserv när skadan anmäls, attest av beslut över en beloppsgräns, och utbetalning. Se ADR 0016.)*

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

Anropet `GET /v1/policies/{policy}/animals/{djur}/limits?onDate=` visar årets försäkringsbelopp, vad som förbrukats och vad som återstår.

## Beslut och spårbarhet

- **Beslut mot rätt underlag.** Varje bedömning har en kontrollsumma (`inputHash`) över allt som påverkar den. En handläggare skickar med den när hon eller han beslutar. Om underlaget har ändrats sedan dess, till exempel om en annan skada har förbrukat försäkringsbelopp, avvisas beslutet med 409 och en ny bedömning behövs.
- **Allt sparas.** Beslutet innehåller hela bedömningen: regelversion, produktversion och den policyversion som användes.
- **Beviskedja (ADR 0018).** Med varje beslut sparas exakt det underlag motorn bedömde: ärendet med fakturarader, policyutdraget, självriskperioden, förbrukat belopp och produktens regler. Dessutom sparas beräkningsmodellen (till exempel `vet-care.v1`) och Petvolds version. Underlaget ger samma kontrollsumma som bedömningen, och om det körs genom motorn igen blir bedömningen identisk. Databasen vägrar spara ett beslut utan underlag, och underlaget kan aldrig ändras.
- **Omräkning.** Ett sparat beslut kan räknas om från sitt underlag: `POST /v1/claims/{id}/decisions/{seq}/replays`. Svaret säger om resultatet blev identiskt, och annars exakt vilka värden som skiljer sig. Inget sparas och inget bokförs. Om motorn inte längre har beräkningsmodellen som användes, sägs det uttryckligen i stället för att svaret gissas fram.
- **Avvikelse från förslaget kräver motivering.** Om handläggaren avslår ett ärende som bedömningen föreslår att godkänna, krävs rättigheten `claims:override`, en skälkod och en fritext. Beslutet märks `deviatesFromProposal`, så att avvikelser kan följas upp. Skälkoder: `pre_existing_condition` (fanns före försäkringen), `not_covered` (omfattas inte), `insufficient_documentation` (underlag saknas), `incorrect_invoice` (felaktig faktura), `other` (annat).
- **Vad visste vi då?** En bedömning kan göras som den hade sett ut vid en viss tidpunkt (`knownAt`), till exempel innan en retroaktiv ändring registrerades.
- **Omprövning bokför skillnaden.** Om ersättningen går från 1 500 kr till 1 700 kr bokförs 200 kr. Vid avslag i en omprövning återförs hela beloppet, och självriskperioden stängs.
- **Samma anrop två gånger.** Anrop som skapar något kräver en `Idempotency-Key`. Ett upprepat anrop med samma nyckel ger samma svar och skapar inget nytt.

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

## Händelser

När en skada registreras, beslutas eller får en begäran om prövning skrivs en händelse (`claim.registered`, `claim.decided`, `claim.review_requested`) i samma transaktion. Händelserna levereras minst en gång, i ordning. I dag loggas de bara. Leverans till andra system (webhook eller kö) kommer när det finns en mottagare (ADR 0008).
