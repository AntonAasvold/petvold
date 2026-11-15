# Dokumentation

Dokumentationen skrivs samtidigt som koden. En PR som ändrar hur något fungerar uppdaterar också texten som beskriver det (se [Arbetssätt](arbetssatt.md)).

## Funktion: vad Petvold gör

För försäkringsbolag, produktägare och handläggare. Ingen kod krävs för att läsa.

- [Översikt](funktion/README.md): vad Petvold är, vilka delar som finns och vad som är byggt
- [Skadereglering](funktion/skadereglering.md): hur ett ärende bedöms, beräknas och beslutas
- [Produktkonfiguration](funktion/produktkonfiguration.md): vad en produkt och en policy styr i regleringen och hur det ställs in
- [Behörighet](funktion/behorighet.md): roller, rättigheter och hur en installation ställer in dem

## Teknik: hur Petvold är byggt

För utvecklare och drift.

- [Arkitektur](teknik/arkitektur.md): moduler, portar, lagring, händelser och API
- [Utvecklingsmiljö](teknik/utvecklingsmiljo.md): kom igång lokalt
- [Testning](teknik/testning.md): testlager och vad som krävs
- [Drift](teknik/drift.md): starta en installation, konfiguration, inloggning, händelser och hälsa
- [API](../modules/api/openapi.yaml): kontraktet. Klickbar version på `/docs` när dev-servern kör.

## Styrning

- [Arbetssätt](arbetssatt.md): roller, flöde och vad klart betyder
- [Roadmap](roadmap.md): milstolpar
- [Status](status.md): var vi är och nästa steg
- [Beslut (ADR)](adr/README.md): arkitekturbeslut med motivering och källor
- [Granskningar](granskning/README.md): genomgångar av arkitektur och funktion, med fynd och förslag
- [Bygglogg](logg/README.md): hur varje ändring är byggd

## Så skriver vi

- **Funktion** beskriver beteende med exempel i kronor och datum, inte kod. Varje regel och beräkning som finns i koden ska gå att hitta här.
- **Teknik** beskriver hur det är byggt och varför, med länkar till koden och till ADR.
- **Markera vad som är byggt och vad som är planerat.** Planerade delar märks *(planerat)* och länkas till roadmap.
- Exemplen använder påhittade data (Bella och Rex), samma som testerna, så att siffrorna går att kontrollera.
