# 0033. Händelser till bolagets system med webhooks

- Status: Beslutad
- Datum: 2026-11-16

## Sammanhang

Petvold skriver händelser till en outbox i varje modul (ADR 0008), och reläet levererar dem inom Petvold. Ingen händelse når bolagets andra system. Kontraktet beskriver `claim.registered` och `claim.decided` under `webhooks`, men reläet bara loggar dem. ADR 0008 sköt upp CloudEvents och AsyncAPI tills det fanns en mottagare utanför Petvold.

Nu finns flera mottagare:
- **Dokumentsystemet** behöver veta när ett kundmeddelande skapas (ADR 0032). I dag måste det fråga Petvold med jämna mellanrum.
- **Kundportalen** behöver veta när ett skadebeslut fattas och när en policy ändras.
- **Ekonomisystemet** behöver veta när en ersättning beställs (`claim.payout_ordered`) innan betalningarna (M5) finns i Petvold.
- **CRM och datalager** behöver veta när policyer tecknas, förnyas och avslutas.

Händelser kan inte byggas som en webhook per händelse. Varje mottagare skulle då behöva sin egen lösning för signatur, omförsök och felhantering. Det som behövs är ett gemensamt sätt att leverera alla händelser som bolaget får prenumerera på.

## Beslut

1. **En ny modul, `webhooks`, med eget schema** (ADR 0001). Den tar emot händelser från alla modulers relän och levererar dem till bolagets system. Modulerna vet inte om webhooks. Varje modul fortsätter att skriva till sin outbox som i dag.

2. **Prenumerationer via API:t.** En prenumeration har:
   - en adress (`https` krävs)
   - händelsetyper, till exempel `policy.*` eller `claim.decided`
   - marknader
   - en hemlighet för signaturen
   - en status: `active` eller `disabled`

   Hemligheten visas bara när prenumerationen skapas och när den byts. Nya rättigheter: `webhooks:read` och `webhooks:manage`. Ny roll: `integration-admin`.

3. **Kuvert enligt CloudEvents 1.0**, i strukturerat JSON-läge (`application/cloudevents+json`):

   | Attribut | Värde | Exempel |
   | --- | --- | --- |
   | `specversion` | `1.0` | |
   | `id` | Händelsens id i outboxen. Samma vid varje försök. | `pev_8c1f…` |
   | `source` | Installationen och modulen | `/petvold/policies` |
   | `type` | Händelsetypen med prefix och version | `petvold.policy.issued.v1` |
   | `subject` | Resursen händelsen gäller | `pol_91c2…` |
   | `time` | När det hände | `2026-11-16T09:12:04Z` |
   | `dataschema` | Schemat för `data` i AsyncAPI-kontraktet | |
   | `market` | Tillägg: marknaden | `SE` |

   En ändring som bryter mot ett schema blir en ny version av typen, till exempel `.v2`. Båda versionerna skickas så länge en prenumeration vill ha den gamla.

4. **Signatur enligt Standard Webhooks.**
   - Varje anrop har rubrikerna `webhook-id`, `webhook-timestamp` och `webhook-signature`.
   - Signaturen är HMAC-SHA256 av `id.tidsstämpel.innehåll`.
   - Hemligheten är 32 slumpade byte med prefixet `whsec_`.
   - När hemligheten byts gäller både den gamla och den nya i 24 timmar. Rubriken har då två signaturer.
   - Mottagaren kontrollerar signaturen och att tidsstämpeln högst ligger fem minuter fel. Det skyddar mot att någon spelar upp ett gammalt anrop.

5. **Tunna händelser.**
   - `data` innehåller id:n och fält som inte är personuppgifter, till exempel status, belopp, datum och skälskoder.
   - Inga namn, adresser, personnummer eller fria texter.
   - Mottagaren hämtar resten med API:t och sin egen token. Då gäller samma rättigheter och omfång som annars (ADR 0016).

   De befintliga scheman för `claim.registered` och `claim.decided`, som har hela ärendet, ersätts av tunna scheman. Ingen mottagare finns än.

6. **Händelser i första versionen:**

   | Grupp | Typer |
   | --- | --- |
   | Skador | `claim.registered`, `.decision_proposed`, `.proposal_returned`, `.decided`, `.payout_ordered`, `.review_requested` |
   | Policyer | `policy.issued`, `.changed`, `.renewed`, `.transferred`, `.cancelled`, `.reinstated` |
   | Ansökningar | `application.received`, `.accepted`, `.referred`, `.declined`, `.withdrawn`, `.expired` |
   | Förslag | `proposal.created` |
   | Meddelanden | `notice.created`, `notice.delivered` och `notice.failed` (nya, med en outbox i `communications`) |
   | Djur | `animal.ownership_changed`, `animal.died` |

   `policy.version_superseded` är en intern händelse för skademotorns omprövning och publiceras inte.

7. **Leverans:**
   - **Minst en gång.** Reläet lägger varje händelse i en kö per prenumeration som matchar (`webhooks.delivery`) och markerar den publicerad först efteråt. `unique (subscription_id, event_id)` gör att en ny leverans från reläet inte ger dubbletter.
   - **En arbetare skickar** med `select … for update skip locked`, så flera instanser kan köra samtidigt utan att skicka samma händelse två gånger samtidigt.
   - **Omförsök** med växande paus och slumpad spridning, under tre dagar: efter 5 sekunder, 5 minuter, 30 minuter, 2 timmar, 5 timmar, 10 timmar och sedan var 24:e timme.
   - **Svar:**
     - `2xx` är levererat.
     - `410 Gone` stänger av prenumerationen.
     - Andra svar och en timeout efter 15 sekunder ger ett nytt försök.
   - **Död post.** En händelse som inte levererats efter tre dagar hamnar i en lista i API:t, och kan skickas igen.
   - **Stängs av.** En prenumeration där inget levererats på fem dygn stängs av, och en person aktiverar den igen.
   - **Ingen ordning lovas.** En mottagare som inte svarar får inte stoppa andra händelser. `time` och tillägget `sequence` (outboxens ordningsnummer per modul) låter mottagaren sortera. Mottagaren använder `webhook-id` för att känna igen dubbletter.

8. **AsyncAPI 3.0 är kontraktet för händelserna** (`modules/api/asyncapi.yaml`). Det ersätter `webhooks` i OpenAPI-kontraktet.
   - Varje publik händelsetyp har ett schema.
   - `lint:asyncapi` kontrollerar att varje händelse som en modul kan skriva och som är publik har ett schema, och att exemplen följer det.
   - Dokumentationssajten visar kontraktet bredvid API-sidan.

9. **Säkerhet:**
   - Bara `https`.
   - Inga omdirigeringar följs.
   - Adresser i privata och lokala nät vägras, så att en prenumeration inte kan användas för att nå interna system. Undantag kräver en lista i installationens inställningar.
   - Hemligheten sparas krypterad med en nyckel från installationens hemligheter (`PETVOLD_WEBHOOK_KEY`).

10. **Gallring.**
    - Innehållet i en levererad händelse tas bort efter 30 dagar.
    - Tid, svar och antal försök finns kvar som bevis på leveransen.
    - Händelserna har inga personuppgifter (punkt 5), så gallringen enligt ADR 0028 behöver inte känna till dem.

11. **Hur det byggs:**
    1. Modulen, prenumerationerna, kön och arbetaren, med händelser om policyer, ansökningar och förslag.
    2. Skador, djur och meddelanden med en outbox i `communications`, och AsyncAPI-kontraktet.
    3. Död post, att skicka igen och avstängning.

## Konsekvenser

- **Bolagets system får veta vad som händer utan att fråga.** Dokumentsystemet kan till exempel reagera på `notice.created` i stället för att hämta listan.
- **Ett sätt för alla händelser.** Signatur, omförsök och felhantering byggs en gång.
- **Mottagaren måste hämta detaljer.** Tunna händelser ger fler anrop, men inga personuppgifter i bolagets loggar och samma behörighet som API:t.
- **En kö till i databasen.** Med `skip locked` behövs inget lås för webhooks vid flera instanser. Reläet för modulernas outboxar behöver fortfarande ett lås (öppet sedan #61).
- **Händelsetyperna blir ett kontrakt.** En ändring som bryter mot ett schema kräver en ny version.
- **Två kontrakt.** API:t i OpenAPI, och händelserna i AsyncAPI.

## Alternativ

- **En webhook per händelse**, som kontraktet beskriver i dag. Varje mottagare måste då lösa signatur och omförsök själv, och det blir svårt att ha en översikt.
- **Feta händelser** med hela resursen. Mottagaren slipper ett anrop, men personuppgifter sprids till bolagets loggar och köer, och omfånget från ADR 0016 gäller inte.
- **En meddelandekö** som Kafka eller en molntjänst. Det passar ett bolag som redan har en, men det kräver drift och en kö per installation (ADR 0010). En kö kan läggas till senare som en annan mottagare, med samma kuvert och samma katalog över händelser.
- **Ett flöde att hämta** (`GET /v1/events?after=…`). Det är enkelt och robust för mottagare som vill hämta själva, men inget sker förrän mottagaren frågar. Det kan läggas till med samma kuvert om ett bolag behöver det.
- **Leverans direkt från reläet**, utan en kö per prenumeration. Det är enklare, men en långsam mottagare stoppar då alla händelser i samma modul.

## Källor

- CloudEvents 1.0, CNCF: github.com/cloudevents/spec (`cloudevents/spec.md`)
- Standard Webhooks: github.com/standard-webhooks/standard-webhooks (`spec/standard-webhooks.md`). Rubrikerna, signerat innehåll `msg_id.timestamp.payload`, HMAC-SHA256 med prefixet `v1,`, hemligheter med prefixet `whsec_`, och omförsök med växande paus under flera dagar.
- AsyncAPI 3.0: asyncapi.com
- ADR 0001, 0008, 0010, 0016, 0028 och 0032.
