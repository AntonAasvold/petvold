# End-to-end-scenarier: en hel kundresa

Scenarierna följer en kund från första kontakten till att kunden lämnar: teckning, prövning, skada, livet med policyn och radering. Varje steg beskriver hur det testas för hand i back office och vad som ska hända. Sist finns en lista över det som saknas i gränssnittet för att täcka hela resan.

Petvold är headless. Kunden har inget eget gränssnitt, utan bolagets kanaler (webb, app, telefon) anropar API:t. I back office gör en handläggare det som kunden gör i en kanal.

## Förberedelser

1. Starta allt från tomt, så att exempeldatan och meddelandena skapas på nytt:
   ```
   npm run dev:reset
   npm run dev:up        # Postgres, SeaweedFS, Gotenberg och migreringar
   npm run roles:sync -- --apply
   npm run dev           # API:et på http://localhost:8787
   npm run ui:dev        # back office på http://localhost:5180
   ```
2. Logga in med en dev-token. `dev-all` når allt utom det som kräver fyra ögon. Använd rollerna nedan för att se att behörigheterna stämmer.

| Token | Roll | Används till |
| --- | --- | --- |
| `dev-registrar` | registrerar djur och parter | kund och djur |
| `dev-seller` | tecknar policyer | teckning, ändring, uppsägning och förslag |
| `dev-underwriter` | prövar ansökningar | manuell prövning |
| `dev-handler` | handläggare, beslutsgräns 25 000 kr | skador |
| `dev-approver` | attestant | belopp över handläggarens gräns |
| `dev-documents` | bolagets dokumentsystem | meddelanden och utskick |
| `dev-communications` | kommunikation | texter och vem som gör dokumenten |
| `dev-operations` | drift | körningar |
| `dev-privacy`, `dev-privacy-2` | dataskydd | radering med fyra ögon |

**Exempeldata:**
- Anna (`pty_owner001`) och Bella (`ani_bella`, `pol_bella`) har fyra skador, en i varje kö.
- Erik (`pty_owner002`) äger Doris.
- Sara (`pty_owner003`) äger Max, Ludde och Smilla.
- Kajsa, Rocky och Sixten är ansökningar: godkänd med ett undantag, hänvisad till prövning och avslagen.

**Tid:** dev-servern startar inte schemaläggaren. Förnyelse och utgång körs med "Kör nu" under Körningar.

## Scenario 1: ny kund tecknar en försäkring

**Mål:** en ny kund med en hund får en policy, ett försäkringsbrev och dokumentet i sin lista.

| # | Gör (token) | Förväntat |
| --- | --- | --- |
| 1 | `dev-registrar`: Parter → **Registrera part**. En person med namn, adress och språk sv. Knappen syns bara med rättigheten `parties:write`. | Partens sida öppnas med ett nytt `pty_`-id. |
| 1b | Parter → sök på en del av namnet, "Namn eller e-post". | Parten finns i listan över träffar med status Aktiv, och en rad öppnar partens sida. |
| 2 | Partens sida → **Registrera djur**: hund, ras, kön, födelsedag och chipnummer. Ägaren är redan ifylld. | Djurets sida visar ägaren. Partens sida visar djuret under "Djur som parten äger i dag". |
| 3 | `dev-all`: partens sida → djurlistan → **Teckna försäkring** på djuret. Det går också via Policyer → **Teckna försäkring**, med `dev-seller`. Välj ett startdatum och en produkt utan hälsofrågor, till exempel `SE-HUND-BAS@2026.1`. | Under "Pris" syns premien per år och per termin. Ett startdatum som ligger för långt fram nekas (`maxStartAheadDays`). |
| 4 | Prova kampanjkoden `PUPPY2026`. | Priset ändras, och koden syns i prisets underlag. |
| 5 | Kryssa i de dokument som kunden har fått se och tryck **Teckna försäkringen**. | "The policy is issued." visas, och policyns sida öppnas med termin, villkor och historik. |
| 6 | Försök teckna en gång till för samma djur och period. | Nekas, med texten att djuret redan är försäkrat. |
| 7 | `dev-documents`: Meddelanden → fliken Väntar. | Ett försäkringsbrev (`policy-confirmation`) för policyn, med "Skicka senast" om tre dagar och lagrummet FAL 2 kap. 4 §. |
| 8 | Öppna det och tryck **Gör PDF**. | En PDF/A skapas och visas under "PDF från Petvold". **Öppna** visar brevet med kundens namn och adress, djurets namn, villkoren och dokumenten. |
| 9 | **Rapportera ett utskick**: Skickat, kanal `digital-mailbox`, och dokument-id och sha256 från bolagets arkiv. | Status blir Skickat, och utskicket syns i tabellen. |
| 10 | `dev-all`: kundens sida → kortet **Dokument**. | Försäkringsbrevet finns med, både PDF:en från Petvold och utskicket från bolagets arkiv. |

**Variant 1b, Petvold gör breven:** som `dev-communications`, gå till Inställningar → Meddelanden → **Vem gör dokumenten**, välj Petvold, skriv ett skäl och tryck **Spara en ny version**. Teckna sedan en ny policy.
- **Förväntat:** försäkringsbrevet har en PDF utan att någon trycker "Gör PDF". "Dokumentet görs av" visar Petvold, och rapporten om utskick frågar bara efter kanal.
- **Utan Gotenberg:** inställningen nekas med ett meddelande om `PETVOLD_GOTENBERG_URL`.

## Scenario 2: ansökan med hälsofrågor och manuell prövning

**Mål:** en produkt med hälsofrågor ger en ansökan som godkänns, godkänns med ett undantag eller avslås.

| # | Gör (token) | Förväntat |
| --- | --- | --- |
| 1 | `dev-seller`: **Teckna försäkring** med `SE-HUND-PLUS@2026.1` för Saras hund Max. | Kortet **Hälsofrågor** visas, och en förhandsvisning säger vad svaren skulle ge. |
| 2 | Svara Ja på en fråga om tidigare öroninflammation och tryck **Skicka ansökan**. | Ansökan hänvisas till prövning och syns under Ansökningar. |
| 3 | `dev-underwriter`: öppna ansökan → **Pröva** → **Godkänn och teckna policyn**, med undantaget diagnoskoden `ORA-OTIT`. | Policyn tecknas, och undantaget syns under Förbehåll på policyns sida. |
| 4 | Skicka en ny ansökan för en annan hund och **Avslå** den med ett skäl. | Ansökan är avslagen, och ett meddelande `application-declined` skapas. |
| 5 | `dev-documents`: öppna avslaget under Meddelanden. | Märkt "Text saknas", eftersom bolagets text om hur ett beslut prövas inte finns. Avslaget ligger i kön. |
| 6 | `dev-communications`: Inställningar → Meddelanden. Fyll i "Hur ett beslut prövas (sv)" och spara. | Nya avslag blir kompletta. Ett avslag som redan skapats behåller det det skapades med. |
| 7 | Skicka en ansökan och **Återkalla** den innan den prövas. | Ansökan är återkallad och kan inte längre prövas. |

## Scenario 3: skada från anmälan till beslut

**Mål:** en skada regleras med karens, komplettering, attest, skadebesked och omprövning.

| # | Gör (token) | Förväntat |
| --- | --- | --- |
| 1 | `dev-handler`: Skador → **Registrera skada** på den nya policyn från scenario 1, med behandlingsdatum dagen efter start. | Förhandsvisningen visar avslag på grund av karens. Steget visar att karensen fungerar. |
| 2 | Registrera en skada på `pol_bella` med en faktura på 6 000 kr och diagnosen öroninflammation. | Ett beslut eller förslag med beräkningen steg för steg: fakturerat, det som inte ersätts, fast och rörlig självrisk. |
| 3 | Öppna en skada och **Begär komplettering** av kunden, till exempel en journal. | Skadan har status "Väntar på komplettering". Ett meddelande `claim-information-request` skapas. Tiden på en månad (FAL 7 kap. 1 §) räknas från när underlaget är komplett. |
| 4 | Ladda upp journalen som PDF under **Bilagor** → **Lägg till bilagan**, och registrera kundens svar. | Bilagan sparas i arkivet och öppnas med en länk som gäller i 15 minuter. Kompletteringen är besvarad. |
| 5 | Registrera en skada på över 25 000 kr och föreslå **Godkänn utbetalning**. | "Väntar på attest". Handläggaren kan inte attestera sitt eget förslag. |
| 6 | `dev-approver`: **Attestera**, eller **Skicka tillbaka till handläggaren**. | Beslutet fattas, eller förslaget går tillbaka med en kommentar. |
| 7 | `dev-documents`: skadebeskedet (`claim-decision`) under Meddelanden → **Gör PDF**. | PDF:en visar utfall, beräkning, eventuell motivering och bolagets text om hur man klagar. |
| 8 | `dev-handler`: **Begär prövning** för kundens räkning på ett automatiskt beslut. | "Prövning begärd". Ett nytt beslut av en person besvarar begäran. |
| 9 | Rätta skadan (rättelse) med ett nytt belopp, och **Ompröva**. | Rättelsen blir en ny revision. Ett nytt beslut fattas bara om utfallet ändras. |
| 10 | Registrera en dubblett och **Stäng utan beslut** (Avvisa skadan). | Stängd utan beslut. Inget betalas, och inget av försäkringsbeloppet används. |

## Scenario 4: livet med policyn

| # | Gör (token) | Förväntat |
| --- | --- | --- |
| 1 | `dev-seller`: policyns sida → **Ändra valen**, till exempel självrisken, från ett datum. | En ny version gäller från datumet och syns under "Versioner över tid". Premien räknas om. |
| 2 | **Förnya för hand**, eller som `dev-operations` Körningar → förnyelse → **Prova körningen** och **Kör nu**. | En ny termin skapas, och ett meddelande `renewal-notice` listar det som ändrats. Prova-körningen ändrar ingenting. |
| 3 | `dev-registrar`: djurets sida → **Ägarbyte** → **Byt ägare** till Erik. | Ett erbjudande om att ta över policyn skapas. Det syns under Förslag, och meddelandet `transfer-offer` skapas. |
| 4 | `dev-seller`: Förslag → **Godkänn**, med var den nya ägaren godkände. | Policyn har Erik som försäkringstagare från datumet. |
| 5 | **Säg upp policyn** med kundens uppsägning. Gör sedan **Ångra uppsägningen**. | Uppsägningen får ett slutdatum och ett meddelande `cancellation-confirmation`. Ångra återställer policyn. |
| 6 | Djurets sida → **Rätta uppgifterna** och ange ett dödsdatum. Godkänn sedan förslaget att avsluta policyn under Förslag. | Djuret märks "Dött" och kan inte byta ägare. Policyn avslutas från dödsdatumet först när förslaget har godkänts. |

## Scenario 5: kunden lämnar

| # | Gör (token) | Förväntat |
| --- | --- | --- |
| 0a | `dev-registrar`: lägg till ett personnummer på fel part. Tryck **Ta bort** vid numret, ange ett skäl och tryck **Ta bort numret**. Lägg sedan till numret på rätt part. | Numret visas under "Borttagna nummer", maskerat och med skälet. Det går att lägga till på den andra parten. |
| 0b | `dev-privacy`: partens sida → **Begränsning**. Ange ett datum och ett skäl och tryck **Begränsa behandlingen**. Häv sedan med **Häv begränsningen**. | Parten är märkt "Begränsad till". Den syns inte för `dev-registrar` vid sökning, men syns igen när begränsningen hävts. |
| 0c | `dev-registrar`: för Bellas ägare Anna (`pty_owner001`), **Avsluta parten** med orsaken Avliden. | Nekas, eftersom Anna är försäkringstagare på `pol_bella`. Svaret anger policyn. |
| 0d | Avsluta en part som inte har någon policy som löper, till exempel parten från 0a, med orsak, datum och skäl. Gör sedan **Öppna parten igen**. | Parten är märkt "Avslutad" med datumet, och Teckna försäkring och Registrera djur försvinner. När den öppnats igen är den aktiv. En policy som sagts upp löper till slutdatumet, och fram till dess kan försäkringstagaren inte avslutas. |
| 1 | `dev-privacy`: partens sida → **Begär radering**. | Begäran väntar på en andra person. Det som lagen kräver att bolaget sparar raderas inte. |
| 2 | `dev-privacy-2`: Radering → öppna begäran och godkänn den. | Parten anonymiseras. Namn och adress försvinner, men beslut och belopp finns kvar. |
| 3 | `dev-operations`: Körningar → gallringen → **Prova körningen**. | Listan visar vad som skulle gallras enligt inställningen för gallring per marknad. |

## Vad som saknas i gränssnittet

Kontrollerat mot kontraktet 2026-11-21: 18 av 143 operationer har inget gränssnitt i back office. Tabellen visar det som påverkar kundresan, och det som saknas i hela Petvold.

| Saknas | Var i resan | Läge | Testas i dag |
| --- | --- | --- | --- |
| **Premier, fakturor, betalningar och utbetalningar** | Efter teckning och efter beslut | Finns inte i Petvold (M5, ADR inte skriven). Resan slutar vid beslutet om belopp. | Går inte |
| **Kundens egen kanal** | Ansökan, svar på komplettering, begäran om prövning, godkänt erbjudande | Headless med avsikt. Handläggaren gör det i back office, eller kanalen anropar API:t med `dev-customer`. | API-sidan `/docs` med `dev-customer` |
| **Länk till dokument för kunden** (`audience: customer`) | Kunden öppnar sitt brev | Back office gör bara interna länkar. | API: `POST /v1/documents/{id}/links` |
| **Länkarna till ett dokument, och att spärra en länk** | Efter delning | Saknas i back office. | API: `GET …/links` och `…/revocations` |
| **Försäkringsbelopp som återstår** | Skada, i bedömningen | Saknas (färdplanen, "Skador"). | API: `GET /v1/policies/{id}/limits` |
| **Omräkning av ett sparat beslut** (ADR 0018) | Efter beslut, när beslutet ska styrkas | Saknas (färdplanen, "Skador"). | API: `POST …/decisions/{seq}/replays` |
| **Policyns ögonblicksbild och veterinärvillkoren** | Policyns sida | Saknas (färdplanen, "Policy"). | API: `GET /v1/policies/{id}/snapshot`, `…/vet-care-terms` |
| **PDF av andra meddelanden** | Förnyelse, uppsägning, avslag, komplettering, erbjudande | Mallar finns bara för skadebesked och försäkringsbrev. Övriga gör bolagets dokumentsystem. | Bara "Rapportera ett utskick" |
| **Klinikens uppslag av djur** | Kliniken anmäler en skada | `GET /v1/animal-summaries` har inget gränssnitt. | API med `dev-clinic` |
| **Kull i ett anrop** | Teckning för en uppfödare | Kullar registreras, men policyerna tecknas en i taget (färdplanen). | Teckna en per djur |
| **Översikt** | Startsidan för handläggaren | Saknas (färdplanen, "Översikt"). | Varje kö för sig |
| **Webhooks till en mottagare** | Bolagets system får händelser | Prenumerationer finns i back office, men mottagaren behövs utanför. | En lokal mottagare på `http://localhost` |
| **Simulering av regler och ändring av referensdata** | Inte kundens resa, men produktens | Saknas (färdplanen, "Regler" och "Referensdata"). | API |

**Förslag på ordning:** först försäkringsbeloppet som återstår och omräkningen, eftersom båda behövs för att styrka ett skadebeslut. Sedan länken till kunden och listan över länkar, så att resan från PDF till kund går att testa i gränssnittet. Premier och betalningar är den största luckan, men de kräver ADR:en för M5 först.
