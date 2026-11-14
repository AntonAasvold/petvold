# Behörighet

Vem som får göra vad i Petvold, och hur det ställs in för en installation. Beslutet bakom finns i ADR 0016.

## Så fungerar det

1. **Anroparen loggar in hos försäkringsbolagets identitetstjänst** och skickar en token med varje anrop. Tokenen innehåller anroparens roller. Petvold lagrar inga användare.
2. **Varje roll ger ett antal rättigheter.** Vilka rättigheter en roll ger ställs in per installation.
3. **Varje anrop kräver exakt en rättighet.** Den står i API-kontraktet (`x-permission`) och visas på API-sidan.
4. **Saknas rättigheten** svarar Petvold `403` och anger vilken rättighet som krävs.
5. **Anroparen ser bara ärenden inom sitt omfång** (se nedan). Ett ärende utanför omfånget ger `404`, precis som ett ärende som inte finns.

En roll som inte finns i inställningarna ger inga rättigheter. Det finns ingen roll som ger allt.

## Rättigheter

| Rättighet | Ger rätt att | Anrop |
| --- | --- | --- |
| `claims:register` | Anmäla en skada | `POST /v1/claims` |
| `claims:read` | Läsa ett ärende, dess bedömning, beslut, förklaringar och begäranden om prövning, och räkna om ett beslut | `GET /v1/claims/{id}`, `.../assessment`, `.../decisions`, `.../decisions/{seq}/explanation`, `.../review-requests`, `POST .../decisions/{seq}/replays` |
| `claims:decide` | Fatta beslut i ett ärende | `POST /v1/claims/{id}/decisions` |
| `claims:override` | Besluta mot bedömningens förslag, med skälkod och motivering (ADR 0018) | Kontrolleras inom `POST /v1/claims/{id}/decisions` |
| `claims:reassess` | Ompröva ett beslutat ärende | `POST /v1/claims/{id}/reassessments` |
| `claims:request-review` | Begära mänsklig prövning av ett automatiskt beslut för kundens räkning (ADR 0018) | `POST /v1/claims/{id}/decisions/{seq}/review-requests` |
| `claims:preview` | Få förhandsbesked utan att något sparas | `POST /v1/claim-previews` |
| `limits:read` | Se förbrukat och återstående försäkringsbelopp | `GET /v1/policies/{p}/animals/{a}/limits` |

## Standardroller

Petvold levereras med de här rollerna som utgångspunkt:

| Roll | Rättigheter | Bunden till | För |
| --- | --- | --- | --- |
| `handler` | Alla ovan | – | Skadehandläggare |
| `approver` | `claims:read`, `limits:read` | – | Attestant. Rätten att attestera kommer med attestkedjan i M1. |
| `clinic` | `claims:register`, `claims:read`, `claims:preview` | klinik | Veterinärklinik med direktreglering |
| `reassessment-job` | `claims:read`, `claims:reassess` | – | Maskinklient som omprövar ärenden, till exempel efter en retroaktiv ändring |
| `customer-channel` | `claims:read`, `claims:request-review` | försäkringar | Försäkringsbolagets kundportal eller app, som loggar in kunden själv och anropar Petvold för kundens räkning |

## Omfång

Rättigheten säger *vad* anroparen får göra. Omfånget säger *vilka ärenden* det gäller. Omfånget kommer från attribut i tokenen:

| Attribut | Betydelse | Krävs för |
| --- | --- | --- |
| `markets` | Marknaderna anroparen arbetar i, till exempel `["SE"]`, eller `"*"` för alla marknader i installationen | Alla. Utan `markets` ser anroparen inga ärenden. |
| `clinicId` | Klinikens id | Roller bundna till klinik |
| `policyIds` | Försäkringarna anroparen får se, till exempel den inloggade kundens | Roller bundna till försäkringar |

Reglerna:
- **Marknad.** Alla ser bara ärenden i sina marknader.
- **Klinik.** En roll bunden till klinik ser bara ärenden som kliniken själv har skickat in. När en klinik anmäler en skada sparas klinikens id från tokenen på ärendet. Det går inte att ange id:t i anropet.
- **Försäkringar.** En roll bunden till försäkringar ser bara ärenden på de försäkringar som står i tokenen. Kundportalen slår upp kundens försäkringar och lägger dem i tokenen.
- **Den snävaste bindningen gäller.** Har anroparen flera roller och någon av dem är bunden, gäller bindningen.
- **Saknat attribut stoppas.** Kräver rollen ett attribut som tokenen saknar, svarar Petvold `403`. Anroparen får aldrig ett bredare omfång för att något fattas.

Hur Petvold svarar utanför omfånget:

| Fall | Svar |
| --- | --- |
| Läsa, besluta, ompröva eller begära prövning i ett ärende utanför omfånget | `404`, samma svar som för ett ärende som inte finns |
| Anmäla en skada eller få förhandsbesked i en annan marknad eller på en annan försäkring | `403` |
| Försäkringsbelopp för en försäkring utanför omfånget | `404` |
| Försäkringsbelopp för en roll bunden till klinik | `404`. En klinik är inte knuten till försäkringar och kan därför inte slå upp försäkringsbelopp per försäkrings-id. |

`404` i stället för `403` gör att det inte går att ta reda på vilka ärenden som finns genom att prova id:n (OWASP API1, *Broken Object Level Authorization*).

## Egna roller

Ett försäkringsbolag kan använda sina egna rollnamn från sin identitetstjänst. Exempel där teamet `claims-team` bara får läsa, och där en partnerklinik får se försäkringsbelopp:

```ts
createApp({
  // …
  roles: {
    ...DEFAULT_ROLES,
    'claims-team': { permissions: ['claims:read'] },
    'partner-clinic': { permissions: ['claims:register', 'claims:read', 'claims:preview', 'limits:read'], bindsTo: 'clinic' },
  },
});
```

`bindsTo` är `clinic` eller `policies`, eller saknas.

Inställningarna kontrolleras när Petvold startar. En okänd rättighet eller bindning, till exempel ett stavfel, gör att Petvold inte startar. Ett stavfel kan alltså aldrig ge eller ta bort rättigheter i tysthet.

*(Planerat: inställningen läses från installationens konfiguration i stället för koden.)*

## Planerat

- **Beloppsgränser och fyraögonsprincip** (behörighet del 3, med attestkedjan): beslut över en gräns kräver attest av någon annan.

## Lokalt

Dev-servern har fyra tokens:

| Token | Roll | Omfång |
| --- | --- | --- |
| `dev-handler` | handläggare och attestant | alla marknader |
| `dev-clinic` | klinik | SE, klinik `clinic_001` |
| `dev-job` | omprövningsjobb | alla marknader |
| `dev-customer` | kundkanal | SE, försäkringen `pol_bella` |
