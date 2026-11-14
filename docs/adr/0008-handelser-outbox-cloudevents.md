# 0008. Händelser via outbox och CloudEvents

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Moduler måste få veta vad som hänt utan att dela databas, och inga händelser får tappas.

## Beslut

Varje modul skriver händelser till sin outbox i samma transaktion som ändringen. En relä publicerar som CloudEvents till molnets meddelandetjänst. Konsumenter har en inbox för idempotens. Händelsetyper versioneras.

## Konsekvenser

Tillförlitligt utan Kafka. Minst en leverans, så konsumenter måste tåla dubbletter.

## Tillägg 2026-11-14

CloudEvents-kuvert och AsyncAPI väntar tills det finns en mottagare utanför Petvold, till exempel en webhook eller en meddelandekö. Fram till dess publicerar reläet händelserna som de ligger i outboxen. De har redan typ, tid och ett ordnat id, så kuvertet blir en ändring i reläet. Vi håller oss till Postgres: pollning av outboxen nu, LISTEN/NOTIFY om fördröjningen stör, och pg-boss om vi behöver jobb med omförsök, till exempel för betalningar.

## Alternativ

Kafka från start: för mycket drift. Direkta anrop: kopplar modulerna hårt.
