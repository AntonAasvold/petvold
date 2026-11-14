# Petvold

En headless kärna för djurförsäkring – hund, katt och häst – byggd API-first och för flera europeiska marknader från start.

Första modulen är skademotorn. Policy, produkt, tariff, billing och ledger kommer efter.

## Dokumentation

- [Arbetssätt](docs/arbetssatt.md) – roller, flöde och vad klart betyder
- [Roadmap](docs/roadmap.md) – milstolpar fram till första sålda försäkringen
- [Status](docs/status.md) – var vi är och nästa steg
- [Utvecklingsmiljö](docs/utvecklingsmiljo.md) – kom igång lokalt
- [Testning](docs/testning.md) – testlager och vad som krävs
- [Beslut](docs/adr/README.md) – arkitekturbeslut (ADR)

## Skademotorn

Skademotorn äger skadan: regler, beräkning, självriskperioder, förbrukat försäkringsbelopp, beslut och ledger.
Policydata äger den inte. Den läses via ett utbytbart gränssnitt, så motorn fungerar med befintlig kärna, Socotra eller en egen policykärna.

```
npm ci
cp .env.example .env
npm run dev:up         # Postgres och migreringar (kräver docker compose)
npm test               # 68 tester: enhet, egenskaper, tjänst och kontrakt
npm run test:db        # databasens regler mot Postgres
npm run typecheck
npm run lint:openapi   # kontrakt och implementation har exakt samma operationer
npm run dev            # http://localhost:8787, kontraktet på /openapi.yaml
```

Se [Utvecklingsmiljö](docs/utvecklingsmiljo.md) för detaljer.

Dev-servern har exempeldata (Bella, labrador) och två tokens: `dev-handler` och `dev-clinic`.

## Moduler

| Modul | Ansvar | Beror på |
| --- | --- | --- |
| `common` | Värdetyper: pengar, valuta, marknad, datum och datumintervall. Inga beroenden. | inget |
| `claims-core` | Domänen: bedömning, beräkning, beslut, ledger-poster. Ren TypeScript utan I/O, text eller ramverk. | common |
| `claims-api` | HTTP enligt `openapi.yaml`: validering mot kontraktet, auth, idempotens, problem+json, språk. | core |
| `claims-store-memory` | Lagring och policyport i minnet för tester och dev, plus exempeldata. | core |
| `db/migrations` | Postgres-schemat `claims` för drift (Postgres via CloudNativePG). | – |

Kärnan pratar med omvärlden via portar (`modules/claims-core/src/ports.ts`):

- `PolicyPort`: policyn som den gällde ett datum (giltighetstid) och var känd vid en tidpunkt (registreringstid).
- `RulesPort`: produktens skaderegler per produktversion.
- `ClaimsStore`: ärenden, beslut, självriskperioder och ledger. `commitDecision` är atomisk.
- `EventSink`: `claim.registered`, `claim.decided`. I drift en outbox i samma transaktion.
- `Clock`, `IdGenerator`.

## API-first

`modules/claims-api/openapi.yaml` (OpenAPI 3.1) är källan till sanning:

- Inkommande anrop valideras mot schemana i kontraktet (ajv), inte mot handskriven kod.
- Testerna validerar varje svar mot kontraktet.
- `lint:openapi` misslyckas om en operation finns i kontraktet men inte i koden, eller tvärtom.

| Operation | Syfte |
| --- | --- |
| `POST /v1/claims` | Registrera. Bedöms direkt och regleras automatiskt om reglerna tillåter. |
| `GET /v1/claims/{id}/assessment?knownAt=` | Aktuell bedömning, eller som underlaget såg ut vid en tidpunkt. |
| `POST /v1/claims/{id}/decisions` | Handläggarbeslut. `expectedInputHash` skyddar mot beslut på inaktuellt underlag (409). |
| `POST /v1/claims/{id}/reassessments` | Omprövning efter t.ex. retroaktiv policyändring. Ledgern bokar bara skillnaden. |
| `POST /v1/claim-previews` | Förhandsbesked i klinikens kassa. Sparar ingenting. |
| `GET /v1/policies/{p}/animals/{a}/limits?onDate=` | Förbrukat och återstående försäkringsbelopp. |

Alla skapande anrop kräver `Idempotency-Key`. Fel returneras som `application/problem+json`.

## Flera marknader

Inget i kärnan är landspecifikt. Det som skiljer marknader åt är konfiguration:

- **Marknad och valuta** (ISO 3166-1, ISO 4217) finns på varje ärende, bedömning och ledgerkonto. Valuta växlas aldrig: ett ärende i fel valuta stoppas.
- **Självriskmodell** (`DeductibleTerms`): fast självrisk per period och diagnosgrupp, per skada eller per försäkringsår. Rörlig självrisk kan öka med djurets ålder.
- **Moms** (`ClaimsRules.vatReimbursable`): ersätts eller dras ifrån per marknad.
- **Språk:** kärnan returnerar regelutfall som `reason` + `params`. API:et lägger på `message` enligt `Accept-Language` (sv, en). Nytt språk = ny katalog i `messages.ts`.

Testerna kör samma motor mot en svensk konfiguration (självriskperiod 125 dagar, 25 %) och en påhittad EUR-konfiguration (självrisk per skada, 20 % som blir 30 % från 8 år, moms ersätts inte).

## Beräkning

1. Ersättningsbart underlag = fakturerat − ej ersättningsbara kategorier − moms (om den inte ersätts).
2. Fast självrisk, enligt självriskmodellen.
3. Rörlig självrisk (baspunkter, åldersjusterad), avrundad halvt uppåt till hela ören.
4. Tak: det som återstår av årets försäkringsbelopp.

Designexemplet (18 640 kr fakturerat ger 12 165 kr) är ett test i `claims-core/test/assess.test.ts`.

## Databas

`db/migrations/0001_claims.sql` skapar schemat `claims`. Databasen garanterar själv att:

- varje journal balanserar (deferred constraint trigger)
- självriskperioder för samma djur och grupp aldrig överlappar (exclusion constraint)
- beslut och ledger inte kan ändras eller raderas (revoke)

Databastesterna i `db/test/` kontrollerar just de reglerna mot riktig Postgres i CI. Tjänsterollen `claims_service` får bara läsa och lägga till (`0002_claims_grants.sql`).

## Nästa steg

- `claims-store-postgres`: `ClaimsStore` mot schemat ovan, med beslut, journaler, perioder och outbox i en transaktion.
- `policy-adapter-*`: `PolicyPort` mot befintlig policykärna.
- Regler som versionerade paket per marknad i stället för `StaticRulesPort`.
- Klinikadapter för direktreglering och en dokumentmodul för beslutsbrev.
