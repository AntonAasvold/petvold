# Back office, steg 4: meddelanden och webhooks (PR #83)

**Datum:** 2026-11-16 **ADR:** 0035, 0032, 0033 **Moduler:** apps/backoffice

## Vad
Två nya avsnitt:
- **Meddelanden:** kön med det som behöver en person, meddelandet, och att rapportera ett utskick.
- **Webhooks:** prenumerationer och döda händelser, att skapa och ändra en prenumeration, byta hemlighet och skicka igen.

## Hur det fungerar
1. **Meddelandenas kö** har en flik per filter: `attention=true`, `status=pending`, `status=sent`, `late=true` och alla. `noticeFlags` visar varför ett meddelande behöver en person.
2. **Meddelandet:** innehållet visas som fält. Ett objekt, till exempel en premie, visas som JSON. Formuläret för utskick skickar `POST .../deliveries` med tiden nu och valt resultat.
3. **Webhooks** hämtar prenumerationerna och de döda utskicken samtidigt, högst 200 av varje. Prenumerationerna är få, och den döda listan är en kö som ska tömmas.
4. **En ny prenumeration** kontrolleras med `subscriptionProblems` innan den skickas. API:t kontrollerar ändå privata adresser och vilka typer som finns. Hemligheten i svaret visas i `<pv-secret-callout>` och sparas inte någonstans.
5. **Prenumerationen:**
   - Stänga av och sätta på görs med `PUT` och `basedOnRevision`. Hann någon annan ändra, blir svaret `409` med "Ladda om".
   - Döda händelser kan skickas igen per rad eller alla på en gång. En händelse vars innehåll har gallrats får ingen knapp.

## Val och avvägningar
- **Hemligheten visas bara i svaret**, som i API:t. Lämnar man sidan finns den inte kvar, och då får man göra en ny.
- **Händelsetyper och marknader skrivs som text**, med komma eller mellanslag. Ett formulär med kryssrutor för 24 typer vore tydligare, men typerna kan bli fler. Det kan byggas med listan från `asyncapi.yaml` om det behövs.
- **`act` används överallt** för åtgärder, så att besked och `409` ser likadana ut.

## Att känna till
- Testerna skapar en prenumeration mot `https://crm.example.com`, som inte svarar. Utskicken misslyckas i bakgrunden, men det påverkar inte testerna.

## Filer
- `apps/backoffice/src/integration-logic.ts`, `src/views/notices-queue.ts`, `notice-detail.ts`, `webhooks-view.ts`, `webhook-detail.ts`, `src/components/secret-callout.ts` (nya)
- `apps/backoffice/src/permissions.ts`, `components/app-shell.ts`, `views/labels.ts`, `locales/sv.ts`, `icons.json`
- `apps/backoffice/test/integration-logic.test.ts`, `test/format.test.ts`, `e2e/integrations.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`
