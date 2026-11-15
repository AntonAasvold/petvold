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
| `rules:read` | Läsa regeluppsättningar (ADR 0021) | `GET /v1/rule-sets/{serie}/versions`, `.../{v}` |
| `rules:write` | Skapa och ändra utkast, skicka till granskning | `POST .../versions`, `PUT .../{v}`, `.../submissions` |
| `rules:publish` | Publicera, skicka tillbaka eller avveckla. Aldrig den egna inskickade versionen. | `.../publications`, `.../returns`, `.../retirements` |
| `rules:simulate` | Simulera en regelversion mot sparade beslut. Visar uppgifter ur ärenden inom anroparens omfång. | `.../simulations` |
| `catalog:read` | Läsa referensdata (ADR 0022) och produktversioner, produkter till salu och villkor för ett val (ADR 0023) | `GET /v1/reference-data/…`, `GET /v1/products/on-sale`, `GET /v1/products/{p}/versions…`, `.../{v}/vet-care-terms` |
| `catalog:write` | Skapa och ändra referensdata. Skriva produktutkast och skicka dem till granskning. | `PUT /v1/reference-data/{sort}/{kod}`, `POST`/`PUT /v1/products/{p}/versions…`, `.../submissions` |
| `catalog:publish` | Publicera eller skicka tillbaka produktversioner, aldrig den egna inskickade, och avsluta försäljning | `.../publications`, `.../returns`, `.../sales-ends` |
| `animals:read` | Läsa djurregistret: djur, id-nummer, ägare och historik (ADR 0024) | `GET /v1/animals`, `.../{id}`, `.../{id}/revisions` |
| `animals:write` | Registrera djur, rätta uppgifter, lägga till id-nummer och byta ägare | `POST /v1/animals`, `PUT .../{id}`, `.../identifiers`, `.../ownerships` |
| `animals:lookup` | Slå upp ett djur på id-nummer, utan ägare eller historik. Hittar bara djur som är öppna för uppslagning (ADR 0025). | `GET /v1/animal-lookup` |
| `access:read` | Läsa rollinställningen och dess historik (ADR 0020) | `GET /v1/access/roles`, `.../versions` |
| `access:manage` | Ändra rollinställningen, utom roller man själv har | `POST /v1/access/roles/versions` |
| `claims:approve` | Attestera eller skicka tillbaka en annan handläggares beslutsförslag (ADR 0019) | `POST /v1/claims/{id}/proposals/{p}/approvals`, `.../returns` |
| `claims:request-review` | Begära mänsklig prövning av ett automatiskt beslut för kundens räkning (ADR 0018) | `POST /v1/claims/{id}/decisions/{seq}/review-requests` |
| `claims:preview` | Få förhandsbesked utan att något sparas | `POST /v1/claim-previews` |
| `limits:read` | Se förbrukat och återstående försäkringsbelopp | `GET /v1/policies/{p}/animals/{a}/limits` |

## Standardroller

Petvold levereras med de här rollerna som utgångspunkt:

| Roll | Rättigheter | Bunden till | För |
| --- | --- | --- | --- |
| `handler` | Alla `claims:`-rättigheter utom `claims:approve`, samt `limits:read`, `catalog:read` och `animals:read`. Beslutar ensam upp till 25 000 SEK eller 2 500 EUR. | – | Skadehandläggare |
| `approver` | `claims:read`, `claims:approve`, `limits:read`, `catalog:read`, `animals:read`. Ingen gräns för attest. | – | Attestant |
| `admin` | `access:read`, `access:manage` | – | Administratör för roller och gränser |
| `rules-author` | `rules:read`, `rules:write`, `rules:simulate`, `catalog:read` | – | Skriver regelutkast |
| `rules-publisher` | `rules:read`, `rules:publish`, `rules:simulate`, `catalog:read` | – | Granskar och publicerar regler |
| `animal-registrar` | `animals:read`, `animals:write`, `catalog:read`, `parties:read` | – | Registrerar djur och ägarbyten, till exempel kundservice |
| `party-registrar` | `parties:read`, `parties:write` | – | Registrerar personer och organisationer, till exempel kundservice |
| `catalog-manager` | `catalog:read`, `catalog:write` | – | Underhåller referensdata och skriver produktutkast |
| `catalog-publisher` | `catalog:read`, `catalog:publish` | – | Granskar och publicerar produktversioner |
| `clinic` | `claims:register`, `claims:read`, `claims:preview`, `catalog:read`, `animals:lookup` | klinik | Veterinärklinik med direktreglering |
| `reassessment-job` | `claims:read`, `claims:reassess` | – | Maskinklient som omprövar ärenden, till exempel efter en retroaktiv ändring |
| `customer-channel` | `claims:read`, `claims:request-review`, `catalog:read` | försäkringar | Försäkringsbolagets kundportal eller app, som loggar in kunden själv och anropar Petvold för kundens räkning |

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
| Djur i en annan marknad, eller för en roll bunden till klinik eller försäkringar | `404` vid läsning, `403` vid registrering (ADR 0024) |
| Uppslagning av ett djur som är stängt, saknas eller finns i en annan marknad | Tom lista (ADR 0025) |
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

## Beloppsgränser och fyra ögon

En roll kan ha gränser per valuta, i minsta enhet (ADR 0019):

```ts
roles: {
  ...DEFAULT_ROLES,
  handler: { ...DEFAULT_ROLES.handler, decisionLimits: { SEK: 2_500_000, NOK: 2_500_000 } },
  'senior-handler': { permissions: ['claims:read', 'claims:decide'], decisionLimits: { SEK: 10_000_000 } },
  approver: { permissions: ['claims:read', 'claims:approve'], approvalLimits: { SEK: 50_000_000 } },
}
```

- `decisionLimits` gäller rättigheten `claims:decide`. En ersättning över gränsen blir ett beslutsförslag som någon annan måste attestera.
- `approvalLimits` gäller `claims:approve`. Över gränsen nekas attesten (`403`).
- **Flera roller.** Bara roller med rättigheten räknas, och den högsta gränsen gäller. En sådan roll utan gränser betyder ingen gräns.
- **Valuta utan gräns.** En valuta som saknas i en angiven gräns har gränsen 0, så att allt i den valutan kräver attest. Lägg därför till installationens alla valutor.
- **Fyra ögon.** Den som föreslog får aldrig attestera sitt eget förslag (`403`). Det gäller oavsett roller, och databasen spärrar det också.
- **Automatiska beslut** omfattas inte. Där gäller produktens gräns `autoSettleMax`.

Inställningarna kontrolleras när Petvold startar. En okänd rättighet eller bindning, till exempel ett stavfel, gör att Petvold inte startar. Ett stavfel kan alltså aldrig ge eller ta bort rättigheter i tysthet.

*(Planerat: inställningen läses från installationens konfiguration i stället för koden.)*

## Ändra roller och gränser via API

Rollinställningen är konfiguration per installation. Den ändras via API:et, utan ny version av Petvold och utan omstart (ADR 0020). Ett administrativt gränssnitt kan bygga direkt på anropen.

| Anrop | Rättighet | Gör |
| --- | --- | --- |
| `GET /v1/access/roles` | `access:read` | Visar gällande version: roller, rättigheter, bindningar och gränser |
| `GET /v1/access/roles/versions` | `access:read` | Visar alla versioner, äldst först |
| `POST /v1/access/roles/versions` | `access:manage` | Sparar en ny version av hela inställningen. Gäller direkt. |

Så höjer en administratör handläggarnas gräns till 50 000 kr:

1. Hämta gällande version med `GET /v1/access/roles`. Anta att den är version 3.
2. Ändra `handler.decisionLimits.SEK` till `5000000` i `roles`.
3. Skicka `POST /v1/access/roles/versions` med `{ "basedOnVersion": 3, "roles": { … }, "reason": "Nya gränser från 1 december" }`.

Spärrar:
- **Historiken sparas.** Varje version har `changedBy`, `changedAt` och en motivering, och ingen version ändras i efterhand. Det går därför att se vilken gräns som gällde när ett visst beslut fattades.
- **Ingen ändrar sina egna roller** (`403`). Den som ändrar får inte röra en roll den själv har. En administratör kan alltså inte ge sig själv attesträtt, och den sista administratören kan inte låsa ute sig själv.
- **Ändringar krockar inte.** Har någon annan sparat en version sedan `basedOnVersion` svarar Petvold `409`, och inget skrivs över.
- **Samma validering som vid start** (`422`): okända rättigheter, bindningar eller valutor och negativa gränser stoppas. En motivering krävs.
- **Standardrollen `admin`** har `access:read` och `access:manage`, men inga rättigheter i skadeärenden.

Första gången Petvold startar skapas version 1 från standardrollerna. **Standardroller som tillkommer i en senare version av Petvold läggs inte till automatiskt** i en installation som redan har en sparad inställning. En administratör lägger till dem som en ny version. Det är medvetet: inställningen ändras bara av någon som tar ansvar för ändringen.

*Inte byggt än:* fyra ögon för ändringar av inställningen. I dag kan en administratör ändra andra rollers gränser ensam, men varje ändring spåras.

## Lokalt

Dev-servern har elva tokens:

| Token | Roll | Omfång |
| --- | --- | --- |
| `dev-handler` | handläggare, beslutar ensam upp till 25 000 kr | alla marknader |
| `dev-approver` | attestant | alla marknader |
| `dev-admin` | administratör för roller och gränser | inga ärenden |
| `dev-author` | skriver regelutkast | inga ärenden |
| `dev-publisher` | publicerar regler | inga ärenden |
| `dev-catalog` | underhåller referensdata och skriver produktutkast | inga ärenden |
| `dev-catalog-publisher` | publicerar produktversioner | inga ärenden |
| `dev-registrar` | registrerar djur och parter | SE |
| `dev-clinic` | klinik | SE, klinik `clinic_001` |
| `dev-job` | omprövningsjobb | alla marknader |
| `dev-customer` | kundkanal | SE, försäkringen `pol_bella` |
