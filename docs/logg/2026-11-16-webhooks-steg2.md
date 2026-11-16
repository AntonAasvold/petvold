# Webhooks, steg 2: alla händelser och AsyncAPI (PR #77)

**Datum:** 2026-11-16 **ADR:** 0033, 0008 **Moduler:** webhooks, communications, api

## Vad
Skador, djur och kundmeddelanden går nu också ut med webhooks. Händelserna har ett eget kontrakt i AsyncAPI 3.0, och CI kontrollerar att kontraktet och listan över tillåtna fält är desamma.

## Hur det fungerar
1. **Katalogen** `PUBLIC_EVENTS` i `modules/webhooks/src/index.ts` har nu 24 typer. Ett `SourceEvent` bär id:t för sitt ämne i ett eget fält (`claimId`, `animalId`, `noticeId` och så vidare). `toCloudEvent` tar det fält som typen anger.
2. **Skador:** skademotorns händelser bär hela objekt: ärendet, beslutet med bedömningen och begäran med kundens ord. `claimsEventForWebhooks` i `wiring.ts` plattar ut dem till fält som katalogen sedan väljer bland. Marknad och valuta tas från ärendet.
3. **Djur:** djurregistrets händelser har redan marknaden i `data`. Reläet lämnar dem till webhooks efter policymodulen.
4. **Meddelanden:** `communications.outbox` (migration 0034) får `notice.created` när ett meddelande skapas och `notice.delivered` eller `notice.failed` när ett utskick rapporteras. `PostgresNoticeStore` skriver nu meddelandet och händelsen i en transaktion. Reläet har en fjärde källa, `communications`.
5. **Kontraktet:** `modules/api/asyncapi.yaml` har en kanal (prenumerationens adress), en operation (`send`) och ett meddelande per typ. Payloaden är `CloudEvent` plus ett schema för `data` med `additionalProperties: false`. `events-contract.ts` läser filen.
   - `eventContractProblems` jämför fälten med `PUBLIC_EVENTS` och körs i `lint:openapi`.
   - `eventValidator` används i testerna för att kontrollera varje händelse som skickas.

## Val och avvägningar
- **Två ställen anger fälten:** kontraktet och `PUBLIC_EVENTS`. Kontraktet är källan för mottagaren, och katalogen är det som körs. Lint-kontrollen gör att de inte kan glida isär. Ett alternativ var att läsa katalogen ur kontraktet när modulen startar, men då skulle modulen `webhooks` bero på en fil i `api`.
- **Skadornas händelser plattas ut i `api`**, inte i skademotorn. Skademotorns outbox är oförändrad, och dess egna tester och `relayOutbox` fungerar som förut.
- **Kontraktet skrevs med ett skript en gång** och underhålls sedan för hand, som `openapi.yaml`.
- **De gamla `webhooks` i OpenAPI är borttagna.** De beskrev feta händelser med hela ärendet, som aldrig levererades. Schemana för dem togs bort också.

## Att känna till
- En ny publik händelse kräver tre saker: en post i `PUBLIC_EVENTS`, ett meddelande i `asyncapi.yaml`, och en källa i reläet som lämnar den till `enqueue`.
- `asyncapi.yaml` publiceras på sajten bredvid `openapi.yaml`.

## Filer
- `modules/webhooks/src/index.ts`, `test/webhook-service.test.ts`
- `modules/communications/src/index.ts`, `src/postgres.ts`, `test-suites/notice-store.ts`, `test-db/notice-store.test.ts`
- `db/migrations/0034_communications_outbox.sql`, `db/test/claims-schema.test.ts`
- `modules/api/asyncapi.yaml` (ny), `src/events-contract.ts` (ny), `src/wiring.ts`, `src/composition.ts`, `scripts/check-contract.ts`, `openapi.yaml`, `test/webhooks.test.ts`
- `scripts/build-site.ts`
- `docs/funktion/webhooks.md`, `meddelanden.md`, `skadereglering.md`, `docs/teknik/arkitektur.md`, `api-konventioner.md`
