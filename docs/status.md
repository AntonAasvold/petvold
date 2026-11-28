# Status

Läses i början och uppdateras i slutet av varje arbetspass. Här står bara det senaste passet, med nästa steg och det som är öppet. Äldre pass finns i [statusarkivet](status-arkiv.md), och detaljerna i [byggloggen](logg/README.md).

## 2026-11-28 (pass 29, i chatten)

**Gjort**
- Referensprodukter för katt, häst och brittisk livstidsförsäkring i `docs/referensprodukter/`, byggda på publika villkor från Svedea, Sveland, If, Ageas och PDSA. Hundprodukten från 2026-11-14 ligger i samma mapp.
- En gemensam tabell med 21 förmågor (F1–F21), läget mot `main` och vilka produkter som behöver dem. Roadmapen har fått avsnittet **Referensprodukter**.

**Nästa steg**
1. ADR för kodsystem för diagnoser (F20) och insjuknandedag på skadan (F6).
2. Livförsäkring som moment (F1), som också löser granskningens F4.

**Öppet**
- Sjukdomen som eget objekt för brittiska produkter (F5) påverkar datamodellen och behöver en ADR innan en marknad utanför Norden blir aktuell.
