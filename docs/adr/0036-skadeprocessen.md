# 0036. Skadeprocessen: komplettering, rättelse, avslut utan beslut, bilagor och skadenummer

- Status: Beslutad
- Datum: 2026-11-17

## Sammanhang

Skademotorn kan registrera, bedöma och besluta en skada, med attest, prövning och omprövning (ADR 0018, 0019). Ett ärende har i dag fyra lägen som räknas fram ur det som finns sparat: väntar på beslut, väntar på attest, prövning begärd och beslutad.

Det räcker inte för att reglera skador från början till slut:

- **Underlaget är ofta ofullständigt.** Fakturan saknar specifikation, journalen saknas, eller diagnosen behöver förklaras. Handläggaren måste kunna begära komplettering, och ärendet måste visa att det väntar på någon annan.
- **Uppgifter blir fel.** En fakturarad, en diagnoskod eller ett datum kan vara fel registrerat. I dag går ett ärende inte att ändra.
- **Alla ärenden ska inte beslutas.** En dubblett, ett ärende registrerat av misstag eller en anmälan som kunden drar tillbaka ska kunna avslutas utan ett beslut om ersättning.
- **Underlaget består av dokument.** Faktura och journal är beslutets underlag och måste gå att visa i efterhand (ADR 0018).
- **Skadenumret väljs av klienten.** Det ger krockar och nummer som inte följer en serie.

Lagen ställer krav på tiden. Skaderegleringen ska ske skyndsamt, och ersättningen ska betalas senast en månad efter att den ersättningsberättigade har anmält försäkringsfallet och lagt fram den utredning som skäligen kan begäras. Annars ska bolaget betala dröjsmålsränta (FAL 7 kap. 1 §). Petvold måste därför veta när underlaget blev komplett.

Utbetalningen kommer med betalningsmodulen (M5, ADR 0017) och ingår inte här. Skadebeskedet till kunden finns redan förutsett i ADR 0032.

## Beslut

1. **Ärendets lägen.** Två lägen kommer till, och ett ärende kan stängas utan beslut.

   | Läge | Betyder | Kommer från |
   | --- | --- | --- |
   | `awaiting-information` | En begäran om komplettering är öppen | ny |
   | `withdrawn` | Kunden har återkallat anmälan | ny, stängt |
   | `dismissed` | Ärendet är avvisat, till exempel som dubblett | ny, stängt |
   | `awaiting-approval`, `review-requested`, `decided`, `awaiting-decision` | som i dag | ADR 0018, 0019 |

   Läget räknas fortfarande fram ur det som är sparat, i den här ordningen: stängt, väntar på attest, väntar på komplettering, prövning begärd, beslutat, väntar på beslut. Köerna i back office och filtret `status` på `GET /v1/claims` får de nya lägena.

2. **Komplettering.**
   - **Begäran:** `POST /v1/claims/{claimId}/information-requests` med mottagare (`customer` eller `clinic`), vad som saknas som koder (`itemised-invoice`, `medical-record`, `referral`, `other`), en fritext och ett svarsdatum. Kräver den nya rättigheten `claims:request-information`.
   - **Svar:** `POST …/information-requests/{requestId}/answers` registrerar att underlaget har kommit, med bilagor (punkt 5). Begäran stängs, och ärendet går tillbaka till kön.
   - **Påminnelse och utgång:** en körning skickar en påminnelse efter ett antal dagar och låter begäran gå ut på svarsdatumet. Antalet dagar finns i produktens skaderegler (`informationRequest.reminderAfterDays`, standard 14, och `expiresAfterDays`, standard 30). Reglerna är versionerade och kan styrkas.
   - **En utgången begäran avslår inte ärendet.** Det går tillbaka till en handläggare med markeringen "underlaget kom inte in". Bara en person får avslå på den grunden (ADR 0018), och FAL 7 kap. 2 § ger bara rätt att sätta ned ersättningen om försummelsen har skadat bolaget.
   - **Kunden får ett meddelande när begäran går ut,** om den gick till kunden: underlaget har inte kommit, ärendet ligger kvar, och en handläggare beslutar på det underlag som finns. Lagen kräver inte meddelandet, så bolaget kan stänga av typen i sina inställningar för meddelanden (ADR 0032).
   - **Klockan för FAL 7 kap. 1 §:** ärendet får `basisCompleteAt`, alltså när det registrerades eller när den senaste begäran besvarades. Kön kan sorteras på den, och `daysSinceBasisComplete` visas. Ett beslut som fattas senare än 30 dagar efter `basisCompleteAt` märks i ärendet.

3. **Rättelse.**
   - `POST /v1/claims/{claimId}/corrections` med de nya uppgifterna (behandlingsdagar, diagnoskod, fakturarader och kanal), ett skäl och `expectedRevision`. Kräver `claims:register`.
   - **Ärendet får revisioner.** `Claim` får `revision`, och tidigare revisioner sparas och kan hämtas (`GET …/revisions`). Bedömningen och besluten pekar på den revision de gjordes på. Underlaget i beviskedjan har redan hela ärendet, så omräkningen av gamla beslut påverkas inte.
   - **Policy, djur, marknad och valuta går inte att rätta.** De styr försäkringsbeloppet och självriskperioderna. Ett ärende på fel policy avvisas och registreras på nytt.
   - **Rättelse efter ett beslut:**
     - Var det senaste beslutet automatiskt, omprövas ärendet som vid `reassess` i dag. Ett nytt beslut fattas bara om utfallet ändras, och skillnaden bokförs.
     - Var det fattat av en person, öppnas ärendet igen och väntar på ett nytt beslut av en person. Maskinen ska inte ersätta en persons bedömning.

4. **Avslut utan beslut.**
   - **Återkallelse:** `POST /v1/claims/{claimId}/withdrawals` med skäl, när kunden drar tillbaka anmälan. Kräver `claims:register`.
   - **Avvisning:** `POST /v1/claims/{claimId}/dismissals` med en skälkod (`duplicate`, `registered-in-error`, `not-a-claim`) och vid dubblett `duplicateOf`. Kräver `claims:decide`.
   - **Bara före ett beslut.** Efter ett beslut gäller rättelse eller omprövning. Ett beslut tas aldrig bort.
   - **Vid avslutet** stängs öppna begäranden om komplettering, och öppna förslag skickas tillbaka. Reserven löses upp i samma transaktion. Ett stängt ärende förbrukar inget försäkringsbelopp och öppnar ingen självriskperiod.
   - **Avvisning är inte avslag.** Ett avslag är ett beslut om ersättning, med förklaring och rätt till prövning. En avvisning säger att ärendet inte ska prövas i den här formen.

5. **Bilagor som referenser.**
   - En bilaga har typ (`invoice`, `medical-record`, `referral`, `photo`, `other`), mediatyp, storlek, kontrollsumma (sha256), adressen i bolagets dokumentarkiv, vem som lade till den och när.
   - **Petvold sparar inte filen.** Det följer ADR 0032: dokumenten finns i bolagets arkiv, och Petvold har adressen och kontrollsumman. Fakturor och journaler innehåller personuppgifter, och arkivet har redan gallring och åtkomstkontroll.
   - `POST /v1/claims/{claimId}/attachments` och `GET …/attachments`. Kräver `claims:register` för att lägga till och `claims:read` för att läsa.
   - **En bilaga ändras aldrig.** Den kan bara ersättas av en ny.
   - **Bilagorna blir en del av beviset.** Varje beslut sparar vilka bilagor (id och kontrollsumma) som fanns när det fattades. De ingår inte i `inputHash`, eftersom de inte är indata till reglerna, och gamla beslut räknas om som förut.
   - **Uppladdning från back office kommer senare,** med ett enkelt dokumentarkiv i Petvold som får ett eget beslut. Tills dess anger man bilagans adress. Bilagans adress kan då peka på Petvolds arkiv eller på bolagets, utan att skademotorn ändras.

6. **Skadenummer från servern.**
   - `claimNo` och `id` blir valfria i `ClaimInput`. Utan dem ger servern `id` (`clm_…`) och ett skadenummer ur en serie per installation och år, till exempel `S-2026-000123`. Prefixet är en inställning per marknad.
   - En klient som redan skickar egna nummer fortsätter att fungera, och numret är fortfarande unikt.
   - Back office slutar föreslå nummer.

7. **Skadebesked till kunden.** Meddelandemodulen skapar `claim-decision` när ett beslut fattas, som ADR 0032 har förutsett.
   - Beskedet innehåller som fält:
     - utfall och belopp
     - huvudskälet och eventuell avvikelse från förslaget
     - beräkningen steg för steg
     - om beslutet var automatiskt
     - hur kunden begär prövning och klagar
   - Begäran om komplettering till kunden ger `claim-information-request`, påminnelsen `claim-information-reminder` och utgången `claim-information-expired`. Den sista kan bolaget stänga av, eftersom lagen inte kräver den.
   - Meddelandemodulen läser inte skademotorns tabeller (ADR 0001). Den får det den behöver från händelsen och från en port för förklaringen som kompositionsroten kopplar till skademotorn.

8. **Händelser.**
   - Nya händelser:
     - `claim.information_requested`, `claim.information_received`, `claim.information_expired`
     - `claim.corrected`, `claim.withdrawn`, `claim.dismissed`
     - `claim.attachment_added`
   - De går ut via webhooks utan personuppgifter (ADR 0033) och läggs till i `asyncapi.yaml`.
   - Gallringen (ADR 0028) räknar ett stängt ärende som skademotorns senaste aktivitet med parten, på samma sätt som ett beslut.

9. **Rättigheter.** Det kommer en ny rättighet, `claims:request-information`. Handläggarrollen får den. Rättelse och återkallelse ingår i `claims:register` och avvisning i `claims:decide`, eftersom avvisning stänger ärendet utan prövning.

10. **Ordning.** Varje steg har kontraktet först och är en egen PR:
    1. skadenummer från servern
    2. lägen, återkallelse och avvisning
    3. komplettering med påminnelse och utgång, och `basisCompleteAt`
    4. rättelse med revisioner
    5. bilagor som referenser
    6. skadebesked och meddelanden om komplettering

    Back office får varje del i samma PR som API:t.

## Konsekvenser

- **Hela skadeprocessen före utbetalning finns i Petvold.** Handläggaren kan arbeta med ett ärende från anmälan till beslut utan att lämna back office.
- **Fristen i FAL 7 kap. 1 § går att följa upp.** `basisCompleteAt` visar när underlaget var komplett och vilka ärenden som riskerar dröjsmålsränta. Räntan beräknas i M5.
- **Ärendet blir föränderligt genom revisioner.** Lagringen, både Postgres och minnet, och den gemensamma testsviten för `ClaimsStore` måste klara revisioner. Det mesta av arbetet ligger i rättelse efter beslut, eftersom självriskperioder och förbrukat belopp ska stämma.
- **Tre nya lägen i varje kö, filter och webhook.** En klient som räknar med fyra lägen behöver uppdateras. Kontraktets beskrivning av `status` säger därför att nya lägen kan tillkomma, och klienter ska visa ett okänt läge i stället för att fallera.
- **Bilagor som referenser** gör att Petvold inte kan visa en fil utan bolagets arkiv. Det är ett medvetet val, men det gör demon fattigare tills porten för lagring finns.
- **Påminnelser och utgång kräver en schemalagd körning**, som förnyelsen och utgången av förslag. Den behöver samma lås vid flera instanser som reläet.

## Alternativ

- **Låta en utgången komplettering avslå ärendet automatiskt.** Valdes bort. Ett avslag kräver en persons bedömning enligt ADR 0018, och lagen kräver att försummelsen har skadat bolaget.
- **Ändra ärendet på plats utan revisioner.** Valdes bort, eftersom det bryter beviskedjan: man skulle inte se vad ett beslut fattades på.
- **Avvisning som ett avslag med en egen skälkod.** Valdes bort. Ett avslag ger rätt till prövning och ett skadebesked, och förbrukar en plats i historiken som ett beslut. En dubblett ska inte ge kunden ett avslag.
- **Spara bilagorna som filer i Petvold.** Valdes bort för nu. Det skulle ge Petvold ansvar för lagring, virusskydd, gallring och åtkomst till dokument med personuppgifter, som bolagets arkiv redan har. Porten för lagring öppnar för det senare.
- **Ett eget fält för läge, sparat på ärendet.** Valdes bort. Att räkna fram läget ur det som är sparat har fungerat och kan inte hamna i otakt med begäranden, förslag och beslut.

## Källor

- [Försäkringsavtalslagen (2005:104)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/forsakringsavtalslag-2005104_sfs-2005-104/):
  - 7 kap. 1 §: skyndsam reglering, betalning inom en månad efter att utredningen lagts fram, och ränta enligt 6 § räntelagen
  - 7 kap. 2 §: nedsättning om anmälan eller medverkan försummats och det skadat bolaget
  - 7 kap. 4 §: talan inom tio år
- [Räntelagen (1975:635)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/rantelag-1975635_sfs-1975-635/), 6 §.
- [Dataskyddsförordningen (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj), artikel 22, om automatiserade beslut och rätten till prövning av en människa.
- ADR 0001, 0017, 0018, 0019, 0028, 0032, 0033 och 0034 i det här repot.
