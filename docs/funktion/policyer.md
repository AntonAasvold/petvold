# Policyer

En policy försäkrar ett djur. Den har en försäkringstagare, en produkt och hela sin historik. Besluten bakom finns i ADR 0006, 0007 och 0029.

Den här första delen tecknar policyer. Avslut, förnyelse, ändring och överlåtelse kommer i nästa steg.

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

Den första termen är ett år, eftersom försäkringstiden är högst ett år i Sverige (FAL 3 kap. 2 §). Transaktionen går igenom stegen utkast, prissatt, riskbedömd och utfärdad. Tills tariffen och teckningsreglerna finns (M4) anger anroparen premien, och alla ansökningar godkänns. Stegen visar det.

## Anrop

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `POST /v1/policies` | `policies:write` | Tecknar en policy |
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

*Inte byggt än:* avslut, förnyelse, ändring, överlåtelse, policygrupper och händelser (ADR 0029).
