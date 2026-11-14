# Behörighet

Vem som får göra vad i Petvold, och hur det ställs in för en installation. Beslutet bakom finns i ADR 0016.

## Så fungerar det

1. **Anroparen loggar in hos försäkringsbolagets identitetstjänst** och skickar en token med varje anrop. Tokenen innehåller anroparens roller. Petvold lagrar inga användare.
2. **Varje roll ger ett antal rättigheter.** Vilka rättigheter en roll ger ställs in per installation.
3. **Varje anrop kräver exakt en rättighet.** Den står i API-kontraktet (`x-permission`) och visas på API-sidan.
4. **Saknas rättigheten** svarar Petvold `403` och anger vilken rättighet som krävs.

En roll som inte finns i inställningarna ger inga rättigheter. Det finns ingen roll som ger allt.

## Rättigheter

| Rättighet | Ger rätt att | Anrop |
| --- | --- | --- |
| `claims:register` | Anmäla en skada | `POST /v1/claims` |
| `claims:read` | Läsa ett ärende, dess bedömning och beslut | `GET /v1/claims/{id}`, `.../assessment`, `.../decisions` |
| `claims:decide` | Fatta beslut i ett ärende | `POST /v1/claims/{id}/decisions` |
| `claims:reassess` | Ompröva ett beslutat ärende | `POST /v1/claims/{id}/reassessments` |
| `claims:preview` | Få förhandsbesked utan att något sparas | `POST /v1/claim-previews` |
| `limits:read` | Se förbrukat och återstående försäkringsbelopp | `GET /v1/policies/{p}/animals/{a}/limits` |

## Standardroller

Petvold levereras med de här rollerna som utgångspunkt:

| Roll | Rättigheter | För |
| --- | --- | --- |
| `handler` | Alla ovan | Skadehandläggare |
| `approver` | `claims:read`, `limits:read` | Attestant. Rätten att attestera kommer med attestkedjan i M1. |
| `clinic` | `claims:register`, `claims:read`, `claims:preview` | Veterinärklinik med direktreglering |
| `reassessment-job` | `claims:read`, `claims:reassess` | Maskinklient som omprövar ärenden, till exempel efter en retroaktiv ändring |

## Egna roller

Ett försäkringsbolag kan använda sina egna rollnamn från sin identitetstjänst. Exempel där teamet `claims-team` bara får läsa:

```ts
createApp({
  // …
  roles: { ...DEFAULT_ROLES, 'claims-team': ['claims:read'] },
});
```

Inställningarna kontrolleras när Petvold startar. En okänd rättighet, till exempel ett stavfel, gör att Petvold inte startar. Ett stavfel kan alltså aldrig ge eller ta bort rättigheter i tysthet.

*(Planerat: inställningen läses från installationens konfiguration i stället för koden.)*

## Planerat

- **Omfång** (behörighet del 2): en klinik ser bara ärenden den själv har skickat in, och en handläggare bara ärenden i sina marknader. Ett ärende utanför omfånget ger `404`. **Tills dess kan en klinik läsa alla ärenden.**
- **Beloppsgränser och fyraögonsprincip** (behörighet del 3, med attestkedjan): beslut över en gräns kräver attest av någon annan.
- **Avvikelse från förslaget** kräver rättigheten `claims:override` och en motivering (ADR 0018).

## Lokalt

Dev-servern har tre tokens: `dev-handler` (handläggare och attestant), `dev-clinic` (klinik) och `dev-job` (omprövningsjobb).
