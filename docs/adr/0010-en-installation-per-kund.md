# 0010. En installation per kund (silo)

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Petvold ska användas av etablerade försäkringsbolag eller av en egen försäkringsverksamhet, inte säljas som delad SaaS till många små aktörer. Försäkringsbolag kräver att deras data hålls isolerad, att de kan styra var den lagras, att revision är möjlig och att de själva hanterar risker med tredjepartsleverantörer av IKT (DORA). Valet av tenancymodell påverkar databasschemat, auth och driften, och det är dyrt att ändra när `claims-store-postgres` väl är byggd.

## Beslut

Varje kund får en egen installation: egen driftsenhet och eget Postgres-kluster (CloudNativePG). Koden känner inte till begreppet tenant, och tabellerna har ingen `tenant_id`.

Koden hålls fri från antaganden som skulle hindra en annan modell senare:

- Produkter, regler, marknader och språk är data per installation, inte kod.
- Varje anrop bär en autentiserad principal som tjänsterna får in explicit, aldrig via globalt tillstånd.
- Id:n är unika inom en installation. De får inte antas vara globalt unika.
- Marknad och kund är skilda begrepp. En installation kan ha flera marknader.
- Varumärke och distributör inom en kund modelleras som data på policyn (M2/M3), inte som tenancy.

## Konsekvenser

- Ingen kodkostnad och ingen risk för att data läcker mellan kunder genom en glömd `WHERE`.
- Varje kund kan uppgraderas, säkerhetskopieras, placeras i en region och granskas för sig.
- Driften växer linjärt med antalet kunder. Det kräver automatisering (manifest per kund, gemensam pipeline) men inga ändringar i koden.
- Kunder kan inte samköras på samma resurser, så en liten kund kostar lika mycket i grunddrift som en stor.
- Om affärsmodellen ändras till delad SaaS behövs en ny ADR, och `tenant_id` och Row Level Security måste läggas in i alla moduler.

## Alternativ

- **Delad databas med `tenant_id` och Row Level Security (pool):** billigare per kund men ger en risk för läckage i varje fråga, och kunder får ingen egen isolering. Det passar inte kundgruppen.
- **Ett schema per kund:** krockar med ett schema per modul (ADR 0001) och ger ändå delad drift.
- **Skjuta upp beslutet:** då skulle Postgres-lagret byggas utan att vi vet om `tenant_id` behövs.

## Källor

- Förordning (EU) 2022/2554 om digital operativ motståndskraft (DORA), särskilt kapitel V om risker med tredjepartsleverantörer av IKT.
- Microsoft Azure Architecture Center, *Tenancy models for a multitenant solution* (beskriver modellerna silo, pool och schema per tenant).
