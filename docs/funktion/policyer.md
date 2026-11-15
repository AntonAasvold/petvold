# Policyer

En policy försäkrar ett djur. Den har en försäkringstagare, en produkt och hela sin historik. Besluten bakom finns i ADR 0006, 0007 och 0029.

Policyer kan tecknas, förnyas och avslutas, och ett avslut kan återkallas. Ändring och överlåtelse kommer i nästa steg.

## Vad en policy har

| Del | Betyder | Ändras |
| --- | --- | --- |
| Policy | `id`, marknad, djur och `inceptionDate` (första dagen, som karenstiden räknas från) | Aldrig |
| Term | En försäkringstid, högst ett år, med produktversion, valt försäkringsbelopp och självrisk, villkor för veterinärvård och premie | Aldrig. En förnyelse ger en ny term. |
| Version | Försäkringstagare och status för en giltighetstid, och när den blev känd | Ersätts av nya versioner, men finns kvar i historiken |
| Transaktion | Varje ändring, med steg, vem och när | Aldrig |

## Två tidsaxlar

Varje version har två tidsaxlar:
- **giltighetstid:** de dagar den gäller
- **registreringstid:** när Petvold fick veta det

Därför går det alltid att svara på vad som gällde en viss dag, och vad som var känt vid en viss tidpunkt. Skademotorn bedömer en skada mot den version som gällde på behandlingsdagen. Historiken visar också ändringar som registreras i efterhand, till exempel ett byte av försäkringstagare som gäller från ett tidigare datum (ADR 0029).

## Teckna en policy

`POST /v1/policies` med djur, försäkringstagare, produktversion, startdag, val och premie.

Petvold kontrollerar att:
- djuret finns i marknaden och lever
- försäkringstagaren finns i marknaden och inte är begränsad eller anonymiserad (ADR 0028)
- produktversionen säljs på startdagen, i marknaden och för djurets art
- valen finns i produkten. Ett utelämnat val ger produktens förval.
- premien är i produktens valuta
- **startdagen inte ligger före dagen för tecknandet**
- **djuret inte redan har en policy** för någon av dagarna (`409`)

Termens längd kommer från produkten (`policy.termMonths`, förval 12 månader). Den får inte vara längre än marknaden tillåter, i Sverige ett år (FAL 3 kap. 2 §). Transaktionen går igenom stegen utkast, prissatt, riskbedömd och utfärdad. Tills tariffen och teckningsreglerna finns (M4) anger anroparen premien, och alla ansökningar godkänns. Stegen visar det.

## Förnyelse

En policy förnyas på samma villkor om ingen har sagt upp den (FAL 3 kap. 4 §).

**Förnyelsekörningen** (`POST /v1/renewal-runs`, rättigheten `policies:renew`) är tänkt att köras varje dag med rollen `renewal-job`. Den går igenom policyer vars term slutar inom produktens `renewalLeadDays` (förval 45 dagar) och skapar nästa term för var och en:
- Termen börjar dagen den förra slutar och är `termMonths` lång.
- Produktversionen är den version av samma produkt som säljs den dagen.
- Försäkringsbeloppet och självrisken är samma som förut.
- Premien är samma som förut, tills tariffen finns (M4).
- `inceptionDate` ändras inte, så karenstiden börjar inte om.

Med `"dryRun": true` visas vad som skulle hända utan att något sparas.

**Det som inte förnyas:**
- **Avslutade policyer.** Policyer med ett avslut som gäller vid termens slut, till exempel kundens uppsägning med bindningstiden ut, räknas under `cancelled`.
- **Policyer som behöver ett beslut.** De listas under `needsDecision` med orsak:

| Orsak | Betyder |
| --- | --- |
| `product-not-on-sale` | Ingen version av produkten säljs på förnyelsedagen |
| `option-not-offered` | Den nya versionen saknar försäkringsbeloppet eller självrisken |
| `species-not-covered` | Den nya versionen gäller inte djurets art |
| `term-too-long` | Den nya versionens term är längre än marknaden tillåter |
| `animal-died` | Djuret har dött |
| `policyholder-unavailable` | Försäkringstagaren finns inte, är begränsad eller anonymiserad |

**Förnya för hand:** `POST /v1/policies/{id}/renewals`, med `productVersion` och `premium` om de ska vara andra än förvalen. Den används för policyer som körningen har listat under `needsDecision`.

**Uppsägning efter förnyelsen:** om kunden säger upp till termens slut efter att förnyelsen har körts, avslutas den nya termen från början och hela dess premie betalas tillbaka.

**Exempel:** Rex policy gäller till 1 december 2027. Den 17 oktober, 45 dagar före, förnyar körningen den till 1 december 2028 med den produktversion som säljs då. Om Anna redan har sagt upp till termens slut, förnyas den inte.

## Avsluta en policy

`POST /v1/policies/{id}/cancellations` med `reason`, och vid behov `receivedOn` (dagen uppsägningen kom fram, eller skickades av bolaget, förvalt i dag), `effectiveDate` och `note`. Skälet styr från vilken dag policyn upphör. Reglerna kommer från marknadsprofilen, alltså lagen, och från produktens inställning.

| Skäl | Upphör | Regel i Sverige |
| --- | --- | --- |
| `customer-term-end` | När termen slutar. Inget ändras nu, men policyn förnyas inte. | Alltid tillåtet (FAL 3 kap. 3 §) |
| `customer-immediate` | Dagen efter uppsägningen, eller ett senare `effectiveDate`. Premien för resten av termen betalas tillbaka. | Bara om produkten har `midTermCancellation: immediate` |
| `withdrawal` | Dagen efter, eller från start om policyn inte börjat gälla | Inom 14 dagar från tecknandet (distansavtalslagen 3 kap. 13 §) |
| `need-ceased` | Från `effectiveDate`, även bakåt i tiden, till exempel dagen djuret dog. Kräver `note`. | Alltid tillåtet (FAL 3 kap. 6 §) |
| `insurer-term-end` | När termen slutar | Bolaget säger upp minst en månad före (FAL 3 kap. 3 §) |
| `insurer-breach` | 14 dagar efter att uppsägningen skickades. Kräver `note`. | Bara vid grovt åsidosättande eller synnerliga skäl (FAL 3 kap. 7 §) |
| `unpaid-premium` | 14 dagar efter att uppsägningen skickades | FAL 5 kap. 2 § |

**Det här händer:** de versioner som gällde från upphörandedagen ersätts. Den del som gällde före dagen finns kvar som aktiv, och resten blir en version med status `cancelled`. Skademotorn ser då att policyn är avslutad på de dagarna. Det som var känt före avslutet går fortfarande att se med `knownAt`.

**Premie tillbaka:** `refund` är termens premie per dag för de dagar som inte längre gäller, avrundat till närmaste öre (FAL 5 kap. 6 §). Utbetalningen görs av betalningsmodulen (M5).

**Ett tidigare avslut gäller redan:** ett nytt avslut som börjar samma dag eller senare ger `409`. Ett tidigare avslut är fortfarande möjligt, till exempel om djuret dör under uppsägningstiden.

**Återkalla ett avslut:** `POST /v1/policies/{id}/reinstatements` med `cancellationId` och `note`. Det går bara om avslutet är policyns senaste transaktion, till exempel om ett dödsfall registrerades på fel djur. De ersatta versionerna gäller då igen, och premien tillbaka återkallas.

**Händelser:** varje ändring skriver händelser i samma transaktion: `policy.issued`, `policy.renewed`, `policy.cancelled` (med upphörandedag och premie tillbaka), `policy.reinstated` och `policy.version_superseded` för varje ersatt version. Dev-servern skriver ut dem i loggen.

**Exempel:** Rex dör 1 mars 2027, och Anna hör av sig 20 mars. Kundservice skickar `{ "reason": "need-ceased", "effectiveDate": "2027-03-01", "note": "Djuret har dött" }`. Policyn upphör från 1 mars, och premien för 1 mars till 1 december betalas tillbaka. En skada på Rex efter 1 mars avslås, eftersom policyn är avslutad.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/policies` | `policies:write` | Tecknar en policy |
| `POST /v1/policies/{id}/renewals` | `policies:write` | Förnyar en policy för hand |
| `POST /v1/renewal-runs` | `policies:renew` | Förnyelsekörningen |
| `POST /v1/policies/{id}/cancellations` | `policies:write` | Avslutar en policy |
| `POST /v1/policies/{id}/reinstatements` | `policies:write` | Återkallar det senaste avslutet |
| `GET /v1/policies?animalId=…` | `policies:read` | Policyer för ett djur. Det går också att använda `policyholderPartyId`. |
| `GET /v1/policies/{id}` | `policies:read` | Policyn med termer och gällande versioner |
| `GET /v1/policies/{id}/history` | `policies:read` | Alla versioner, även ersatta, och alla transaktioner |
| `GET /v1/policies/{id}/snapshot?date=…&knownAt=…` | `policies:read` | Policyn som skademotorn ser den en viss dag, enligt vad som var känt vid `knownAt` |

## Exempel

**Anna tecknar en försäkring för Rex:**

```http
POST /v1/policies
{
  "market": "SE", "animalId": "ani_rex", "policyholderPartyId": "pty_anna",
  "productVersion": "SE-HUND-VV-LIV@2026.2", "startDate": "2026-12-01",
  "vetCare": { "annualLimit": 3000000, "deductible": "standard" },
  "premium": { "amount": 480000, "currency": "SEK" }
}
```

Svaret har en term från 1 december 2026 till 1 december 2027 (slutdagen räknas inte), med 30 000 kr i försäkringsbelopp och premien 4 800 kr.

**Vad skademotorn ser 1 mars 2027:** `GET /v1/policies/{id}/snapshot?date=2027-03-01`.

## Vem ser vad

- `policy-registrar` tecknar policyer, till exempel säljkanalen eller kundservice.
- `handler` och `approver` kan läsa.
- `customer-channel` ser bara policyerna i sin token.
- Alla ser bara policyer i sina marknader. Kliniker ser inga policyer.

## Lokalt

Dev-servern lägger in Bellas policy `pol_bella` första gången, med ägaren `pty_owner001` och förbehållet för hälta. Exemplet har bara den gällande termen. Token `dev-seller` tecknar policyer. Skademotorn läser policyerna från modulen.

*Inte byggt än:* nytt pris vid förnyelse (M4), ändring, överlåtelse, policygrupper, förslag till avslut när djuret dör (händelser från djurregistret), och omprövning av skador efter ett avslut bakåt i tiden (ADR 0029).
