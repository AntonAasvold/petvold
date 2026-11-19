# Kön för radering i back office (PR #105)

**Datum:** 2026-11-19 **ADR:** 0028, 0035 **Moduler:** apps/backoffice

## Vad
Avsnittet Radering: kön för begäranden om att anonymisera en part. Det sker med fyra ögon: en dataskyddsansvarig begär, och en annan godkänner. Inget ändras i API:t.

## Hur det fungerar
1. **`src/erasure-logic.ts` är ren.**
   - **Godkännande:** `mayApprove` kräver `parties:erase` och att man inte själv begärde.
   - **Avslag:** `rejectionProblems` kräver ett skäl, och ett datum efter i dag när personen själv bad om radering.
2. **Kön** har flikarna Väntar och Beslutade, och menyn räknar begäranden som väntar.
3. **Begärans sida** visar part, grund, skäl och vem som begärde.
   - **Godkännande:** den som begärde ser att någon annan måste godkänna. Den andra ser en varning om att anonymiseringen inte kan ångras.
   - **Avslag:** en begäran från personen kräver datumet för begränsningen.

## Val och avvägningar
- **API:t avgör fyra ögon,** och appen visar det i förväg. Den som begärde ser därför inte knappen för att godkänna alls.
- **Flödestestet registrerar en egen part.** Att anonymisera någon i exempeldatan skulle ändra det andra tester räknar med.

## Att känna till
- **Inloggningen** i back office saknade `dev-privacy-2`, fast utvecklingsservern hade den. Den finns nu med i listan.

## Filer
- `apps/backoffice/src/views/erasures-view.ts` (ny), `erasure-detail.ts` (ny), `src/erasure-logic.ts` (ny), `src/components/app-shell.ts`, `src/permissions.ts`, `src/auth.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `icons.json`
- `apps/backoffice/test/erasure-logic.test.ts` (ny), `test/format.test.ts`, `e2e/erasures.spec.ts` (ny)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
