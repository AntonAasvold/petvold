# 0038. Dokument: PDF med Gotenberg, ett arkiv och tidsbegränsade länkar

- Status: Beslutad
- Datum: 2026-11-20

## Sammanhang

Petvold avgör vad kunden ska få veta, men gör inte själva dokumenten (ADR 0032). Bolagets dokumentsystem gör brevet från meddelandets fält och rapporterar tillbaka dokumentets id och kontrollsumma. Bilagor till skador är adresser i bolagets arkiv, och Petvold sparar aldrig filen (ADR 0036).

Det fungerar för ett bolag med ett eget dokumentsystem, men lämnar tre brister:

- **Ett bolag utan dokumentsystem** kan inte skicka beslutsbrev, försäkringsbrev eller avslag från Petvold. Det måste bygga det själv innan Petvold går att använda.
- **Bilagor går inte att ladda upp.** Handläggaren måste lägga filen i ett arkiv någon annanstans och skriva in adressen och kontrollsumman för hand.
- **Demon och utvecklingen har inga dokument.** Ett skadebesked går inte att se som ett brev.

Det behövs alltså ett sätt att göra PDF:er från Petvolds egna mallar, och en plats att lagra dem och bilagorna, med samma krav som resten av Petvold:

- **bevis:** det som skickades ska gå att visa i efterhand, oförändrat (ADR 0018)
- **dataskydd:** dokumenten innehåller personuppgifter, och åtkomsten och gallringen måste följa ADR 0016 och 0028
- **rent ursprung och licenser** som tillåter användning i drift hos ett försäkringsbolag (ADR 0009)

## Beslut

1. **En ny modul, `documents`, med ett eget schema och en egen roll** (`documents_service`, ADR 0001).
   - Modulen är den enda som pratar med dokumentmotorn och arkivet.
   - Andra moduler sparar bara dokumentets id, aldrig filen eller en adress.

2. **PDF:er görs med [Gotenberg](https://gotenberg.dev) (MIT) i en egen container.**
   - **Bara på det interna nätet.** Petvold anropar den, och den nås aldrig utifrån.
   - **Petvold gör underlaget.** Modulen fyller mallen med data och skickar färdig HTML, typsnitt och bilder till Gotenberg. Gotenberg gör bara om det till PDF.
   - **Gotenberg lagrar ingenting.** Den gör om HTML till PDF och glömmer den. Lagringen är arkivets (punkt 4).
   - **Utan nätåtkomst.** Chromium i Gotenberg får inte hämta något utanför anropet, så att en mall eller data inte kan få den att nå interna adresser (SSRF). Typsnitt, bilder och stilmallar skickas med i anropet. Containern har ingen väg ut.
   - **Bakom en port** (`PdfRenderer`), så att en annan motor kan bytas in. LibreOffice ingår i Gotenberg, så Word-mallar kan läggas till senare utan att containern byts.
   - **PDF/A och PDF/UA.** Dokumenten ska gå att läsa om många år och med skärmläsare. Gotenberg gör PDF/A, och PDF/UA följer av mallarnas struktur och språkangivelse.

3. **Mallar i HTML och CSS, versionerade.**
   - En mall per dokumenttyp, marknad och språk, till exempel `claim-decision` för `SE` på `sv`. Typerna är meddelandenas (ADR 0032) och ingen annan.
   - Mallen använder designsystemets tokens (`design/tokens.json`). Ett brev ser alltså ut som resten av Petvold, men i tryck: svartvitt, ramar och tydlig typografi.
   - Mallarna fylls med meddelandets fält, aldrig med text som räknas fram i mallen. Beloppen formateras på marknadens sätt och texterna kommer från språkkatalogen, så att ett brev och back office säger samma sak.
   - Varje mallversion har en kontrollsumma. Dokumentet sparar mall, version och kontrollsumma, och en hash av datan det gjordes av. Samma data och mall ger då ett dokument som går att göra om och jämföra.
   - Mallarna finns i repot och versionsnumreras med Petvold. Bolagets egna mallar kan läggas till senare med samma livscykel som produkter och regler (utkast, granskning med fyra ögon, publicering).

4. **Ett arkiv med objektlagring.**
   - **Lagringen talar S3.** I drift är det bolagets lagring, till exempel en S3-tjänst i EU eller Ceph i egen drift. Lokalt och i CI är det [SeaweedFS](https://github.com/seaweedfs/seaweedfs) (Apache 2.0) i docker compose. MinIO var först föreslaget, men ger inte längre ut färdiga images för den fria versionen och har licensen AGPL v3.
   - **Bakom en port** (`DocumentStore`), med lagring i minnet för tester.
   - **Petvold sparar om varje dokument** i schemat `documents`:
     - id (`doc_…`), typ (genererat eller uppladdat), mediatyp, storlek och sha256
     - vilket ärende, vilken policy eller vilket meddelande det hör till
     - vilka parter det gäller: mottagaren av ett meddelande, och försäkringstagaren för en policy eller ett ärende när dokumentet skapades
     - för ett genererat dokument mall, version och data-hash
     - vem som skapade det och när
     - gallringsdatum
   - **Filen ändras aldrig.** Nyckeln i lagringen är dokumentets id, och kontrollsumman prövas när filen sparas och när den läses. Ett dokument ersätts av ett nytt, som bilagor (ADR 0036).
   - **Uppladdning:** `POST /v1/documents` tar emot en fil, högst 25 MB, av en tillåten mediatyp (PDF, JPEG, PNG, HEIC). Petvold räknar kontrollsumman själv och litar inte på klientens. Virusskanning kan läggas till bakom en port innan filen blir läsbar. Tills dess är uppladdade filer bara läsbara för den som har rätt att se ärendet.

5. **Ingen permanent adress. Systemen sparar dokumentets id, och en länk skapas när den behövs.**
   - **Ett permanent hemligt id i en adress fungerar som en nyckel.** Om adressen vidarebefordras, hamnar i en logg eller läcker via referer kan vem som helst läsa dokumentet, för alltid, och det går inte att stoppa (W3C TAG, *Good Practices for Capability URLs*).
   - **`POST /v1/documents/{documentId}/links`** ger en signerad adress som slutar gälla, till exempel efter 15 minuter för en kundportal som hämtar en ny vid varje klick, eller efter 7 dagar i ett mejl. Högsta giltighetstid är en inställning, med förvalet 7 dagar.
   - **Adressen går inte att gissa och avslöjar ingenting.** Den innehåller ett slumpat id för länken och en signatur, inte dokumentets id, ärendet eller kunden. Svaret sätter `Cache-Control: no-store`, `Referrer-Policy: no-referrer` och `Content-Disposition` med ett neutralt filnamn.
   - **Varje länk sparas och varje hämtning loggas,** med vem som skapade länken, för vem och när den hämtades. Det svarar på frågan "vem har sett dokumentet" vid en begäran om tillgång (GDPR artikel 15).
   - **En länk kan spärras,** och ett dokument som gallrats, eller hör till en part som anonymiserats, ger inga nya länkar och gamla slutar fungera.
   - **Länken lämnas ut av Petvold, inte av arkivet.** Arkivets egna förhandssignerade adresser (S3 presigned URL) används inte mot kunden, eftersom de inte går att spärra eller logga per länk och avslöjar lagringens adress.

6. **Rättigheter.**

   | Åtgärd | Rättighet |
   | --- | --- |
   | Läsa dokumentets uppgifter och skapa en länk för egen läsning | Samma som det dokumentet hör till, till exempel `claims:read` för en bilaga och `notices:read` för ett meddelande |
   | Ladda upp en bilaga | `claims:register` |
   | Skapa en länk till kunden | `documents:share`, en ny rättighet. Rollen `customer-channel` och dokumentsystemet får den. |
   | Spärra en länk | `documents:share` |

   Omfånget gäller som för ärenden (ADR 0016): en klinik ser bara dokument på sina egna ärenden, och kundkanalen bara på sina policyer.

7. **Kopplingen till meddelanden och bilagor.**
   - **Meddelanden (ADR 0032):** en inställning per marknad avgör vem som gör dokumentet, `petvold` eller `insurer`. Med `petvold` gör `documents` PDF:en när meddelandet skapas, och meddelandet får dokumentets id och sha256. Utskicket rapporterar som i dag kanal och tid, men inte dokumentet, som redan finns. Med `insurer` är allt som i dag. Förvalet är `insurer`, så inget ändras för den som redan har ett dokumentsystem.
   - **Bilagor (ADR 0036):** en uppladdad fil blir en bilaga med adressen `urn:petvold:doc:{documentId}`. Det följer det format bilagan redan har, så skademotorn ändras inte. Bilagor med en adress i bolagets arkiv fungerar som förut.
   - **Back office** visar dokumentet genom en länk som skapas när någon klickar och gäller i 15 minuter.

8. **Alla dokument för en kund.**
   - **`GET /v1/parties/{partyId}/documents`** listar kundens dokument, nyast först, med typ, datum, vad det hör till och var det finns. `GET /v1/documents?partyId=` listar bara Petvolds arkiv.
   - **Kopplingen till kunden sparas när dokumentet skapas,** från det det hör till. En kund som byter, till exempel vid en överlåtelse, ser de dokument som gällde hen, inte den nya ägarens.
   - **Dokument i bolagets arkiv tas med.** Ett meddelande som bolagets dokumentsystem gjorde (inställningen `insurer`) och en bilaga med en adress i bolagets arkiv får en rad med typ, datum, kontrollsumma och bolagets dokument-id eller adress. Filen öppnas då i bolagets arkiv och inte genom Petvold. Kunden får alltså en enda lista, var dokumentet än ligger.
   - **Listan visar bara det anroparen får se:** dokument på ärenden kräver `claims:read`, meddelanden `notices:read` och policydokument `policies:read`, inom anroparens omfång (ADR 0016). Det krävs också `parties:read` för att lista per kund.
   - **I back office** får kundens sida kortet "Dokument" med alla kundens dokument. Ett klick öppnar dokumentet genom en länk som gäller i 15 minuter. Ett dokument i bolagets arkiv öppnas där.
   - **Vid en begäran om tillgång (GDPR artikel 15)** är listan, tillsammans med loggen över hämtningar, underlaget för vilka dokument Petvold har om personen och vem som har sett dem.
   - **Vid anonymisering (ADR 0028)** tas kopplingen till parten bort med parten, och dokumenten gallras enligt punkt 9.

9. **Gallring (ADR 0028).**
   - Ett dokument gallras med det det hör till: ett meddelande, ett ärende eller en policy. Gallringsdatumet räknas fram när dokumentet skapas och flyttas om det det hör till får längre tid.
   - **Gallring tar bort filen** ur lagringen och behåller raden med kontrollsumman, typen och datumen, så att det går att visa att dokumentet fanns och att det gallrats.
   - Gallringen är en körning bland de andra (ADR 0037), `documents.retention`.
   - I kundens lista syns ett gallrat dokument med typ och datum, men det går inte att öppna.

10. **Ordning,** med kontraktet först och en PR per steg:
    1. modulen `documents` med arkivet: porten, SeaweedFS i docker compose, lagringen i minnet, uppladdning med kopplingen till kunden, och länkar med logg och spärr
    2. uppladdning av bilagor från back office med `urn:petvold:doc:`, och kortet "Dokument" på kundens sida, med meddelanden och bilagor i bolagets arkiv
    3. Gotenberg i docker compose, porten `PdfRenderer` och de första mallarna: skadebesked och försäkringsbrev
    4. meddelanden som PDF med inställningen `petvold` eller `insurer`
    5. gallring av dokument som en körning

## Konsekvenser

- **Ett bolag utan dokumentsystem kan använda Petvold.** Beslutsbrev, försäkringsbrev och avslag kommer som PDF med bevis.
- **Handläggaren ser alla kundens dokument på ett ställe,** också de som ligger i bolagets arkiv, och det går att svara på en begäran om tillgång.
- **Två tjänster till i drift:** Gotenberg och en S3-lagring. Gotenberg är tillståndslös och skalar som andra containrar. Lagringen är bolagets. Installationen får nya inställningar: lagringens adress, nyckel och hink, Gotenbergs adress, och nyckeln som signerar länkar.
- **Petvold får ansvar för filer med personuppgifter.** Det kräver kryptering i vila i lagringen, åtkomstlogg och gallring, som punkt 4, 5 och 8 beskriver. Ett bolag som vill behålla det ansvaret själv kan fortsätta med sitt eget arkiv och sitt dokumentsystem.
- **Mallarna blir en del av beviset.** En ändrad mall är en ny version. Ett gammalt dokument visas som det gjordes, inte som mallen ser ut i dag.
- **Länkarna kräver en tjänst som svarar,** eftersom länken går genom Petvold och inte direkt till lagringen. Det är priset för att kunna spärra och logga.

## Alternativ

- **Carbone.** Valdes bort på grund av licensen (Carbone Community License), som begränsar användning i drift.
- **PDF i Petvolds egen process,** till exempel med Puppeteer eller pdf-lib. Valdes bort. Chromium i samma process som Petvold ger en större yta mot angrepp och mer minne per server. En egen container går att låsa ner utan nät.
- **Permanenta adresser som inte går att gissa.** Valdes bort enligt punkt 5. De går inte att spärra, och en läckt adress gäller för alltid.
- **Arkivets förhandssignerade adresser direkt till kunden.** Valdes bort enligt punkt 5. De går inte att spärra eller logga per länk.
- **Filerna i Postgres.** Valdes bort. Databasen blir stor och säkerhetskopiorna långsamma, och objektlagring har redan livscykel, kryptering och replikering.
- **Bara bolagets dokumentsystem, som i dag.** Valdes bort som enda väg. Det finns kvar som inställningen `insurer` för den som vill.

## Källor

- [Gotenberg](https://gotenberg.dev): dokumentation och licens (MIT), med Chromium och LibreOffice.
- [W3C TAG: Good Practices for Capability URLs](https://w3ctag.github.io/capability-urls/): risker med hemliga adresser och råd om att de ska sluta gälla.
- [Amazon S3: presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), och [SeaweedFS](https://github.com/seaweedfs/seaweedfs) (Apache 2.0) som S3-kompatibel lagring för utveckling.
- ISO 19005 (PDF/A) och ISO 14289 (PDF/UA).
- [OWASP: Server Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
- [Dataskyddsförordningen (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj), artikel 5.1 e (lagringsminimering), 15 (rätt till tillgång) och 32 (säkerhet).
- ADR 0001, 0009, 0016, 0018, 0028, 0032, 0036 och 0037 i det här repot.
