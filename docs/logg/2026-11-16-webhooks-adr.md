# ADR om händelser till bolagets system (PR #72)

**Datum:** 2026-11-16 **ADR:** 0033 (Beslutad) **Moduler:** inga, bara dokumentation

## Vad
Ett förslag om hur Petvolds händelser når bolagets andra system: en modul för webhooks med prenumerationer, CloudEvents som kuvert, signatur enligt Standard Webhooks, tunna händelser utan personuppgifter och AsyncAPI som kontrakt.

## Val och avvägningar
- **Ett gemensamt sätt i stället för en webhook per händelse.** Signatur, omförsök och felhantering byggs en gång.
- **Tunna händelser.** Mottagaren hämtar detaljer med sin egen token, så behörigheten från ADR 0016 gäller och inga personuppgifter sprids till bolagets loggar.
- **En kö per prenumeration** i stället för leverans direkt från reläet. En mottagare som inte svarar stoppar inte andra.
- **Standard Webhooks** i stället för en egen signatur. Det finns bibliotek för mottagaren i flera språk.
- Specifikationerna för CloudEvents och Standard Webhooks är kontrollerade mot källorna på GitHub. AsyncAPI 3.0 nämns utan att detaljer har kontrollerats.

## Att känna till
- Kontraktets `webhooks` för `claim.registered` och `claim.decided` beskriver feta händelser som aldrig har levererats. De ersätts när ADR:en byggs.

## Filer
- `docs/adr/0033-handelser-till-bolagets-system.md`, `docs/adr/README.md`, `docs/roadmap.md`, `docs/status.md`
