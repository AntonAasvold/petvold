# 0008. Händelser via outbox och CloudEvents

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Moduler måste få veta vad som hänt utan att dela databas, och inga händelser får tappas.

## Beslut

Varje modul skriver händelser till sin outbox i samma transaktion som ändringen. En relä publicerar som CloudEvents till molnets meddelandetjänst. Konsumenter har en inbox för idempotens. Händelsetyper versioneras.

## Konsekvenser

Tillförlitligt utan Kafka. Minst en leverans, så konsumenter måste tåla dubbletter.

## Alternativ

Kafka från start: för mycket drift. Direkta anrop: kopplar modulerna hårt.
