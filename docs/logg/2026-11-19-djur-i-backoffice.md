# Djur och kullar i back office (PR #102)

**Datum:** 2026-11-19 **ADR:** 0022, 0024, 0027, 0035 **Moduler:** apps/backoffice

## Vad
Andra PR:en för policy, djur och parter: avsnittet Djur. Inget ändras i API:t.
- **Sök och registrera:** kundservice kan söka, registrera och rätta djur och registrera kullar.
- **Ägare och nummer:** de kan byta ägare och lägga till nummer.
- **Djurets sida** visar historik och policyer.
- **Partens sida** visar djuren parten äger.

## Hur det fungerar
1. **`src/animal-logic.ts` är ren:** kontroller och anrop för registrering, rättelse, ägarbyte och kull, och `ownerOn` som ger ägaren på en dag. Chipnummer skrivs med mellanslag och bindestreck men skickas som 15 siffror.
2. **Referensdatan:** `src/reference.ts` läser art, ras och kön en gång per språk. API:t ger etiketten på användarens språk via `Accept-Language`. Rasen filtreras på arten. En okänd eller inaktiv kod visas som koden.
3. **Fälten** finns i `animal-fields.ts`, som för parter. Vid rättelse visas inte arten, eftersom den aldrig ändras.
4. **Ägarbytet** kontrolleras före anropet: en ny ägare, och en dag efter att den nuvarande började.
5. **Historiken** blandar revisionerna med ägarbytena, så att allt som hänt djuret syns på ett ställe.

## Val och avvägningar
- **Ägare och föräldrar anges med id,** inte med en sökruta. Kundservice hittar en part under Parter och kan registrera ett djur därifrån med ägaren ifylld. En sökruta i formuläret kan komma när det finns en sökning på namn.
- **Kullen får en egen sida** (`/litters/{id}`) i stället för att visas bara på djuren, eftersom den har uppfödare och föräldrar.
- **Länkar är svarta,** som designsystemet säger. Det gällde också länken till policyn i skadeärendets huvud.

## Att känna till
- **Web Awesomes kryssruta** döljer sin inbyggda `<input>`, så `check()` i Playwright väntar tills tiden går ut. Flödestesterna klickar på `wa-checkbox`.
- **Exempeldatan har två djur som heter Bella,** så testet tar den första.

## Filer
- `apps/backoffice/src/views/animals-view.ts`, `animal-register.ts`, `animal-detail.ts`, `litter-register.ts`, `litter-detail.ts` (nya), `src/components/animal-fields.ts` (ny), `src/animal-logic.ts` (ny), `src/reference.ts` (ny)
- `apps/backoffice/src/views/party-detail.ts`, `claim-detail.ts`, `src/components/app-shell.ts`, `src/permissions.ts`, `src/policy-logic.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `icons.json`
- `apps/backoffice/test/animal-logic.test.ts` (ny), `e2e/animals.spec.ts` (ny)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
