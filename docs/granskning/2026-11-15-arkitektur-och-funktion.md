# Arkitektur och funktion efter M3 och halva M4

**Datum:** 2026-11-15 **Läge:** `main` efter PR #58 **Gjord av:** Claude, på uppdrag av produktägaren

## Sammanfattning

Petvold har 13 moduler, 28 migreringar, 30 ADR:er och 356 tester plus 111 databastester. Modulgränserna håller: ingen modul läser en annan moduls tabeller, och kopplingarna går via portar som installationen kopplar ihop. Grundprinciperna är genomförda i hela kodbasen och skyddade av databasen:
- historik som aldrig skrivs över
- bitemporala policyer
- fyra ögon
- beslut som går att styrka

**Det som behöver göras före en första kund** är framför allt drift och säkerhet, inte domänmodellen:
- en riktig installation (kompositionsrot, inloggning och relä för händelser)
- sidindelning
- datum i marknadens tidszon

**Funktionellt** saknas tre saker för att sälja en försäkring: teckningsregler, betalning och dokument till kunden.

Fynden har en prioritet:
- **A:** före första kund
- **B:** före skalning
- **C:** förbättring

## Läget i siffror

| Modul | Kod (rader) | Tester (rader) | Beror på |
| --- | --- | --- | --- |
| `claims-core` | 1 910 | 2 098 | `common` |
| `policies` | 2 315 | 892 | `claims-core` (typer), `pricing-core` |
| `api` | 2 084 | 1 751 | alla moduler (kompositionsrot) |
| `parties` | 1 119 | 452 | – |
| `animals` | 975 | 381 | – |
| `catalog` | 870 | 524 | `claims-core` (typer) |
| `claims-store-postgres` | 542 | 173 | `claims-core` |
| `claims-store-memory` | 484 | (sviten i `claims-core`) | `claims-core` |
| `pricing-core` | 428 | 135 | – |
| `decisioning` | 420 | 264 | `claims-core`, `pricing-core` |
| `access` | 218 | 176 | – |
| `common` | 140 | 178 | – |

## Arkitektur

### Det som fungerar bra

- **Modulgränser (ADR 0001).** Varje modul har ett eget schema och en egen tjänsteroll med minsta möjliga rättigheter. Kopplingar går via portar, till exempel `PartyPort`, `ActivitySource` och `TariffPort`. Adaptrarna ligger i `api/src/wiring.ts`.
- **Databasen skyddar reglerna**, inte bara koden:
  - exclusion constraints mot dubbla policyer och överlappande versioner
  - triggers för ägarkedjor och fyra ögon
  - en `security definer`-funktion som enda väg att anonymisera
  - kolumnrättigheter som bara tillåter att slutdatum sätts
- **Bevisbarhet (ADR 0018)** genom hela kedjan:
  - skadebeslut med underlag och `inputHash`
  - priser med tariffversion, kontrollsumma och `breakdown`
  - regler och tariffer med kontrollsumma
- **Rena kärnor.** `claims-core` och `pricing-core` har ingen I/O och räknar med heltal. Tester med egenskaper (`fast-check`) och scenariofiler finns för beräkningen.
- **Kontrakt först.** En lint kontrollerar att alla 87 operationer i kontraktet är byggda och har en rättighet. Svaren valideras mot kontraktet i testerna.
- **Samma testsvit för minne och Postgres** i varje modul gör att minneslagret är ett trovärdigt dubbelgångare.
- **Dokumentation i samma PR**, med en bygglogg per PR och en publicerad sajt.

### Fynd

| # | Prio | Fynd | Förslag |
| --- | --- | --- | --- |
| A1 | A | **Det finns ingen kompositionsrot för drift.** `dev-server.ts` kopplar ihop modulerna, seedar exempeldata och kör relän som `setInterval`. `createApp` har egna förval i minnet. En installation måste i dag skriva om samma kod. | En `server.ts` utan exempeldata som läser konfiguration och kopplar ihop modulerna en gång. Dev-servern blir ett tunt lager ovanpå. |
| A2 | A | **Inloggningen finns bara som port.** `AuthPort` är rätt gräns (ADR 0016), men det finns ingen adapter för JWT eller OIDC, bara dev-tokens. | En adapter som verifierar JWT mot JWKS (RFC 9068), med claims för roller, marknader, `clinicId` och `policyIds`. |
| A3 | A | **"I dag" räknas i UTC.** 13 ställen räknar dagens datum med `now().slice(0, 10)`. Mellan 00:00 och 01:00 (02:00 sommartid) svensk tid blir det fel dag. Det påverkar ångerfrist, varsel, förnyelse och gallring. | Tidszon i marknadsprofilen (`Europe/Stockholm`), och en gemensam funktion `todayIn(market, clock)` i `common`. |
| A4 | A | **Ingen sidindelning**, trots att ADR 0002 säger markörbaserad sidindelning. Listor som förslag, begäranden om radering, regelversioner, djur per ägare och grupper kan växa utan gräns. | Markörer (`cursor`, `limit`) på alla listor, med ett gemensamt schema i kontraktet. |
| A5 | A | **Händelser levereras bara inom processen.** Tre outboxar (skador, djur, policyer) har var sin relä i dev-servern. Mottagarna tål upprepning: förslag har `source_event_id`, och omprövning jämför `inputHash`. Men det finns ingen gemensam inkorg, inga omförsök och ingen död kö. | Ett gemensamt relä med omförsök och felkö, enligt ADR 0008: pollning nu, pg-boss om det behövs. Ett relä per outbox är redan en öppen punkt. |
| B1 | B | **`api/src/app.ts` (1 025 rader) och `policies/src/index.ts` (1 845 rader) är för stora.** De är svåra att granska och lätta att krocka i. | Dela `app.ts` i en router per modul. Dela `policies` i tecknande, livscykel, pris, förslag, grupper och lager. |
| B2 | B | **`claims-core` är ett delat kärnbibliotek.** `catalog`, `decisioning` och `policies` beror på det för typer som `VetCareTerms`, `ISODate` och `sha256`. `pricing-core` har en egen kopia av `canonicalJson`. | Flytta de delade typerna och hashfunktionerna till `common`, så att `claims-core` bara är skademotorn. |
| B3 | B | **Körningar går igenom allt.** Gallring, förnyelse och utgångna förslag läser objekt för objekt (N+1) utan omgångar. | Omgångar med markör och en gräns per körning, och frågor som filtrerar i databasen. |
| B4 | B | **Två steg i stället för en transaktion.** Ett exempel är tecknande med grupp, där policyn sparas först och medlemskapet sedan. Ett fel mellan stegen ger en policy med grupprabatt utan grupp. | Medlemskapet går in i `PolicyStore.issue`, som avslut och överlåtelse redan gör med `ApplyExtra`. |
| B5 | B | **Kontroller av behörighet upprepas i varje route** (`seesX`, `visibleX`, kontroll av marknad). Det är lätt att glömma en. | En gemensam hjälpare för omfång per resurs, och ett test som går igenom alla operationer med roller bundna till kliniker och försäkringar. |
| B6 | B | **Nya standardroller kräver `roles:sync`** i varje installation. Det är dokumenterat och har ett verktyg, men det glöms lätt vid uppgradering. | Visa vid start när den sparade rollinställningen saknar standardrättigheter, utan att ändra något. |
| C1 | C | **Ingen AsyncAPI för händelserna.** Det är medvetet uppskjutet i ADR 0008 tills det finns en extern mottagare. | Skriv den när den första webhooken eller kön kommer. |
| C2 | C | **Exempeldata i koden.** `fixtures` i `claims-store-memory` och `pricing-core` används av dev-servern. | Flytta exempeldata till `seed/` som JSON, som katalogen gör. |
| C3 | C | **Ändringen av en körd migration** (backningen av 0019) var ett undantag. | Lägg in en kontroll i CI att körda migreringar inte ändras, med en lista över godkända undantag. |

## Funktion

### Kundresan i dag

| Steg | Läge |
| --- | --- |
| Pris | Klart: prisindikation, tariff, rabatter och manuellt pris |
| Teckna | Klart, men alla ansökningar godkänns. **Teckningsregler saknas.** |
| Information och avtal | **Saknas:** förköpsinformation, villkor, försäkringsbrev och godkännande vid tecknande |
| Betala | **Saknas** (M5) |
| Ändra, förnya, säga upp | Klart, med lagregler per marknad |
| Ägarbyte och dödsfall | Klart, via förslag från djurregistret |
| Skada | Klart: anmälan, bedömning, beslut, attest och omprövning. **Utbetalning saknas** (M5). |
| Radering | Klart, med fyra ögon och lagringstider |

### Fynd

| # | Prio | Fynd | Förslag |
| --- | --- | --- | --- |
| F1 | A | **Teckningsregler saknas.** Alla ansökningar godkänns: inga åldersgränser, inga hälsofrågor och inga förbehåll vid tecknande. Förbehåll finns i skademotorn men kan inte skapas. | ADR och bygge (nästa steg i M4). Förbehåll skapas vid tecknande och sparas på termen. |
| F2 | A | **Inga dokument eller meddelanden till kunden.** Förköpsinformation och villkor krävs vid distansavtal (distansavtalslagen 3 kap.), och FAL kräver besked vid förnyelse och uppsägning. Petvold skickar bara händelser. | Ett beslut om ansvar: Petvold ger underlag och händelser, och kanalen skickar. Eller en dokumentmodul med mallar per produkt och marknad. Det behöver en ADR. |
| F3 | A | **Godkännandet vid tecknande sparas inte.** Vid överlåtelse sparas kanal och referens, men inte när policyn tecknas. | `acceptance` (kanal, referens och tid) på tecknandet, som vid överlåtelse. |
| F4 | A | **Produkten heter "veterinärvård och liv", men bara veterinärvård finns.** Livförsäkring (ersättning vid dödsfall eller avlivning, livvärde efter ålder) saknas helt. | Ett nytt moment i produkten och skademotorn, med livvärde efter ålder (ADR 0007 nämner det), eller byt namn på exempelprodukten. |
| F5 | B | **Betalning, premieplan, påminnelser och obetald premie** finns bara som avslut. Utbetalning av skador och återkrav saknas. | M5 enligt ADR 0017. |
| F6 | B | **Provision till säljare och ombud** saknas. | Punkten i M5. Vem som sålde policyn kan börja sparas redan nu, utan provisionsberäkning. |
| F7 | B | **Kundens egen kanal** är bunden till försäkringar, inte till parten. Den kan inte se sina egna uppgifter, sina djur eller sina grupper. | En bindning till part (`partyId` i token), som ADR 0026 redan nämner. |
| F8 | B | **Skatt på premien** saknas. Sverige har ingen skatt på premien, men Tyskland har det. | Fält i marknadsprofilen innan en andra marknad. |
| F9 | B | **Bara en marknad.** Marknadsprofilen finns bara för Sverige. | En profil per ny marknad, med källor, innan den används. |
| F10 | C | **Rapportering saknas:** reserver, premieintäkt, skadekvot och tillsynsrapportering. Ledgern har underlaget för skador men inte för premier. | En ADR om ledger för premier och rapporter (M5 och senare). |
| F11 | C | **Kvar i M3:** ändring i fel ordning, självriskperiod över termgränsen, och att teckna en hel kull i ett anrop. | Står i roadmapen. |

## Rekommenderad ordning

1. **Före första kund, drift:** A1 kompositionsrot, A2 inloggning och A3 tidszon. Det är små ändringar med stor risk om de saknas.
2. **Före första kund, funktion:** F1 teckningsregler, F3 godkännande vid tecknande och F2 ett beslut om dokument.
3. **M5:** betalning och utbetalning (F5), provision (F6) och premie i ledgern (F10).
4. **Löpande i varje PR som rör området:** A4 sidindelning, B1 och B2 uppdelning, B3 körningar i omgångar och B4 transaktioner.

## Det här granskningen inte täckte

- **Kodgranskning rad för rad.** För det finns `/code-review`. En djupare granskning med flera agenter i molnet startas med `/code-review ultra`, och det startar du själv.
- **Prestanda under last** och säkerhetstester (penetrationstest).
- **Juridisk granskning** av lagreglerna i marknadsprofilen. Den bör göras av en jurist.
