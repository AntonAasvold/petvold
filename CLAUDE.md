# Instruktioner för Claude i Petvold

Petvold är en headless kärna för djurförsäkring (hund, katt, häst) för europeiska marknader. Privat projekt.

## Börja och sluta varje pass

1. Läs `docs/status.md`, `docs/roadmap.md` och relevanta ADR i `docs/adr/`.
2. Följ `docs/arbetssatt.md`: branch, små PR:er, kontrakt före kod.
3. Uppdatera dokumentationen i samma PR som koden, där ändringen berör den: `docs/funktion/` när beteende, konfiguration eller API ändras (med exempel), och `docs/teknik/` när modulgränser, portar, schema eller drift ändras.
4. Skriv en post i byggloggen `docs/logg/` (mall i `docs/logg/README.md`): hur ändringen är byggd, val och avvägningar, och vad som är bra att känna till.
5. Avsluta med `docs/status.md`: högst tre rader per PR och bara det senaste passet. Flytta äldre pass till `docs/status-arkiv.md` när ett nytt pass börjar. Kryssa i färdplanen.

## Regler

- Rent ursprung (ADR 0009): använd aldrig material från någon arbetsgivare. Bara publika källor och egna idéer. Ange källor.
- Pengar som heltal i minsta enhet med valutan en gång per objekt (ADR 0014). Marknad explicit.
- Moduler läser aldrig varandras tabeller (ADR 0001).
- Varje beslut ska gå att styrka (ADR 0018): underlag, regelversion och motorns version sparas, och sparade beslut ska ge samma resultat vid omräkning.
- Domänkod i `*-core` är ren: ingen I/O, inget ramverk, ingen text för användare.
- **All kod på engelska**: identifierare, kommentarer, felmeddelanden, loggar, testnamn, SQL, konfiguration, kontrakt (OpenAPI/AsyncAPI) och exempeldata. Undantag: den svenska språkkatalogen i `messages.ts` och migreringar som redan körts. `npm run lint:lang` kontrollerar det i CI.
- Dokumentation (`docs/`, README, ADR), PR-beskrivningar och commit-meddelanden på svenska.
- Gränssnitt följer designsystemet Petvold (`docs/teknik/designsystem.md`, källan är `design/tokens.json`): svartvitt, ramar i stället för skuggor, tillstånd med helfylld eller streckad linje och aldrig med färg. Använd tokens och Web Awesome-temat, inga fasta färger eller storlekar.

## Kommandon

```
npm test
npm run test:db        # kräver npm run dev:up
npm run typecheck
npm run lint:openapi
npm run lint:lang
npm run site           # bygger dokumentationssajten i _site/
npm run roles:sync     # nya standardroller till sparad rollinställning (-- --apply sparar)
npm run erasures:reapply  # efter återställning från säkerhetskopia (ADR 0028)
npm run dev
npm start              # server för drift, se docs/teknik/drift.md
```
