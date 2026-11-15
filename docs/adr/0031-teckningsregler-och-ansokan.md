# 0031. Teckningsregler, ansökan och godkännande vid tecknande

- Status: Föreslagen
- Datum: 2026-11-15

## Sammanhang

Granskningen 2026-11-15 visade två luckor (F1 och F3):
- **Alla ansökningar godkänns.** Det finns inga åldersgränser, inga hälsofrågor och inga förbehåll vid tecknande. Skademotorn kan pröva förbehåll (`riders`), men inget i Petvold skapar dem.
- **Kundens godkännande sparas inte vid tecknande.** Vid överlåtelse sparas kanal, referens och tid (ADR 0029), men inte när en policy tecknas.

Lagen sätter ramarna för en konsumentförsäkring i Sverige:
- **Kontraktsplikt (FAL 3 kap. 1 §).** Bolaget får inte vägra en konsument en försäkring som det normalt erbjuder, om det inte finns särskilda skäl: risken för framtida försäkringsfall, den väntade skadans storlek, försäkringens art eller en liknande omständighet. Ett avslag får inte grundas på ett försäkringsfall som inträffat efter att ansökan skickats.
- **Skäl och prövning (FAL 7 kap. 6 §).** Om bolaget vägrar att meddela eller förnya en försäkring ska det lämna beslutet med skälen och upplysa om hur sökanden kan få det prövat.
- **Upplysningsplikt (FAL 4 kap. 1–2 §§).** Den som tecknar ska svara rätt och fullständigt på bolagets frågor. Ett felaktigt svar kan leda till att ersättningen sätts ned, och vid svek blir avtalet ogiltigt. Det förutsätter att det går att visa exakt vilka frågor som ställdes och vad som svarades.
- **Förköpsinformation (FAL 2 kap. 2 §).** Före tecknandet ska kunden få en sammanfattning av villkoren, och viktiga begränsningar ska framgå tydligt. Ett förbehåll för ett visst djur är en sådan begränsning.
- **Ansvarets början (FAL 3 kap. 2 §).** Om inget annat avtalats börjar ansvaret dagen efter ansökan eller godkännandet.

Andra marknader har liknande regler, till exempel den tyska Versicherungsvertragsgesetz (VVG) om upplysningsplikt (§ 19). Försäkringsbolag i Europa visar i sina publika villkor och ansökningsformulär för djurförsäkring:
- en högsta ålder när en ny försäkring tecknas, ofta lägre för veterinärvård än för liv
- en lägsta ålder, eftersom valpar och kattungar ska vara några veckor gamla
- hälsofrågor om tidigare sjukdomar och skador
- förbehåll som undantar en viss sjukdom eller kroppsdel för just det djuret

## Beslut

1. **Teckningsregler är en versionerad serie i `decisioning`**, som tariffen och prisvillkoren (ADR 0030).
   - Beräkningsmodellen heter `underwriting.v1`. Livscykeln är densamma: utkast, granskning, publicering med fyra ögon och kontrollsumma.
   - Produktversionen pekar på en serie med teckningsregler (`underwritingSeries`). En produkt utan serie godkänner alla ansökningar som i dag.
   - Reglerna som gäller på **ansökningsdagen** används, eftersom frågorna ställs den dagen.
2. **Innehåll.** Reglerna är data, inte kod:
   - **Ålder per art:** lägsta ålder i dagar och högsta ålder i år på startdagen. Åldersgränserna gäller nya försäkringar, inte förnyelse.
   - **Frågor:** varje fråga har ett id, en text per språk (som referensdatans etiketter, ADR 0022) och en svarstyp. Typerna är `boolean` (ja eller nej) och `diagnoses` (ja eller nej med diagnoskoder ur referensdatan).
   - **Regler för svaren:** om en fråga besvaras med ja blir utfallet något av följande:
     - `rider`: förbehåll för de angivna diagnoskoderna eller en fast lista
     - `refer`: manuell prövning
     - `decline`: avslag, med en skälskod
   - **Raser** kan ge `refer` eller `decline`, med skälskod.
   - Varje `decline` har en skälskod som kan förklaras på kundens språk, eftersom FAL 7 kap. 6 § kräver skäl.
3. **En ren funktion i en ny modul, `underwriting-core`.**
   - `underwrite(rules, input) → { outcome, riders, reasons, inputHash }`. Indata är art, ras, födelsedatum, startdag och svaren.
   - **Utfallen** är `accept`, `accept-with-riders`, `refer` och `decline`. Det strängaste vinner: avslag före manuell prövning, manuell prövning före förbehåll, förbehåll före godkännande.
   - Varje regel som prövats redovisas med kod och utfall, som i skademotorns bedömning (ADR 0018).
4. **Ansökan sparas i policymodulen.** `POST /v1/applications` tar det som `POST /v1/policies` tar i dag, plus `answers` och `acceptance`. Teckningsreglerna körs, och ansökan sparas med underlaget:
   - **`accept` och `accept-with-riders`:** policyn tecknas i samma transaktion. Förbehållen sparas på termen och följer med vid förnyelse.
   - **`refer`:** ansökan väntar på en person med den nya rättigheten `policies:underwrite` (rollen `underwriter`). Personen godkänner, med eller utan förbehåll, eller avslår. Beslutet kräver en motivering. Ett beslut om avslag kräver en skälskod.
   - **`decline`:** ansökan sparas som avslagen med skälen. Brevet till kunden hör till F2 (dokument och meddelanden).
   - **En ansökan kan återkallas** av kanalen så länge den väntar. En ansökan som väntat längre än en tid som ställs in per produkt löper ut.
   - `GET /v1/applications?status=referred` är kön för manuell prövning.
5. **Det som sparas går att styrka (ADR 0018).** Ansökan sparar teckningsreglernas version, kontrollsumma, indata med frågor och svar, utfallet, varje regels utfall och motorns version. Omräkning med samma underlag ger samma utfall. Vid en skada kan bolaget visa vilka frågor som ställdes och vad som svarades (FAL 4 kap. 2 §).
6. **Godkännandet vid tecknande (F3).** `acceptance` har:
   - kanalen och en referens, till exempel ett sessions-id eller en signatur
   - tiden då kunden godkände, som kanalen anger
   - tiden då Petvold tog emot ansökan

   Godkännandet gäller produktversionen och priset i svaret. Förköpsinformationen och villkoren som visades sparas som dokumentreferenser när F2 är beslutad. `POST /v1/policies` kräver också `acceptance`.
7. **`POST /v1/policies` finns kvar för produkter utan teckningsregler.** För en produkt med `underwritingSeries` svarar den `422` och hänvisar till `POST /v1/applications`. Den tas bort i nästa huvudversion av API:t.
8. **Ett förbehåll har ett ursprung.** `Rider` får `source` (`underwriting` eller `manual`) och, från teckningsreglerna, ansökans id och frågan. Skademotorn läser förbehållen som i dag.
9. **Händelser:** `application.received`, `application.referred`, `application.accepted` och `application.declined`. `policy.issued` har ansökans id.
10. **Gallring (ADR 0028).** Ansökan har en relation till sökanden. En avslagen eller återkallad ansökan gallras efter en tid som ställs in per marknad. En godkänd ansökan sparas lika länge som policyn.

## Konsekvenser

- Bolaget kan ställa in åldersgränser, hälsofrågor och förbehåll som data, med fyra ögon, utan en ny version av Petvold.
- Varje avslag har skäl, så att kraven i FAL 3 kap. 1 § och 7 kap. 6 § kan uppfyllas.
- Prisindikationen (`POST /v1/quotes`) kan köra teckningsreglerna med samma funktion, om svaren skickas med. Inget sparas då.
- Kanalerna går över från `POST /v1/policies` till `POST /v1/applications` för produkter med teckningsregler.
- Policymodulen får en ny tabell för ansökningar och en ny kö.
- Svaren kan avslöja djurets sjukdomar. Det är inte personuppgifter om djuret, men ansökan kopplas till en person och omfattas därför av gallringen.
- Det här ingår inte:
  - frågor som beror på varandra
  - beslut om vilka frågor som visas, som ligger i kanalen
  - förbehåll som läggs till efter tecknandet
  - en ny prövning vid förnyelse
  - ansökan från kundkanalen, som i dag är bunden till policyer och inte till en part. Den kommer när kundkanalen kan bindas till en part.

## Alternativ

- **Ingen sparad ansökan, utan `422` och manuellt beslut i ett nytt anrop,** som manuellt pris. Det är enklare, men då finns ingen kö för manuell prövning, och avslag sparas inte. Ett avslag ska kunna styrkas och ska ge ett brev med skäl.
- **Teckningsregler i produktversionen.** Frågor och gränser ändras oftare än villkoren, och av samma skäl ligger tariffen och skadereglerna utanför produkten (ADR 0021, 0030).
- **Teckningsregler i tariffen.** De avgör om och på vilka villkor en ansökan godkänns, inte priset. En tariffändring ska inte ändra vem som får försäkras.
- **Ett allmänt regelspråk för frågorna.** Det blir flexibelt men svårt att granska med fyra ögon och svårt att förklara för kunden. Fasta regeltyper räcker för det som syns i publika villkor. En ny typ blir en ny beräkningsmodell.

## Källor

- Försäkringsavtalslag (2005:104), 2 kap. 2 §, 3 kap. 1–2 §§, 4 kap. 1–2 §§ och 7 kap. 6 §. riksdagen.se och lagen.nu/2005:104
- Versicherungsvertragsgesetz (VVG) § 19, Tyskland, om upplysningsplikt. gesetze-im-internet.de
- Försäkringsbolags publika villkor och ansökningsformulär för djurförsäkring i Sverige och Europa, om åldersgränser, hälsofrågor och förbehåll.
- ADR 0007, 0018, 0021, 0022, 0028, 0029 och 0030.
