# Back office, steg 5a: inställningar (PR #84)

**Datum:** 2026-11-16 **ADR:** 0035, 0020, 0028, 0032 **Moduler:** apps/backoffice

## Vad
Ett avsnitt för installationens inställningar, med en flik per sort:
- roller och gränser
- gallring
- bolagets texter för meddelanden

Varje ändring blir en ny version med skäl, och historiken visas.

## Hur det fungerar
1. **Flikarna** visas efter rättigheterna: `access:read`, `parties:privacy` och `notices:read`. Formulären för att ändra kräver `access:manage`, `parties:erase` och `notices:configure`.
2. **Roller och gränser:** tabellen visas från den gällande versionen. Formuläret ändrar en gräns i taget.
   - `toMinorUnits` gör beloppet till minsta enhet.
   - `withLimit` sätter, ändrar eller tar bort gränsen för en valuta. En roll utan gränser kvar förlorar fältet, vilket betyder ingen gräns (ADR 0019).
   - Hela rollinställningen skickas med `basedOnVersion`.
3. **Gallring:** en rad per marknad. `retentionProblems` kräver marknadskod, hela år mellan 1 och 100, inga dubbletter och ett skäl.
4. **Meddelanden:** en marknad i taget. `noticeMarketSettings` lämnar bort tomma fält, och de andra marknaderna skickas med som de var.

## Val och avvägningar
- **Bara gränser ändras i formuläret**, inte rättigheter. Att ändra gränser är det som görs ofta, till exempel "nya gränser från 1 december". Rättigheter ändras sällan och påverkar säkerheten, så de ändras med API:t eller `roles:sync`, där hela listan syns.
- **Belopp skrivs i kronor** och sparas i minsta enhet (ADR 0014).
- **En marknad i taget** för meddelanden, så att formuläret blir kort.

## Att känna till
- **Flödestesterna kördes parallellt.** Playwright körde testfilerna samtidigt med flera arbetare, fast de delar en server och bygger på ordningen. Testerna i steg 2 till 4 gick igenom ändå, men det var tur.
  - `workers: 1` gör nu att filerna körs i namnordning.
  - `settings.spec.ts` körs sist, eftersom en ändrad gräns skulle påverka skadorna.
- Administratören kan inte ändra roller som den själv har. API:t svarar då `403`, och appen visar beskedet.

## Filer
- `apps/backoffice/src/settings-logic.ts`, `src/views/settings-view.ts` (nya)
- `apps/backoffice/src/permissions.ts`, `components/app-shell.ts`, `views/labels.ts`, `locales/sv.ts`, `icons.json`, `playwright.config.ts`
- `apps/backoffice/test/settings-logic.test.ts`, `test/format.test.ts`, `e2e/settings.spec.ts`
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`
