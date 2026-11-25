# Diagram över arkitekturen, driften och skalningen (PR #169)

**Datum:** 2026-11-25 **ADR:** 0001, 0008, 0037, 0041 **Moduler:** inga, bara dokumentation

## Vad
Skisserna från whiteboarden *Petvold – arkitektur* och sidan *Skala Petvold* finns nu i dokumentationen som mermaid-diagram, som GitHub ritar direkt.

## Hur det fungerar
- **`docs/teknik/arkitektur.md`:** översikten visar alla moduler per område (Försäljning, Skador, Pengar, Kunden, Plattform), de rena kärnorna och de viktigaste portarna. Avsnittet *Händelser* har ett diagram över vilka moduler varje outbox levererar till, och tabellen tar med alla sju outboxar.
- **`docs/teknik/demo.md`:** det nya avsnittet *Så körs demon* visar containrarna, ordningen vid start och vägen in, med ett exempel på en VM hemma bakom en router.
- **`docs/teknik/skalning.md`** (ny): fem steg från större server till Kubernetes, var de 33 anslutningarna per instans kommer ifrån och varför PgBouncer behövs vid fler än två instanser.

## Val och avvägningar
- **Mermaid i stället för bilder,** så att diagrammen ändras i samma PR som koden och syns i diffen.
- **Portar som pilar bara där de förklarar något.** Alla portar finns redan i tabellen under *Portar och adaptrar*.

## Att känna till
- **Rättat:** *Händelser* nämnde bara fyra outboxar och sa att ett lås per outbox behövdes före drift med flera instanser. Lånet `relay` (ADR 0037) finns sedan länge, och texten hänvisar nu dit.
- **Antalet anslutningar** är räknat från poolerna i `composition.ts` den 25 november. Ändras en pool behöver tabellen i `skalning.md` följa med.
- **Prövat:** alla sex diagrammen tolkas av mermaid 11, `site` bygger utan brutna länkar och `lint:lang` är grön.

## Filer
- `docs/teknik/arkitektur.md`, `demo.md`, `drift.md`, `skalning.md` (ny)
- `docs/README.md`
