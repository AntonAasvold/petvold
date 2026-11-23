# Behörighet

Vem som får göra vad i Petvold, och hur det ställs in för en installation. Beslutet bakom finns i ADR 0016.

## Så fungerar det

1. **Anroparen loggar in hos försäkringsbolagets identitetstjänst** och skickar en token med varje anrop. Tokenen innehåller anroparens roller. Petvold lagrar inga användare.
2. **Varje roll ger ett antal rättigheter.** Vilka rättigheter en roll ger ställs in per installation.
3. **Varje anrop kräver exakt en rättighet.** Den står i API-kontraktet (`x-permission`) och visas på API-sidan. Det enda undantaget är `GET /v1/me`, som alla inloggade får anropa (`x-permission: signed-in`), eftersom det bara visar anroparen själv.
4. **Saknas rättigheten** svarar Petvold `403` och anger vilken rättighet som krävs.
5. **Anroparen ser bara ärenden inom sitt omfång** (se nedan). Ett ärende utanför omfånget ger `404`, precis som ett ärende som inte finns.

En roll som inte finns i inställningarna ger inga rättigheter. Det finns ingen roll som ger allt.

## Vem är jag?

`GET /v1/me` visar vem anroparen är och vad den får göra just nu. Ett gränssnitt använder svaret för att välja vilka menyer och knappar som ska visas. API:t kontrollerar ändå varje anrop.

```json
{
  "subject": "handlaggare@example.test",
  "roles": ["handler"],
  "permissions": ["animals:read", "catalog:read", "claims:decide", "claims:override", "claims:preview", "claims:read", "..."],
  "scope": { "markets": "*" },
  "decisionLimits": { "SEK": 2500000, "EUR": 250000 }
}
```

- **`roles`** är de roller i token som installationen känner till. Okända roller står i `unknownRoles` och ger inget.
- **`scope`** visar marknaderna och, för bundna roller, kliniken (`clinicId`) eller försäkringarna (`policyIds`).
- **`decisionLimits` och `approvalLimits`** finns bara med `claims:decide` respektive `claims:approve`. `null` betyder ingen gräns, och en valuta som saknas har gränsen 0.
- Svaret följer rollinställningen som gäller, så en ändring syns vid nästa anrop.

## Rättigheter

| Rättighet | Ger rätt att | Anrop |
| --- | --- | --- |
| `claims:register` | Anmäla en skada, rätta den, lägga till bilagor, återkalla den före ett beslut, och registrera att begärt underlag har kommit in (ADR 0036) | `POST /v1/claims`, `POST /v1/claims/{id}/corrections`, `POST /v1/claims/{id}/attachments`, `POST /v1/claims/{id}/withdrawals`, `POST …/information-requests/{requestId}/answers` |
| `claims:read` | Läsa ett ärende, dess bedömning, beslut, förklaringar och begäranden om prövning, och räkna om ett beslut | `GET /v1/claims/{id}`, `.../assessment`, `.../decisions`, `.../decisions/{seq}/explanation`, `.../review-requests`, `POST .../decisions/{seq}/replays` |
| `claims:decide` | Fatta beslut i ett ärende, och avvisa det före ett beslut (ADR 0036) | `POST /v1/claims/{id}/decisions`, `POST /v1/claims/{id}/dismissals` |
| `claims:override` | Besluta mot bedömningens förslag, med skälkod och motivering (ADR 0018) | Kontrolleras inom `POST /v1/claims/{id}/decisions` |
| `claims:reassess` | Ompröva ett beslutat ärende | `POST /v1/claims/{id}/reassessments` |
| `rules:read` | Läsa regeluppsättningar (ADR 0021) | `GET /v1/rule-sets/{serie}/versions`, `.../{v}` |
| `rules:write` | Skapa och ändra utkast, skicka till granskning | `POST .../versions`, `PUT .../{v}`, `.../submissions` |
| `rules:publish` | Publicera, skicka tillbaka eller avveckla. Aldrig den egna inskickade versionen. | `.../publications`, `.../returns`, `.../retirements` |
| `rules:simulate` | Simulera en regelversion mot sparade beslut. Visar uppgifter ur ärenden inom anroparens omfång. | `.../simulations` |
| `catalog:read` | Läsa referensdata (ADR 0022) och produktversioner, produkter till salu och villkor för ett val (ADR 0023) | `GET /v1/reference-data/…`, `GET /v1/product-versions`, `GET /v1/products/{p}/versions…`, `.../{v}/vet-care-terms` |
| `catalog:write` | Skapa och ändra referensdata. Skriva produktutkast och skicka dem till granskning. | `PUT /v1/reference-data/{sort}/{kod}`, `POST`/`PUT /v1/products/{p}/versions…`, `.../submissions` |
| `catalog:publish` | Publicera eller skicka tillbaka produktversioner, aldrig den egna inskickade, och avsluta försäljning | `.../publications`, `.../returns`, `.../sales-endings` |
| `parties:privacy` | Se begränsade parter, registrera och avslå begäranden om radering (ADR 0028) | `POST /v1/parties/{id}/erasure-requests`, `GET /v1/erasure-requests`, `.../rejections` |
| `parties:erase` | Godkänna någon annans begäran om radering, vilket anonymiserar parten, och ändra lagringstider | `POST /v1/erasure-requests/{id}/approvals`, `POST /v1/settings/retention/versions` |
| `parties:retention` | Köra gallringen, som begär anonymisering av parter vars lagringstid har gått ut | `POST /v1/retention-runs` |
| `animals:read` | Läsa djurregistret: djur, id-nummer, ägare och historik (ADR 0024) | `GET /v1/animals`, `.../{id}`, `.../{id}/revisions` |
| `animals:write` | Registrera djur, rätta uppgifter, lägga till id-nummer och byta ägare | `POST /v1/animals`, `PUT .../{id}`, `.../identifiers`, `.../ownerships` |
| `animals:lookup` | Slå upp ett djur på id-nummer, utan ägare eller historik. Hittar bara djur som är öppna för uppslagning (ADR 0025). | `GET /v1/animal-summaries` |
| `policies:read` | Läsa policyer, termer och historik (ADR 0029) | `GET /v1/policies`, `.../{id}`, `.../history`, `.../snapshot` |
| `policies:quote` | Prisindikation, utan att något sparas (ADR 0030) | `POST /v1/quotes` |
| `policies:price-override` | Sätta en annan premie än tariffens, med motivering (ADR 0030) | `POST /v1/policies`, `.../changes`, `.../renewals` med `premium` och `priceOverride` |
| `policies:write` | Teckna, ändra, förnya, avsluta och återkalla avslut av policyer, och besvara förslag, och hantera grupper | `POST /v1/policies`, `POST /v1/policy-groups`, `.../members`, `.../changes`, `.../renewals`, `.../cancellations`, `.../reinstatements`, `POST /v1/policy-proposals/{id}/acceptances`, `.../rejections` |
| `policies:renew` | Schemalagda körningar: förnyelse, avslut av överlåtelser som inte godkändes i tid, och utgång av ansökningar | `POST /v1/renewal-runs`, `POST /v1/policy-proposal-expiry-runs`, `POST /v1/application-expiry-runs` |
| `policies:underwrite` | Besluta om en ansökan i kön för manuell prövning: godkänna, med eller utan förbehåll, eller avslå med skälskod (ADR 0031) | `POST /v1/applications/{id}/decisions` |
| `notices:read` | Läsa kundmeddelanden och deras utskick (ADR 0032), och bolagets inställningar för dem. Meddelandena har partens id, inte namn eller adress. | `GET /v1/notices`, `.../{id}`, `GET /v1/settings/notices`, `.../versions` |
| `notices:deliver` | Rapportera att ett meddelande skickades, med dokumentets id och kontrollsumma, eller att utskicket misslyckades | `POST /v1/notices/{id}/deliveries` |
| `notices:configure` | Ändra bolagets inställningar för meddelanden: texter, dagar för "snarast" och typer som stängs av | `POST /v1/settings/notices/versions` |
| `webhooks:read` | Läsa prenumerationer på webhooks och deras utskick (ADR 0033), aldrig hemligheterna | `GET /v1/webhook-subscriptions`, `.../{id}`, `.../deliveries`, `GET /v1/webhook-deliveries` |
| `webhooks:manage` | Skapa och ändra prenumerationer, byta hemlighet och skicka döda händelser igen | `POST /v1/webhook-subscriptions`, `PUT .../{id}`, `.../secret-rotations`, `.../retries`, `.../delivery-retries` |
| `jobs:read` | Se körningarna, deras historik och reläets döda poster (ADR 0037) | `GET /v1/jobs`, `GET /v1/jobs/{job}`, `.../runs`, `GET /v1/relay-dead-letters` |
| `jobs:operate` | Köra en körning nu, pausa och återuppta den, och skicka en död post igen. Gäller direkt, utan fyra ögon. | `POST /v1/jobs/{job}/runs`, `.../pauses`, `.../resumptions`, `POST /v1/relay-dead-letters/{deadLetter}/retries` |
| `jobs:configure` | Föreslå, godkänna och avvisa ändringar av en körnings schema. Fyra ögon: den som föreslog kan inte godkänna. | `POST /v1/jobs/{job}/schedule-changes`, `.../{changeId}/approvals`, `.../rejections` |
| `access:read` | Läsa rollinställningen och dess historik (ADR 0020) | `GET /v1/settings/roles`, `.../versions` |
| `access:manage` | Ändra rollinställningen, utom roller man själv har | `POST /v1/settings/roles/versions` |
| `claims:approve` | Attestera eller skicka tillbaka en annan handläggares beslutsförslag (ADR 0019) | `POST /v1/claims/{id}/proposals/{p}/approvals`, `.../returns` |
| `claims:request-review` | Begära mänsklig prövning av ett automatiskt beslut för kundens räkning (ADR 0018) | `POST /v1/claims/{id}/decisions/{seq}/review-requests` |
| `documents:read` | Läsa dokument och öppna dem med en länk som gäller i 15 minuter. Dessutom krävs rätten till det dokumentet hör till (ADR 0038). | `GET /v1/documents`, `GET /v1/documents/{id}`, `GET` och `POST …/links` |
| `documents:share` | Ge kunden en länk som gäller upp till 7 dagar, och spärra en länk | `POST …/links` med `audience: customer`, `POST …/links/{linkId}/revocations` |
| `claims:request-information` | Begära komplettering av kunden eller kliniken, och återkalla en begäran (ADR 0036). Svaret registreras med `claims:register`. | `POST /v1/claims/{id}/information-requests`, `POST …/information-requests/{requestId}/cancellations` |
| `billing:read` | Läsa betalarkonton, premieplaner och fakturor (ADR 0040) | `GET /v1/payer-accounts`, `.../{id}`, `GET /v1/premium-plans`, `GET /v1/invoices`, `.../{id}`, `GET /v1/credit-notes`, `.../{id}`, `GET /v1/received-payments`, `.../{id}` |
| `payments:read` | Läsa inbetalningar, utbetalningar och maskade betaluppgifter (ADR 0017, 0040) | `GET /v1/payments`, `.../{id}`, `GET /v1/payouts`, `.../{id}`, `GET /v1/payees/{partyId}/accounts` |
| `payments:payee-write` | Ge en parts betaluppgifter. Det sparas vem som gav dem (ADR 0040) | `POST /v1/payees/{partyId}/accounts` |
| `payments:release` | Släppa en utbetalning som spärrats för att betaluppgifterna är nya, men inte den man själv gav uppgifterna till | `POST /v1/payouts/{id}/releases` |
| `billing:write` | Koppla en inbetalning utan användbar referens till ett betalarkonto eller en faktura (ADR 0040) | `POST /v1/received-payments/{id}/matches` |
| `claims:preview` | Få förhandsbesked utan att något sparas | `POST /v1/claim-previews` |
| `limits:read` | Se förbrukat och återstående försäkringsbelopp | `GET /v1/policies/{p}/limits` |

## Standardroller

Petvold levereras med de här rollerna som utgångspunkt:

| Roll | Rättigheter | Bunden till | För |
| --- | --- | --- | --- |
| `handler` | Alla `claims:`-rättigheter utom `claims:approve`, samt `limits:read`, `catalog:read`, `animals:read`, `parties:read`, `policies:read` och `notices:read`. Beslutar ensam upp till 25 000 SEK eller 2 500 EUR. | – | Skadehandläggare |
| `approver` | `claims:read`, `claims:approve`, `limits:read`, `catalog:read`, `animals:read`. Ingen gräns för attest. | – | Attestant |
| `admin` | `access:read`, `access:manage` | – | Administratör för roller och gränser |
| `rules-author` | `rules:read`, `rules:write`, `rules:simulate`, `catalog:read` | – | Skriver regelutkast |
| `rules-publisher` | `rules:read`, `rules:publish`, `rules:simulate`, `catalog:read` | – | Granskar och publicerar regler |
| `animal-registrar` | `animals:read`, `animals:write`, `catalog:read`, `parties:read` | – | Registrerar djur och ägarbyten, till exempel kundservice |
| `party-registrar` | `parties:read`, `parties:write` | – | Registrerar personer och organisationer, till exempel kundservice |
| `policy-registrar` | `policies:read`, `policies:write`, `policies:quote`, `animals:read`, `parties:read`, `catalog:read`, `notices:read` | – | Tecknar policyer, till exempel säljkanal eller kundservice |
| `underwriter` | `policies:read`, `policies:write`, `policies:quote`, `policies:price-override`, `policies:underwrite`, `animals:read`, `parties:read`, `catalog:read`, `notices:read` | – | Beslutar om ansökningar och priser som behöver en person, till exempel manuellt pris |
| `document-service` | `notices:read`, `notices:deliver`, `parties:read`, `policies:read`, `catalog:read` | – | Bolagets dokumentsystem: hämtar meddelanden, gör och skickar dokumenten och rapporterar utskicken (ADR 0032) |
| `integration-admin` | `webhooks:read`, `webhooks:manage` | – | Kopplar bolagets system till Petvolds händelser med webhooks (ADR 0033) |
| `operations` | `jobs:read`, `jobs:operate`, `jobs:configure`, `webhooks:read` | – | Driften: följer och styr körningarna och reläet (ADR 0037) |
| `communications-manager` | `notices:read`, `notices:configure` | – | Skriver bolagets texter i meddelandena och ändrar inställningarna, till exempel compliance eller kundkommunikation |
| `renewal-job` | `policies:renew` | – | Schemalagd förnyelse, avslut av överlåtelser som inte godkändes i tid och utgång av ansökningar |
| `privacy-officer` | `parties:read`, `parties:privacy`, `parties:erase`, `parties:retention` | – | Dataskyddsansvarig. Två personer behövs för att anonymisera. |
| `retention-job` | `parties:retention` | – | Schemalagd gallringskörning. Begär bara, och en dataskyddsansvarig godkänner. |
| `catalog-manager` | `catalog:read`, `catalog:write` | – | Underhåller referensdata och skriver produktutkast |
| `catalog-publisher` | `catalog:read`, `catalog:publish` | – | Granskar och publicerar produktversioner |
| `clinic` | `claims:register`, `claims:read`, `claims:preview`, `catalog:read`, `animals:lookup` | klinik | Veterinärklinik med direktreglering |
| `reassessment-job` | `claims:read`, `claims:reassess` | – | Maskinklient som omprövar ärenden, till exempel efter en retroaktiv ändring |
| `billing-clerk` | `billing:read`, `billing:write`, `payments:read`, `payments:payee-write`, `payments:release`, `policies:read`, `parties:read`, `catalog:read` | – | Följer premierna, till exempel ekonomiavdelningen (ADR 0040) |
| `customer-channel` | `claims:read`, `claims:request-review`, `catalog:read`, `policies:read`, `policies:quote`, `notices:read`, `billing:read` | försäkringar | Försäkringsbolagets kundportal eller app, som loggar in kunden själv och anropar Petvold för kundens räkning |

## Omfång

Rättigheten säger *vad* anroparen får göra. Omfånget säger *vilka data* det gäller: skador, policyer, ansökningar, djur, parter, meddelanden och premieplaner. En roll bunden till försäkringar ser premieplanerna för sina policyer men inga betalarkonton. Omfånget kommer från attribut i tokenen:

| Attribut | Betydelse | Krävs för |
| --- | --- | --- |
| `markets` | Marknaderna anroparen arbetar i, till exempel `["SE"]`, eller `"*"` för alla marknader i installationen | Alla. Utan `markets` ser anroparen ingenting. |
| `clinicId` | Klinikens id | Roller bundna till klinik |
| `policyIds` | Försäkringarna anroparen får se, till exempel den inloggade kundens | Roller bundna till försäkringar |

Reglerna:
- **Marknad.** Alla ser bara data i sina marknader.
- **Klinik.** En roll bunden till klinik ser bara skador som kliniken själv har skickat in, och inga policyer, ansökningar eller meddelanden. När en klinik anmäler en skada sparas klinikens id från tokenen på ärendet. Det går inte att ange id:t i anropet.
- **Försäkringar.** En roll bunden till försäkringar ser bara skador, policyer och meddelanden på de försäkringar som står i tokenen, och inga ansökningar. Kundportalen slår upp kundens försäkringar och lägger dem i tokenen.
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
| Policy, ansökan eller meddelande utanför omfånget | `404` |
| Teckna, ansöka eller köra en schemalagd körning i en annan marknad, eller för en roll bunden till klinik eller försäkringar | `403` |

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
| `GET /v1/settings/roles` | `access:read` | Visar gällande version: roller, rättigheter, bindningar och gränser |
| `GET /v1/settings/roles/versions` | `access:read` | Visar alla versioner, äldst först |
| `POST /v1/settings/roles/versions` | `access:manage` | Sparar en ny version av hela inställningen. Gäller direkt. |

Så höjer en administratör handläggarnas gräns till 50 000 kr:

1. Hämta gällande version med `GET /v1/settings/roles`. Anta att den är version 3.
2. Ändra `handler.decisionLimits.SEK` till `5000000` i `roles`.
3. Skicka `POST /v1/settings/roles/versions` med `{ "basedOnVersion": 3, "roles": { … }, "reason": "Nya gränser från 1 december" }`.

Spärrar:
- **Historiken sparas.** Varje version har `changedBy`, `changedAt` och en motivering, och ingen version ändras i efterhand. Det går därför att se vilken gräns som gällde när ett visst beslut fattades.
- **Ingen ändrar sina egna roller** (`403`). Den som ändrar får inte röra en roll den själv har. En administratör kan alltså inte ge sig själv attesträtt, och den sista administratören kan inte låsa ute sig själv.
- **Ändringar krockar inte.** Har någon annan sparat en version sedan `basedOnVersion` svarar Petvold `409`, och inget skrivs över.
- **Samma validering som vid start** (`422`): okända rättigheter, bindningar eller valutor och negativa gränser stoppas. En motivering krävs.
- **Standardrollen `admin`** har `access:read` och `access:manage`, men inga rättigheter i skadeärenden.

Första gången Petvold startar skapas version 1 från standardrollerna. **Standardroller som tillkommer i en senare version av Petvold läggs inte till automatiskt** i en installation som redan har en sparad inställning. En administratör lägger till dem som en ny version. Det är medvetet: inställningen ändras bara av någon som tar ansvar för ändringen.

**`npm run roles:sync`** gör det enklare efter en uppgradering. Det jämför den sparade inställningen med standardrollerna och visar vad som saknas: hela roller och rättigheter som en roll med samma namn saknar. Med `npm run roles:sync -- --apply` sparas ändringen som en ny version, med `roles-sync` som ändrare och en motivering som räknar upp tilläggen.
- Inget tas bort, och bindningar och beloppsgränser är oförändrade.
- **Läs listan innan du kör `--apply`.** En standardrättighet som installationen medvetet har tagit bort kommer tillbaka.
- Skriptet använder `ACCESS_DATABASE_URL`.

*Inte byggt än:* fyra ögon för ändringar av inställningen. I dag kan en administratör ändra andra rollers gränser ensam, men varje ändring spåras.

## Lokalt

Dev-servern har de här tokens:

| Token | Roll | Omfång |
| --- | --- | --- |
| `dev-handler` | handläggare, beslutar ensam upp till 25 000 kr | alla marknader |
| `dev-all`, `dev-all-2` | alla roller som används i back office, för att prova allt lokalt. Två personer, så att fyra ögon går att prova. Jobben, kliniken och kundkanalen ingår inte, eftersom de binder anroparen till egna ärenden. Finns bara i dev-servern, aldrig i standardrollerna. | alla marknader |
| `dev-approver` | attestant | alla marknader |
| `dev-admin` | administratör för roller och gränser | inga ärenden |
| `dev-author` | skriver regelutkast | inga ärenden |
| `dev-publisher` | publicerar regler | inga ärenden |
| `dev-catalog` | underhåller referensdata och skriver produktutkast | inga ärenden |
| `dev-catalog-publisher` | publicerar produktversioner | inga ärenden |
| `dev-registrar` | registrerar djur och parter | SE |
| `dev-privacy`, `dev-privacy-2` | två dataskyddsansvariga | SE |
| `dev-retention-job` | gallringskörning | alla |
| `dev-seller` | tecknar, förnyar och avslutar policyer | SE |
| `dev-underwriter` | beslutar om ansökningar och manuella priser | SE |
| `dev-documents` | bolagets dokumentsystem | SE |
| `dev-communications` | bolagets inställningar för meddelanden | SE |
| `dev-integration` | prenumerationer på webhooks | alla |
| `dev-renewal-job` | förnyelsekörning | alla |
| `dev-clinic` | klinik | SE, klinik `clinic_001` |
| `dev-job` | omprövningsjobb | alla marknader |
| `dev-customer` | kundkanal | SE, försäkringen `pol_bella` |
