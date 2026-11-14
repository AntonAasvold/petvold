# Instruktioner för Claude i Petvold

Petvold är en headless kärna för djurförsäkring (hund, katt, häst) för europeiska marknader. Privat projekt.

## Börja och sluta varje pass

1. Läs `docs/status.md`, `docs/roadmap.md` och relevanta ADR i `docs/adr/`.
2. Följ `docs/arbetssatt.md`: branch, små PR:er, kontrakt före kod.
3. Avsluta med att uppdatera `docs/status.md`.

## Regler

- Rent ursprung (ADR 0009): använd aldrig material från någon arbetsgivare. Bara publika källor och egna idéer. Ange källor.
- Pengar som heltal i minsta enhet med valuta (ADR 0005). Marknad explicit.
- Moduler läser aldrig varandras tabeller (ADR 0001).
- Domänkod i `*-core` är ren: ingen I/O, inget ramverk, ingen text för användare.
- Kod på engelska, dokumentation och commits på svenska.

## Kommandon

```
npm test
npm run typecheck
npm run lint:openapi
npm run dev
```
