# Kundmeddelanden (PR #70)

**Datum:** 2026-11-16 **ADR:** 0032 **Moduler:** communications (ny), api, common

## Vad
En ny modul, `communications`, gör ett kundmeddelande när lagen kräver att kunden får ett besked: när en policy tecknas, förnyas eller sägs upp, och när en ansökan avslås. Bolagets dokumentsystem hämtar meddelandena, gör och skickar dokumenten och rapporterar varje utskick. Ett meddelande som misslyckas eller inte skickas i tid hamnar i en kö för en person. Det är andra delen av ADR 0032.

## Hur det fungerar
1. **Reläet** (`modules/api/src/composition.ts`): källan `policies` lämnar varje händelse till `CommunicationsService.handlePolicyEvent` i `modules/communications/src/index.ts`.
2. **`plan`** avgör typen och läser det som behövs genom portarna `PolicySource` och `PartySource`. Adaptrarna `policySource` och `partySource` finns i `modules/api/src/wiring.ts`.
   - `policy.issued`: första termen, och dokumenten kunden godkände från transaktionen.
   - `policy.renewed`: den nya termen, och vad som ändrats mot förra termen (`changesBetween`).
   - `policy.cancelled`: transaktionens `cancellation`. Bolagets skäl ger `insurer-termination`, och kundens skäl ger `cancellation-confirmation`.
   - `application.declined`: reglernas skäl, eller personens skälskod om en person avslog.
3. **Lagrum och sista dag** kommer från `NOTICE_RULES` för marknaden. En marknad utan regler får inga meddelanden. Språket är partens, annars marknadens (`marketLanguage`).
4. **`NoticeStore.add`** sparar meddelandet. I Postgres gör `on conflict (source_event_id, type) do nothing` att en händelse som levereras igen inte ger något nytt.
5. **`addDelivery`** kontrollerar rapporten och lägger till den. `viewOf` räknar `status`, `late` och `overdue` när meddelandet läses.
6. **API:t** (`modules/api/src/app.ts`) har listan med filter, ett meddelande och rapporten. `seesNotice` begränsar till anroparens marknader och, för kundkanalen, dess policyer.

## Val och avvägningar
- **Meddelandet byggs när reläet levererar händelsen**, inte i policymodulens transaktion. Policymodulen behöver inte veta något om meddelanden, och meddelandemodulen läser policyn genom en port. Termer och transaktioner ändras aldrig, så innehållet blir detsamma som vid händelsen. Mottagaren läses från versionerna som de är kända vid leveransen. En rättelse av försäkringstagaren bakåt i tiden före leveransen ger alltså den rättade mottagaren.
- **"Snarast" blir tre dagar.** Lagen anger inget antal dagar. Värdet står i `NOTICE_RULES` som Petvolds förval tills bolagets inställningar finns (del 3).
- **Bolagets uppsägning ska vara skickad den dag den räknades från** (`receivedOn`). Ett utskick efter den dagen ger `late`, och `GET /v1/notices?type=insurer-termination&late=true` visar dem. Petvold flyttar inte upphörandedagen (ADR 0032 punkt 7). `late` finns kvar som bevis och tas inte bort, så kön (`attention`) har bara misslyckade och försenade meddelanden som inte har skickats.
- **Status räknas, den sparas inte.** Meddelanden och rapporter ändras aldrig, och status följer av rapporterna. Ett lyckat utskick gör meddelandet `sent`, även om ett senare nytt försök misslyckas.
- **`grounds` är anteckningen från uppsägningen.** Den får redan inte innehålla personuppgifter. Den tas bara med när bolaget sagt upp, eftersom en uppsägning från kunden inte behöver motiveras.
- **Ingen händelse `notice.created` än.** Dokumentsystemet hämtar `status=pending`. En egen outbox i modulen kan läggas till när ett dokumentsystem vill ha push.
- **Typer som lagen inte kräver** (`cancellation-confirmation`) skapas alltid. De kan stängas av när bolagets inställningar finns.

## Att känna till
- Erbjudandet om överlåtelse (`transfer-offer`) saknas. Ett förslag till en ny ägare skriver ingen händelse i dag, så policymodulen behöver en sådan först.
- Gallringen (ADR 0028) räknar inte meddelanden. De pekar på parten med id, och policyn håller redan relationen vid liv. När parten anonymiseras finns bara id:t kvar i meddelandet.
- En befintlig lokal databas behöver rollen `communications_service` innan `npm run db:migrate`. Exempeldatans gamla händelser är redan publicerade och ger inga meddelanden, så `npm run dev:reset` behövs för att se dem.
- `npm run roles:sync -- --apply` ger befintliga roller `notices:read` och lägger till `document-service`.

## Filer
- `modules/communications/` (ny): `src/index.ts`, `src/postgres.ts`, `test/`, `test-suites/notice-store.ts`, `test-db/notice-store.test.ts`
- `db/migrations/0031_communications.sql`, `db/init/01-roles-and-databases.sql`, `.env.example`, `db/test/claims-schema.test.ts`
- `modules/api/src/composition.ts`, `wiring.ts`, `app.ts`, `permissions.ts`, `dev-server.ts`, `server.ts`, `openapi.yaml`, `test/notices.test.ts`, `test/composition.test.ts`
- `docs/funktion/meddelanden.md` (ny), `behorighet.md`, `teckning.md`, `README.md`, `docs/teknik/arkitektur.md`, `drift.md` och `utvecklingsmiljo.md`
