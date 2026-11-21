# Händelsekontraktet: ordningsnummer, källor och ersättningens betydelse (PR #128)

**Datum:** 2026-11-21 **ADR:** 0033 **Moduler:** webhooks, policies, animals, communications, api

## Vad
Tre rättelser i händelsekontraktet, som specen för demotjänsten behöver:
- **`sequence`:** varje webhook bär nu händelsens plats i modulens outbox, som ADR 0033 lovar.
- **`/petvold/scheduling`** finns nu bland de tillåtna källorna. `job.failed` följde inte schemat tidigare.
- **`payout` i `claim.decided`** är beskriven som skadans hela ersättning efter beslutet.

## Hur det fungerar
- **Lagren:** `pendingEvents` i varje lager läser nu också outboxens `seq` (i skadornas outbox `id`) och sätter den som `sequence` på händelsen. Lagren i minnet använder platsen i listan.
- **Webhooks:** `SourceEvent` har `sequence?: number`. `toCloudEvent` gör om den till en sträng med 20 siffror, så att den sorterar rätt som text, som CloudEvents tillägg `sequence` kräver.
- **Skador:** `claimsEventForWebhooks` i `api/src/wiring.ts` tar numret från outboxens id.

## Val och avvägningar
- **Ett nummer per källa, inte globalt.** Varje modul har sin egen outbox, och ett globalt nummer skulle kräva en gemensam sekvens över modulgränserna (ADR 0001).
- **Glapp är tillåtna.** Postgres identitetskolumner hoppar över värden när en transaktion rullas tillbaka. Därför lovar kontraktet bara att numret ökar, och inte att det saknar glapp. En mottagare kan sortera med det, men inte dra slutsatsen att en händelse saknas.
- **Ingen migration.** Kolumnerna fanns redan.

## Att känna till
- **Levererade händelser i kön** som skapades före ändringen har ingen `sequence`. Fältet är valfritt i schemat.
- **`job.failed`** kommer direkt från körningarna och inte från någon outbox, och har därför ingen `sequence`.

## Filer
- `modules/webhooks/src/index.ts`, `modules/api/src/wiring.ts`, `modules/api/asyncapi.yaml`
- Outboxen i `modules/{policies,animals,communications}/src/{index,postgres}.ts`
- Sviterna för lagren och `modules/webhooks/test/webhook-service.test.ts`
- `docs/funktion/webhooks.md`
