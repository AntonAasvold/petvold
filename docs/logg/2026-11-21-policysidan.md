# Policysidan enligt designsystemet (PR #122)

**Datum:** 2026-11-21 **ADR:** 0007, 0029 **Moduler:** apps/backoffice

## Vad
Policyns sida är byggd som skadans:
- brödsmulor
- rubriken "Policy för Bella", med märken för id och status
- en rad med fakta: djuret och försäkringstagaren som länkar, marknad, sedan när och terminen
- två kolumner: till vänster det man läser, till höger åtgärderna och historiken

**Nytt på sidan:**
- **Terminen som gäller**, med hur mycket av försäkringsbeloppet som betalats ut detta försäkringsår, hur mycket som återstår och en stapel. Uppgifterna kommer från `GET /v1/policies/{id}/limits`, som inte hade något gränssnitt förut.
- **Skadorna på policyn** med status och ersättning. En rad öppnar skadan.
- **Historiken** i den mörka loggen i stället för en tabell.

Mönstret står i `docs/teknik/designsystem.md` som "Detaljsidan".

## Hur det fungerar
- **Det som inte behövs för att agera** hämtas efter policyn och lämnas bort om rätten saknas, som på skadesidan:
  - djuret och försäkringstagaren
  - försäkringsbeloppet, som kräver `limits:read`
  - skadorna, som kräver `claims:read`
- **`<pv-policy-actions>`** är nu ett kort med knapparna under varandra, eftersom det står i den smala högerkolumnen.
- **Förslagen** (överlåtelse, dödsfall) är kort i högerkolumnen. Ett förslag som den inloggade kan svara på har den kraftiga ramen.

## Att känna till
- **Tabellen Terminer** kan behöva rullas i sidled i en smal vänsterkolumn.
- **Policyns ögonblicksbild** visas fortfarande inte. Det är en egen punkt i färdplanen.
- **Andra sidor** som ännu inte följer mönstret: ansökan, meddelande, webhook, produkt och regeluppsättning.

## Filer
- `apps/backoffice/src/views/policy-detail.ts`, `src/components/policy-actions.ts`, `src/locales/sv.ts`, `e2e/policies.spec.ts`, `e2e/policy-issue.spec.ts`
- `docs/teknik/designsystem.md`, `docs/funktion/backoffice.md`, `docs/end-to-end-scenario.md`, `docs/roadmap.md`
