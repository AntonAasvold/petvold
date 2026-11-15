# Instruktioner för Claude i Petvold

Petvold är en headless kärna för djurförsäkring (hund, katt, häst) för europeiska marknader. Privat projekt.

## Börja och sluta varje pass

1. Läs `docs/status.md`, `docs/roadmap.md` och relevanta ADR i `docs/adr/`.
2. Följ `docs/arbetssatt.md`: branch, små PR:er, kontrakt före kod.
3. Uppdatera dokumentationen i samma PR som koden: `docs/funktion/` (beteende, konfiguration, exempel) och `docs/teknik/` (hur det är byggt).
4. Skriv en post i byggloggen `docs/logg/` (mall i `docs/logg/README.md`): hur ändringen är byggd, val och avvägningar, och vad som är bra att känna till.
5. Avsluta med att uppdatera `docs/status.md`.

## Regler

- Rent ursprung (ADR 0009): använd aldrig material från någon arbetsgivare. Bara publika källor och egna idéer. Ange källor.
- Pengar som heltal i minsta enhet med valutan en gång per objekt (ADR 0014). Marknad explicit.
- Moduler läser aldrig varandras tabeller (ADR 0001).
- Varje beslut ska gå att styrka (ADR 0018): underlag, regelversion och motorns version sparas, och sparade beslut ska ge samma resultat vid omräkning.
- Domänkod i `*-core` är ren: ingen I/O, inget ramverk, ingen text för användare.
- **All kod på engelska**: identifierare, kommentarer, felmeddelanden, loggar, testnamn, SQL, konfiguration, kontrakt (OpenAPI/AsyncAPI) och exempeldata. Undantag: den svenska språkkatalogen i `messages.ts` och migreringar som redan körts. `npm run lint:lang` kontrollerar det i CI.
- Dokumentation (`docs/`, README, ADR), PR-beskrivningar och commit-meddelanden på svenska.

## Kommandon

```
npm test
npm run test:db        # kräver npm run dev:up
npm run typecheck
npm run lint:openapi
npm run lint:lang
npm run site           # bygger dokumentationssajten i _site/
npm run erasures:reapply  # efter återställning från säkerhetskopia (ADR 0028)
npm run dev
```
