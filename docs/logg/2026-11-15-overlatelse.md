# Överlåtelse och dödsfall från djurregistrets händelser (PR #49)

**Datum:** 2026-11-15 **ADR:** 0008, 0029 **Moduler:** `animals`, `policies`, `api`

## Vad

När ett djur säljs eller dör i djurregistret får policyn ett förslag:
- **Försäljning:** samma policy byter försäkringstagare från försäljningsdagen när den nya ägaren har godkänt villkoren, och annars avslutas den.
- **Dödsfall:** policyn avslutas från dödsdagen när förslaget godkänns.

## Hur det fungerar

1. **Djurregistret.** `AnimalService.transfer` bygger `animal.ownership_changed`. `correct` bygger `animal.died` när dödsdatumet sätts eller ändras. Båda skrivs till `animals.outbox` i samma transaktion som ändringen (`AnimalStore.transfer(…, events)` och `appendRevision(animal, events)`).
2. **Relayn.** Installationens relay hämtar `pendingEvents`, anropar `PolicyService.handleAnimalEvent` och markerar dem som publicerade. I dev-servern är det en `setInterval`.
3. **Förslaget.** `handleAnimalEvent` hittar djurets policy med en aktiva version efter dagen (`policyInForce`) och sparar ett `Proposal`. `addProposal` gör `on conflict (source_event_id) do nothing`, så en händelse som kommer två gånger ger bara ett förslag. En överlåtelse får `deadline`: den senare av försäljningsdagen och i dag, plus produktens `transferAcceptanceDays`.
4. **Godkännandet.** `acceptProposal` för en överlåtelse:
   - kontrollerar sista dagen och att den nya parten finns i marknaden
   - delar de aktiva versionerna som den förra ägaren har efter försäljningsdagen: delen före får samma ägare, och delen efter får den nya
   - räknar premien för dagarna efter med `refundFor`
   - sparar transaktionen (`type: transfer`), händelserna och beslutet i en transaktion med `PolicyStore.apply(…, decision)`
5. **Avslut via `cancel`.** Ett dödsfall, en avböjd överlåtelse och en överlåtelse som löpt ut (`expireProposals`) går alla genom `cancel` med `need-ceased`. Beslutet skickas med, så det sparas i samma transaktion.

## Val och avvägningar

- **Förslag, inte automatik.** Ett dödsfall eller en försäljning kan vara felregistrerad. En människa godkänner, och ett avböjt dödsfall ändrar inget.
- **Godkännandet sparas med kanal och referens**, eftersom den nya ägaren blir part i avtalet (ADR 0029).
- **En outbox per modul** och en relay i installationen, som skademotorn (ADR 0008). Policymodulen läser inte djurregistrets tabeller.
- **Sista dagen räknas från i dag** om försäljningen registreras sent, så att den nya ägaren alltid får hela tiden.

## Att känna till

- En försäljning före policyns början flyttar hela policyn till den nya ägaren.
- Premien flyttas bara som belopp i transaktionen. Själva betalningen kommer med M5.
- Migration 0025 kan backas, men då försvinner överlåtelser. Ersatta versioner blir gällande igen.

## Filer

- `modules/animals/src/index.ts`, `modules/animals/src/postgres.ts`, `db/migrations/0024_animals_outbox.sql`
- `modules/policies/src/index.ts` (`handleAnimalEvent`, `acceptProposal`, `rejectProposal`, `expireProposals`), `modules/policies/src/postgres.ts`, `db/migrations/0025_policies_transfer.sql`
- `modules/api/src/app.ts`, `modules/api/src/dev-server.ts`, `modules/api/openapi.yaml`
- `modules/policies/test/policy-service.test.ts`, `modules/policies/test-suites/policy-store.ts`, `modules/animals/test/animal-service.test.ts`, `modules/api/test/policies.test.ts`
