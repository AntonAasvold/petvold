# 0011. Gemensam kärna för värdetyper (`@petvold/common`)

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Alla moduler behöver samma grundbegrepp: pengar, valuta, marknad, datum och datumintervall. Om varje modul definierar dem själv kommer de att glida isär, till exempel med olika avrundning eller olika syn på om ett intervall är öppet i slutet. Samtidigt får ett delat bibliotek inte bli en bakdörr som kopplar ihop modulerna (ADR 0001).

## Beslut

`modules/common` (`@petvold/common`) innehåller bara värdetyper och rena funktioner som flera moduler behöver:

- `Money`, `MinorUnits`, `BasisPoints` och `applyBp`, som är den enda avrundningen av procentsatser (ADR 0005).
- `MarketCode` och `CurrencyCode` med validering.
- `ISODate`, `Timestamp` och `DateRange`. Intervall är halvöppna, `[from, to)`, och `to` utelämnat betyder tills vidare.

Regler för modulen:

- Inga entiteter, ingen domänlogik som hör till en enskild modul, ingen I/O, inget ramverk och ingen text för användare.
- Inga beroenden, varken till andra moduler eller till externa paket.
- Alla moduler får bero på `common`. `common` beror inte på något.
- En ändring i `common` kräver att alla moduler fortfarande går igenom typkontroll och tester.

Gemensamma kontraktsdelar (OpenAPI-scheman för `Money`, `Problem` och sidindelning) hamnar i en senare ändring.

## Konsekvenser

- Ett ställe för avrundning, datumvalidering och regeln att valutor aldrig växlas.
- Modulerna blir kopplade genom `common`, så det måste hållas litet. Om något bara används av en modul ska det ligga i den modulen.
- Ett fel i datumvalideringen upptäcktes när koden flyttades: `2026-02-30` godkändes tidigare. Nu avvisas det.

## Alternativ

- **Kopiera typerna till varje modul:** ger ingen koppling, men reglerna glider isär.
- **Ett tredjepartsbibliotek för pengar och datum** (t.ex. Dinero.js eller Temporal-polyfill): mer än vi behöver, och ett beroende i varje modul.

## Källor

- Eric Evans, *Domain-Driven Design* (2003), mönstret *Shared Kernel*.
- Martin Fowler, *Money* i *Patterns of Enterprise Application Architecture* (2002).
