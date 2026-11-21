# Partens sida: numren bland uppgifterna och djurens försäkring (PR #121)

**Datum:** 2026-11-21 **ADR:** 0026, 0029, 0039 **Moduler:** apps/backoffice

## Vad
- **Numren ligger i kortet Uppgifter.** Personnummer och organisationsnummer står först, före e-post och adress, och kortet Nummer finns inte längre.
  - "Lägg till ett nummer" fäller ut fälten i samma kort.
  - "Ta bort" finns på varje rad, och de borttagna numren visas under en utfällbar rad.
- **Djurlistan har kolumnen "Försäkrad".** Den visar policyn som försäkrar djuret i dag, med en länk. Ett djur utan policy har knappen "Teckna försäkring", som öppnar teckningen med djuret och försäkringstagaren ifyllda.

## Hur det fungerar
- **Numret ingår inte i "Ändra uppgifterna".** Det har sin egen historik, är unikt och visas maskerat, så det läggs till och tas bort för sig, som i API:t.
- **Försäkrad hämtas per djur** med `GET /v1/policies?animalId=` och `insuredFrom` från teckningen. Kolumnen visar alltså en policy även om försäkringstagaren är någon annan, eftersom ett djur bara kan vara försäkrat en gång åt gången (ADR 0029).
- **Knappen visas inte** för ett dött djur, för en part som är avslutad eller anonymiserad, eller för den som saknar `policies:write`.
- **Länkar** i tabeller och på partens sida har färgen `--ink` i stället för webbläsarens blå, som designsystemet kräver.

## Att känna till
- **Ett anrop per djur.** Det räcker för en person med några djur. En uppfödare med många djur kan behöva ett anrop som tar flera djur samtidigt.

## Filer
- `apps/backoffice/src/views/party-detail.ts`, `src/components/data-grid.ts`, `src/locales/sv.ts`, `e2e/parties.spec.ts`
- `docs/funktion/backoffice.md`, `docs/end-to-end-scenario.md`
