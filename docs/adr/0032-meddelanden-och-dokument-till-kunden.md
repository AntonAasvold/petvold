# 0032. Meddelanden och dokument till kunden

- Status: Föreslagen
- Datum: 2026-11-16

## Sammanhang

Granskningen 2026-11-15 (F2) visade att Petvold inte skickar något till kunden. Petvold skriver bara händelser. Lagen kräver däremot att kunden får vissa uppgifter, och ofta i en viss form:

- **Före avtalet (FAL 2 kap. 2 §).** Kunden ska få information som hjälper till att bedöma behovet och välja försäkring, och en sammanfattning av villkoren där viktiga begränsningar framgår. Vid distansavtal ska kunden i rimlig tid innan avtalet få uppgifter om bland annat pris och ångerrätt, och alla avtalsvillkor (distansavtalslagen 3 kap. 4–5 §§). Ångerfristen börjar inte förrän uppgifterna har kommit fram (3 kap. 17 §).
- **Formen (FAL 2 kap. 1 §, distansavtalslagen 3 kap. 8 §).** Uppgifterna ska lämnas i en handling eller i en annan läsbar och varaktig form, på svenska om kunden inte ber om något annat språk.
- **Efter avtalet (FAL 2 kap. 4 §).** Bolaget ska snarast skicka en skriftlig bekräftelse på avtalet, i praktiken ett försäkringsbrev. Om avtalet ingicks per telefon ska uppgifterna och villkoren lämnas snarast efteråt (distansavtalslagen 3 kap. 11 §).
- **Under försäkringstiden och vid förnyelse (FAL 2 kap. 5–6 §§, 3 kap. 5 §).** En ändring vid förnyelse ska anges skriftligen, senast samtidigt med kravet på premie.
- **Bolagets uppsägning:**
  - till förnyelsedagen skriftligen minst en månad före, med en fråga om kunden vill förnya (FAL 3 kap. 3 §)
  - under försäkringstiden skriftligen med fjorton dagars uppsägningstid (3 kap. 7 §)
  - för obetald premie med uppgift om att uppsägningen inte får verkan om premien betalas inom fjorton dagar efter att den skickades (5 kap. 2 §). Utan den uppgiften får uppsägningen ingen verkan.
- **Vägran att meddela eller förnya en försäkring (FAL 7 kap. 6 §).** Beskedet ska ange skälen och vad sökanden ska göra för att få beslutet prövat. Fristen för att väcka talan räknas från när beskedet skickades.
- **Faktablad.** Försäkringsdistributionsdirektivet (IDD) kräver ett standardiserat faktablad för sakförsäkring (artikel 20.5–20.8), med en form som kommissionen bestämt (genomförandeförordning (EU) 2017/1469).

En del av detta är text som bolaget skriver: villkor, faktablad och förköpsinformation. En del är besked om något som Petvold har beslutat: att en policy tecknats, förnyats eller sagts upp, eller att en ansökan avslagits. Ett försäkringsbolag har redan system för dokument, mallar, varumärke och utskick, till exempel brev, e-post och digital brevlåda. Däremot vet bara Petvold *när* ett besked krävs, *vad* det måste innehålla och *vilken* lag som kräver det.

ADR 0031 lämnade två frågor till det här beslutet: brevet med skälen vid avslag, och vilka dokument godkännandet gäller.

## Beslut

1. **Petvold avgör vad som ska skickas, men skapar och skickar inte själva dokumentet.** Ett **kundmeddelande** är en uppgift i Petvold: vilket besked, till vem, om vad, med vilket innehåll, enligt vilken lag och när det senast måste skickas. Bolagets dokumentsystem gör dokumentet med sina mallar, skickar det och rapporterar tillbaka till Petvold.

2. **En ny modul, `communications`, med ett eget schema** (ADR 0001):
   - Den skapar meddelanden från de andra modulernas händelser, via reläet (ADR 0008). Den läser policyer, ansökningar och parter genom portar, aldrig deras tabeller.
   - Samma händelse ger aldrig två meddelanden. Meddelandet har källans händelse-id som unik nyckel.

3. **Meddelandetyper i första versionen.** Varje typ har sitt lagrum per marknad i marknadsprofilen, med källa:

   | Typ | När | Krävs av (Sverige) |
   | --- | --- | --- |
   | `policy-confirmation` | `policy.issued` | FAL 2 kap. 4 § |
   | `renewal-notice` | `policy.renewed`, med ändringarna mot förra termen | FAL 2 kap. 5–6 §§, 3 kap. 5 § |
   | `insurer-termination` | `policy.cancelled` med bolagets skäl | FAL 3 kap. 3 och 7 §§, 5 kap. 2 § |
   | `cancellation-confirmation` | `policy.cancelled` med kundens skäl | Ingen lag. Kan stängas av. |
   | `application-declined` | `application.declined` | FAL 7 kap. 6 § |
   | `transfer-offer` | ett förslag om överlåtelse till den nya ägaren | ADR 0029 |

   Ett skadebesked (`claim-decision`) läggs till när skademotorns beslut ska nå kunden från Petvold. Kanalen visar dem i dag.

4. **Innehållet är data, inte text.** Varje typ har ett schema med versionsnummer (till exempel `renewal-notice.v1`) i kontraktet. Det innehåller allt som lagen kräver som egna fält, till exempel:
   - vid avslag: skälskoderna och hur sökanden får beslutet prövat
   - vid förnyelse: gammal och ny premie, produktversion och villkor
   - vid obetald premie: upphörandedagen och att uppsägningen inte gäller om premien betalas

   Dokumentsystemet kan inte glömma ett krav som finns som fält. Meddelandet har personens id, inte namn eller adress. Dokumentsystemet hämtar uppgifterna från parten när det skickar.

5. **Bolagets egna texter** ligger i en versionerad inställning per marknad, som gallringens inställning (ADR 0028), och ändras via API:t. Det gäller till exempel hur ett beslut prövas (bolagets klagomålsansvarige, Konsumenternas försäkringsbyrå och Allmänna reklamationsnämnden), avsändaren och vilka typer som inte krävs av lagen som ska skapas. Typer som lagen kräver kan inte stängas av.

6. **Livscykel och bevis:**
   - `pending`: skapat, med `dueBy` från lagen, till exempel en månad före termens slut.
   - `sent`: dokumentsystemet rapporterar kanal (brev, e-post, digital brevlåda, kundportal), tid, dokumentets id i bolagets arkiv och dess kontrollsumma (sha256).
   - `failed`: med orsak, till exempel en adress som saknas. Det hamnar i en kö för en person.
   - Ett meddelande som inte skickats vid `dueBy` syns i kön som försenat.

   Meddelandet och rapporten ändras aldrig, bara rapporten läggs till. Den som skickar ett meddelande igen gör det som en ny rapport.

7. **Lagens verkan följer tiden då beskedet skickades.** Bolagets uppsägning sparas redan med dagen den skickades (`receivedOn`, ADR 0029). Om rapporten anger en senare dag än uppsägningen räknades från, eller om meddelandet misslyckas, markeras uppsägningen för en person. Petvold ändrar inte upphörandedagen själv.

8. **Produktens dokument.** Produktversionen listar sina dokument per typ och språk:
   - villkor (`terms`)
   - förköpsinformation (`pre-contract`)
   - faktablad (`ipid`)

   Varje dokument har en adress i bolagets arkiv och en kontrollsumma (sha256). Listan låses med produktens kontrollsumma vid publicering (ADR 0023). Vid granskning måste villkor och faktablad finnas på marknadens språk.

9. **Godkännandet anger dokumenten som visades** (ADR 0031). `acceptance.documents` har typ, språk och kontrollsumma för de dokument kanalen visade. Petvold kontrollerar att de hör till produktversionen och svarar `422` annars. För en produkt med dokument kräver ett tecknande och en ansökan att villkoren och förköpsinformationen finns med.

10. **API:**
    - `GET /v1/notices?status=pending` för dokumentsystemet, och händelsen `notice.created`
    - `POST /v1/notices/{id}/deliveries` för att rapportera ett utskick eller ett fel
    - `GET /v1/notices?policyId=…` för handläggare och kundportalen (inom sitt omfång)

    Nya rättigheter: `notices:read` och `notices:deliver`. Ny roll: `document-service`.

11. **Gallring (ADR 0028).** Ett meddelande har en relation till mottagaren och gallras som policyn. Dokumentet finns i bolagets arkiv, och Petvold sparar bara referensen och kontrollsumman.

12. **Språk.** Partens språk, annars marknadens. Meddelandet anger språket, och dokumentsystemet väljer mall efter det.

## Konsekvenser

- **Bevis för varje besked.** Det går att visa vilket besked som krävdes, när det senast skulle skickas, att det skickades och vilket dokument det var.
- **Bolaget behåller sina system.** Bolaget behåller mallar, varumärke och utskickskanaler, men behöver koppla sitt dokumentsystem mot API:t. Petvold kan ha med en enkel adapter som skriver ut meddelandena, för utveckling.
- **Typerna och fälten blir en del av kontraktet.** En ny lagregel blir ett nytt fält eller en ny typ, med versionsnummer.
- **En ny modul och ett nytt relä.** Meddelandemodulen tar emot händelser från policymodulen och, med skadebesked, från skademotorn. Det ökar behovet av ett relä med lås vid flera instanser (öppet sedan #61).
- **Förköpsinformationen och villkoren går att styrka.** Godkännandet anger exakt vilka dokument som visades.
- **Det här ingår inte:**
  - mallar och att göra PDF i Petvold
  - kundens val av kanal och utskick som inte krävs (M6)
  - påminnelser om premie och fakturor (M5, F5)
  - meddelanden till kliniker

## Alternativ

- **Bara händelser, och kanalen skickar allt.** Det är enklast för Petvold, men varje kanal måste känna till lagen själv, och det går inte att visa att ett besked som lagen kräver blev skickat. Det är granskningens fynd.
- **En dokumentmodul i Petvold med mallar, PDF och utskick.** Det ger mest kontroll, men det gör samma sak som bolagets befintliga system och för in varumärke, typografi och tryckeri i kärnan. Mallarna skulle ändå skrivas av bolaget.
- **Meddelanden i policymodulen.** Policymodulen vet när ett besked krävs, men ansökningar, skador och parter har också besked. En egen modul samlar kön, bevisen och kanalerna på ett ställe.
- **Fri text i meddelandet i stället för fält.** Det blir flexibelt, men ett krav som ett skäl eller en uppgift om premien kan inte kontrolleras.

## Källor

- Försäkringsavtalslag (2005:104), 2 kap. 1–2 och 4–6 §§, 3 kap. 3, 5 och 7 §§, 5 kap. 2 § och 7 kap. 6 §. lagen.nu/2005:104
- Lag (2005:59) om distansavtal och avtal utanför affärslokaler, 3 kap. 4, 5, 8, 11 och 17 §§ (kapitlet i lydelse från 2026-06-19). lagen.nu/2005:59
- Europaparlamentets och rådets direktiv (EU) 2016/97 om försäkringsdistribution (IDD), artikel 20. eur-lex.europa.eu
- Kommissionens genomförandeförordning (EU) 2017/1469 om ett standardiserat format för faktablad om försäkringsprodukter. eur-lex.europa.eu
- ADR 0001, 0008, 0023, 0028, 0029 och 0031.
