# Referensdata: arter, raser och kön (PR #32)

**Datum:** 2026-11-15 **ADR:** 0021, 0022 (Föreslagen) **Moduler:** `catalog` (ny), `api`

## Vad

Petvold har nu kodlistor för arter, raser och kön, med etiketter på flera språk och full historik. En administratör med rollen `catalog-manager` underhåller listorna via API:et. Kliniker, kundkanaler och handläggare läser dem på sitt eget språk. Det här är första delen av produktkatalogen. Produkter och produktversioner kommer i nästa PR.

## Hur det fungerar

Ett anrop `PUT /v1/reference-data/breed/dog-beagle` går så här:

1. **`api/src/app.ts`** autentiserar anroparen och slår upp rättigheten `catalog:write` i kontraktet (`x-permission`). Kroppen valideras mot schemat `ReferenceItemChange` i `openapi.yaml`, vilket stoppar okända fält och ogiltiga språktaggar redan här.
2. **`CatalogService.putReference`** i `catalog/src/index.ts`:
   - kontrollerar sorten och koden
   - städar etiketterna (tar bort blanksteg och kontrollerar längden)
   - läser hela historiken för koden
   - avgör vad anropet är:
     - **upprepning:** revisionen efter `basedOnRevision` finns redan och har samma innehåll, och då returneras den
     - **ingen ändring:** innehållet är detsamma som gällande revision, och då returneras den
     - **krock:** gällande revision är inte `basedOnRevision`, och då blir det `409`
     - **ny revision:** allt annat
   - kräver för en ny ras att arten finns och är aktiv, och för en ändring att arten är densamma och att det finns en motivering
3. **`PostgresReferenceDataStore.append`** i `catalog/src/postgres.ts` gör `insert … select … where revision = max + 1`. Påverkas ingen rad har någon hunnit före, och det blir `ReferenceConflictError`. Två samtidiga anrop som båda ser samma max stoppas av primärnyckeln `(kind, code, revision)`.
4. **Triggern `catalog.check_reference_item`** (migration 0013) kontrollerar en gång till att arten finns och att föregående revision har samma förälder. Det gör att regeln gäller även om någon skriver direkt i databasen.
5. **Svaret** får `label`, som `labelFor()` väljer utifrån `Accept-Language`. Status är `201` om koden skapades och annars `200`.

Läsning (`GET /v1/reference-data/breed?parent=dog`) hämtar högsta revisionen per kod med `select distinct on (code) … order by code, revision desc` och filtrerar sedan på förälder och aktiv i tjänsten.

## Val och avvägningar

- **En rad per revision i stället för uppdatering.** Tjänsterollen saknar `update` och `delete`, så historiken kan inte skrivas om, inte ens av en bugg i Petvold. Samma mönster som rollinställningen (ADR 0020), men per kod i stället för hela listan, eftersom en ändrad ras inte ska ge en ny version av alla raser.
- **`PUT` utan `Idempotency-Key`.** Övriga skrivande anrop kräver nyckeln. Här räcker `basedOnRevision`: en upprepning känns igen på att nästa revision redan har exakt samma innehåll. Det är enklare för den som läser in en hel raslista.
- **Förälder som aldrig ändras.** En ras som flyttas mellan arter skulle i tysthet ändra betydelsen för alla djur med den rasen. Rätt väg är att avaktivera den och skapa en ny kod.
- **Etiketter som data, inte i `messages.ts`.** Språkkatalogen är Petvolds egna texter. Raslistor ägs av försäkringsbolaget och ändras utan ny version av Petvold.
- **Ingen fyraögonsprincip.** Referensdata påverkar inte beslut eller pengar direkt. Produktversioner får fyra ögon.
- **Fast lista med sorter** (`species`, `breed`, `sex`) både i kod och i en check-constraint. En ny sort blir ett medvetet beslut med en migration, inte ett stavfel i ett anrop.

## Att känna till

- **Exempeldatan** ligger i `modules/catalog/seed/reference-data.json` och har svenska etiketter. Filen är därför undantagen i `npm run lint:lang`, på samma sätt som `messages.ts`. Arter står före raser i filen, eftersom en ras kräver att arten finns.
- **Nya standardroller och `catalog:read`** når inte en installation som redan har en sparad rollinställning. En administratör lägger till dem (ADR 0020).
- **Lokal databas:** rollen `catalog_service` skapas av `db/init` bara när databasen är ny. En befintlig databas behöver `npm run dev:reset` eller `create role catalog_service …`.
- **`labelFor`** jämför språktaggar utan att bry sig om skiftläge men följer inte `q`-värden. Ordningen i headern avgör, vilket räcker för webbläsare och appar.
- **Inte byggt än:** diagnoskoder och fakturakategorier som sorter, och import av en hel lista i ett anrop.

## Filer

- `modules/catalog/src/index.ts`: typer, `CatalogService`, `labelFor`, lagring i minnet
- `modules/catalog/src/postgres.ts`: lagring i Postgres
- `db/migrations/0013_catalog_reference_data.sql`: schema, trigger och rättigheter
- `modules/catalog/test-suites/reference-data-store.ts`: gemensam testsvit för båda lagringarna
- `modules/catalog/test/catalog-service.test.ts`, `modules/api/test/reference-data.test.ts`, `modules/catalog/test-db/reference-data-store.test.ts`
- `modules/api/openapi.yaml`: fyra operationer under `/v1/reference-data`
- `modules/api/src/permissions.ts`: `catalog:read`, `catalog:write`, rollen `catalog-manager`
