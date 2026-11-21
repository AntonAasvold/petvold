# 0039. Partens livscykel: sökning på namn, nummer som tas bort, begränsning och avslut

- Status: Beslutad
- Datum: 2026-11-21

## Sammanhang

En part kan registreras, ändras, få personnummer eller organisationsnummer och raderas (ADR 0026 och 0028). Fyra saker saknas för att back office ska kunna sköta en kund hela vägen:

- **Hitta kunden.** Det går bara att söka på nummer eller part-id. En kund utan personnummer, eller en kund som ringer utan att ha numret till hands, går inte att hitta.
- **Rätta ett nummer.** Ett nummer som lagts till fel part, eller med en siffra fel, kan inte tas bort. Numret är unikt, så det kan inte heller läggas på rätt part.
- **Begränsa behandlingen.** Dataskyddsförordningen artikel 18 ger kunden rätt till begränsning, till exempel medan riktigheten i uppgifterna prövas. Det går i dag bara att begränsa genom att avslå en begäran om radering.
- **Avsluta en part.** En person som avlidit eller en organisation som upphört ska inte kunna bli försäkringstagare igen. Uppgifterna ska ändå finnas kvar tills gallringen tar dem.

## Beslut

1. **Sökning på namn och e-post** med `POST /v1/parties/searches` och `{ "text": "…" }`.
   - Söktexten ligger i anropets body, som numren, och hamnar aldrig i en adress eller logg.
   - Sökningen tar minst 2 tecken. Den hittar delar av namnet (förnamn och efternamn, eller organisationens namn) och e-postadressen, utan hänsyn till stora och små bokstäver.
   - Svaret har högst 50 parter, sorterade efter namn. Bara parter som inte är anonymiserade och som ligger på anroparens marknader kommer med. En begränsad part syns bara för den som har `parties:privacy`, som i dag.

2. **Ett nummer tas bort med ett skäl** (`POST /v1/parties/{id}/identifiers/{identifierId}/removals`, `parties:write`).
   - Varje nummer får ett id (`pid_`), eftersom ett personnummer visas maskerat och aldrig ska stå i en adress.
   - Numret finns kvar i historiken med vem, när och varför det togs bort. Det räknas inte längre när någon söker eller lägger till nummer, så det kan läggas till på rätt part.
   - Att rätta ett nummer är att ta bort det och lägga till det rätta.

3. **Begränsning sätts och hävs direkt**, med `POST /v1/parties/{id}/restrictions` (`{ until, reason }`) och `POST /v1/parties/{id}/restriction-liftings` (`{ reason }`). Båda kräver `parties:privacy`.
   - Begränsningen gäller till och med datumet, som när en radering avslås.
   - Den senaste händelsen gäller, oavsett om den kom från en avslagen radering eller direkt.
   - Fyra ögon krävs inte. Begränsning skyddar kunden, och att häva den loggas med vem och varför.

4. **En part avslutas** med `POST /v1/parties/{id}/endings` (`{ cause, on, reason }`, `parties:write`).
   - Orsaken är `deceased`, `dissolved` eller `other`, och datumet får inte ligga i framtiden.
   - En avslutad part kan inte bli försäkringstagare, ägare eller mottagare av något nytt, på samma sätt som en begränsad part (`marketOf` ger null).
   - Uppgifterna kan fortfarande ändras, till exempel adressen till ett dödsbo, och de gallras enligt ADR 0028.
   - Det går inte att avsluta en part som är försäkringstagare på en policy som löper. Policyn sägs upp eller överlåts först, och API:t svarar `409` med policyernas id.
   - Ett avslut som var fel ångras med `POST /v1/parties/{id}/reopenings` (`{ reason }`).

5. **Allt sparas som rader som aldrig ändras**, i modulens schema (migration 0049):
   - `party_identifier` får id och kolumner för borttagningen. Tjänsterollen får bara uppdatera dem, och bara en gång.
   - Begränsning och avslut är händelser i nya tabeller.
   - Anonymiseringen tar bort allt det här som tidigare.

## Konsekvenser

- Back office kan hitta, rätta, begränsa och avsluta en part utan att gå via API:t.
- Sökning på namn kan ge många träffar för vanliga namn. Gränsen på 50 och sökningen i body begränsar hur mycket som syns i ett svar.
- Ett avslut ändrar inte policyer, djur eller skador. De moduler som pekar på parten märker det bara när de ska peka på den igen.

## Alternativ som valdes bort

- **Sökning med en query-parameter** (`GET /v1/parties?name=`). Valdes bort: namnet skulle hamna i loggar.
- **Ändra numret på plats.** Valdes bort: historiken skulle försvinna.
- **Fyra ögon för att häva en begränsning.** Valdes bort för nu. Det kan läggas till om ett bolag kräver det, på samma sätt som för radering.
