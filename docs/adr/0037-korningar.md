# 0037. Körningar: schema, lås, historik och styrning i back office

- Status: Föreslagen
- Datum: 2026-11-18

## Sammanhang

Petvold har arbete som ska ske utan att någon trycker på en knapp:

| Arbete | Modul | I dag |
| --- | --- | --- |
| Förnyelse av policyer | policies | `POST /v1/renewal-runs`, startas utifrån |
| Utgång av ansökningar som inte beslutats | policies | `POST /v1/application-expiry-runs`, startas utifrån |
| Utgång av förslag om överlåtelse | policies | `POST /v1/policy-proposal-expiry-runs`, startas utifrån |
| Gallring av parter (ADR 0028) | parties | `POST /v1/retention-runs`, startas utifrån |
| Reläet för alla moduler (ADR 0008) | api | Var 1 000:e ms i `server.ts` |
| Webhook-arbetaren (ADR 0033) | webhooks | Var 1 000:e ms i `server.ts` |
| Påminnelser och utgång för komplettering (ADR 0036) | claims | Inte byggt |

Det ger fyra problem:

- **Ingen kör körningarna.** Bolaget måste själv sätta upp något som anropar API:t varje dag, och det syns inte i Petvold om det har glömts. En förnyelse som uteblir kan lämna kunden utan försäkring och utan det besked som lagen kräver före förnyelsen (FAL 2 kap. 5 §, se ADR 0032). En gallring som aldrig körs gör att personuppgifter sparas längre än de behövs (GDPR artikel 5.1 e).
- **Ingen historik.** Resultatet av en körning finns bara i svaret till den som anropade. Det går inte att se vad som hände i natt eller varför något misslyckades.
- **Flera servrar krockar.** Körs Petvold på två servrar levererar båda reläerna samma händelser, och ordningen inom en källa kan brytas. Reläets försök och döda poster finns bara i minnet och försvinner vid omstart. Webhook-arbetaren klarar redan flera servrar med `for update skip locked`.
- **Inget går att se eller styra i back office.** En driftansvarig kan inte pausa en körning som gör fel, köra en för hand eller ändra när den går.

## Beslut

1. **En ny modul, `scheduling`, med ett eget schema och en egen roll** (`scheduling_service`).
   - Modulen äger schemat, låsen och historiken. Den läser aldrig andra modulers tabeller (ADR 0001).
   - Varje körning är en funktion i sin modul som kompositionsroten registrerar under ett namn, till exempel `policies.renewal`. Modulen vet inget om förnyelser.
   - **En körning tar emot** marknad, dag och `dryRun`.
   - **En körning svarar med** ett resultat med antal och id:n, utan personuppgifter, som `RenewalRunResult` och `RetentionRunResult` redan gör.

2. **Två sorters schema**, inget cron-uttryck:
   - **`daily`:** en gång per dag och marknad, vid en tid i marknadens tidszon, till exempel `02:30` i `Europe/Stockholm`. Gäller förnyelse, utgång, gallring och kompletteringar.
   - **`interval`:** med ett antal sekunder mellan omgångarna. Gäller reläet och webhook-arbetaren.

   Varje körning har ett förval i koden. Bolagets ändringar sparas som versioner (punkt 6).

3. **Körningar per marknad.** En `daily`-körning körs en gång per marknad som installationen har. Resultatet och felen hålls isär, så att ett fel i en marknad inte stoppar en annan. Körningen gör det som anropet gör i dag, men med systemet som anropare och omfånget till en marknad.

4. **Lås med ett lån i databasen, inte i minnet.**
   - Tabellen `scheduling.lease` har en rad per körning och marknad, med vem som håller lånet och när det går ut.
   - En server tar lånet med en enda `update … where expires_at < now() returning`, och förnyar det medan körningen pågår.
   - En server som dör släpper lånet när tiden går ut.
   - **Reläet** tar ett lån för hela reläet och blir den enda servern som levererar. Händelserna kommer då i ordning, utan att lås behövs per rad i varje moduls outbox.
   - **Webhook-arbetaren** behåller `skip locked`, som redan fungerar, och behöver inget lån.
   - Alla körningar tål att köras två gånger. Ett lån som går ut medan en långsam körning pågår blir därför i värsta fall en dubbel körning, inte ett fel. Därför behövs ingen fencing token.

5. **Historik för varje körning.**
   - Tabellen `scheduling.run` sparar:
     - körning och marknad
     - hur den startades: schema, för hand eller anrop
     - vem som startade den
     - start och slut
     - läge (`running`, `succeeded`, `failed`, `skipped`)
     - resultatet och felet
   - **Missad körning:** var servern nere vid tiden körs en `daily`-körning en gång när servern startar igen, inte en gång per missad dag. Körningarna räknar själva fram vad som är förfallet.
   - **De befintliga anropen** (`POST /v1/renewal-runs` och de andra) finns kvar för den som vill starta utifrån. De sparar också historik, med startsättet `api`.
   - **Reläet och webhook-arbetaren** sparar ingen rad per omgång. De visar läget i stället: kö per källa, ålder på den äldsta väntande händelsen, försök och döda poster. Reläets försök och döda poster sparas i `scheduling.relay_dead_letter`, så att de finns kvar efter en omstart.
   - **Historiken gallras** efter 400 dagar, så att ett helt år kan jämföras med det förra.

6. **Styrning med rättigheter och spår.**

   | Åtgärd | Rättighet | Fyra ögon |
   | --- | --- | --- |
   | Se körningar, historik, reläet och webhook-arbetaren | `jobs:read` | – |
   | Kör nu, med eller utan `dryRun` | `jobs:operate` | Nej |
   | Pausa och återuppta, med skäl | `jobs:operate` | Nej |
   | Skicka en död post i reläet igen | `jobs:operate` | Nej |
   | Ändra schemat, till exempel tiden eller att en körning ska vara avstängd | `jobs:configure` | Ja: en annan person med `jobs:configure` godkänner |

   - **Paus och "Kör nu" gäller direkt.** Den som ser en körning göra fel ska kunna stoppa den utan att vänta på någon. Både paus och "Kör nu" sparas med vem, när och skäl.
   - **Ändringar av schemat** går genom fyra ögon, som produkter, regler och radering. Att stänga av gallringen eller förnyelsen påverkar kunder och lagkrav.
   - **En pausad körning som lagen kräver,** som förnyelse, gallring och utgång, syns som en varning i översikten och i hälsokontrollen tills den återupptas.

7. **Larm.**
   - **`/healthz`** blir `degraded` när en körning har misslyckats, inte har gått i tid eller är pausad, eller när reläet har döda poster.
   - **Händelsen `job.failed`** går till webhooks (ADR 0033), så att bolagets driftsystem kan larma. Den innehåller körning, marknad, startsätt och felets kod, inte resultatet.

8. **API och back office.**
   - Anrop under `/v1/jobs`:
     - lista och läs körningar med schema, nästa körning och senaste resultat
     - historik
     - `runs` (kör nu), `pauses`, `resumptions` och schemaändringar med godkännande
   - Under `/v1/relay` finns läget och död post skickas igen.
   - **I back office** får sidan "Körningar" i menyn (`jobs:read`):
     - en lista med varje körning, nästa och senaste körning och läget
     - en sida per körning med historik, "Kör nu", paus och schemat
     - reläet och webhook-arbetaren med kö, eftersläpning och döda poster

     Översikten (roadmapen) visar körningar som misslyckats eller är pausade.

9. **Ordning,** med kontraktet först och en PR per steg:
   1. modulen `scheduling` med lån, historik och schemaläggaren, och de fyra körningarna registrerade
   2. reläet bakom ett lån, med döda poster som sparas
   3. API:t och sidan "Körningar" i back office: lista, historik, "Kör nu" och paus
   4. schemaändringar med fyra ögon, `job.failed` och hälsokontrollen
   5. påminnelser och utgång för komplettering som en körning (ADR 0036, steg 3)

## Konsekvenser

- **Petvold kör sina egna körningar.** Ett bolag behöver inte bygga något runt API:t för att förnyelser och gallring ska ske, och det syns i back office när något inte gjorts.
- **Flera servrar går att köra.** Det behövs för drift utan avbrott och löser en brist som varit öppen sedan meddelandemodulen fick ett eget relä (ADR 0032).
- **En modul och en databas till.** Installationen får `SCHEDULING_DATABASE_URL` och rollen `scheduling_service`, och `npm run roles:sync` behöver köras.
- **Reläet blir en enda server åt gången.** Det är enklare och håller ordningen, men begränsar genomströmningen till en server. Det räcker för de volymer en installation per bolag har. Behövs mer kan reläet delas per källa, med ett lån per källa.
- **Körningarnas resultat måste fortsätta vara fria från personuppgifter,** eftersom historiken sparas i 400 dagar och visas för den som har `jobs:read`.
- **Tiden för en körning följer marknadens tidszon,** så sommartid hanteras som i resten av Petvold (`marketDate`). En tid som inte finns en natt med sommartid, till exempel 02:30 när klockan ställs fram, körs vid nästa tid som finns.

## Alternativ

- **Cron-uttryck.** Valdes bort: svåra att läsa och ändra i ett gränssnitt, och de flesta körningar ska gå en gång per dag. Två sorters schema räcker och är lätta att visa.
- **En extern schemaläggare,** som Kubernetes CronJob eller bolagets eget system. Valdes bort som enda väg, eftersom historiken och styrningen då hamnar utanför Petvold. Anropen finns kvar för den som ändå vill.
- **`pg_try_advisory_lock`.** Valdes bort. Ett sådant lås hör till en anslutning, och anslutningar i en pool återanvänds, så det är lätt att hålla det för länge eller tappa det. Ett lån i en tabell syns, går ut av sig själv och kan visas i back office.
- **En kö för jobb, till exempel pg-boss eller BullMQ.** Valdes bort. De löser fördelning av många små jobb, men Petvold har få körningar som var och en går igenom en hel modul. Ett ramverk till och för andra en Redis-instans väger tyngre än nyttan.
- **Fyra ögon också för paus.** Valdes bort. Den som ser en körning göra fel ska kunna stoppa den direkt. Pausen loggas och syns som en varning.

## Källor

- [PostgreSQL: explicit låsning och rådgivande lås](https://www.postgresql.org/docs/current/explicit-locking.html), och [`SELECT … FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE).
- Martin Kleppmann, [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (2016): lån som går ut, och när en fencing token behövs.
- [Försäkringsavtalslagen (2005:104)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/forsakringsavtalslag-2005104_sfs-2005-104/), 2 kap. 5 §: besked om villkoren inför förnyelse, som ADR 0032 bygger beskedet om förnyelse på.
- [Dataskyddsförordningen (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj), artikel 5.1 e: lagringsminimering.
- ADR 0001, 0008, 0016, 0028, 0029, 0033, 0035 och 0036 i det här repot.
