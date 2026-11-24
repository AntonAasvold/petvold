# Dokumentation

Dokumentationen skrivs samtidigt som koden. En PR som ändrar hur något fungerar uppdaterar också texten som beskriver det (se [Arbetssätt](arbetssatt.md)).

## Funktion: vad Petvold gör

För försäkringsbolag, produktägare och handläggare. Ingen kod krävs för att läsa.

- [Översikt](funktion/README.md): vad Petvold är, vilka delar som finns och vad som är byggt
- [Skadereglering](funktion/skadereglering.md): hur ett ärende bedöms, beräknas och beslutas
- [Produktkonfiguration](funktion/produktkonfiguration.md): produkter, regeluppsättningar, policyns villkor och produktens dokument
- [Referensdata](funktion/referensdata.md): arter, raser och kön
- [Djurregister](funktion/djurregister.md): djur, id-nummer, ägare och klinikens uppslag
- [Parter](funktion/parter.md): personer och organisationer, radering och gallring
- [Policyer](funktion/policyer.md): tecknande, ändring, förnyelse, avslut, överlåtelse och grupper
- [Pris](funktion/pris.md): tariffer, prisvillkor och prisindikation
- [Teckning](funktion/teckning.md): hälsofrågor, ansökan och manuell prövning
- [Meddelanden](funktion/meddelanden.md): besked som lagen kräver, och bolagets dokumentsystem
- [Webhooks](funktion/webhooks.md): händelser till bolagets system, med signatur och omförsök
- [Premier och betalningar](funktion/premier.md): premieplaner, fakturor, inbetalningar, obetald premie, tillgodohavanden och utbetalningar
- [Bokföring](funktion/bokforing.md): verifikationer för varje händelse som rör pengar, och kontona
- [Körningar](funktion/korningar.md): förnyelse, utgång och gallring varje dag, en server i taget, med historik
- [Dokument](funktion/dokument.md): filer i Petvolds arkiv, kundens dokument och länkar som slutar gälla
- [Back office](funktion/backoffice.md): gränssnittet för handläggare och back office
- [End-to-end-scenarier](end-to-end-scenario.md): en hel kundresa att testa för hand i back office, och det som saknas i gränssnittet
- [Behörighet](funktion/behorighet.md): roller, rättigheter, omfång och hur en installation ställer in dem

## Teknik: hur Petvold är byggt

För utvecklare och drift.

- [Arkitektur](teknik/arkitektur.md): moduler, portar, lagring, händelser och API
- [Utvecklingsmiljö](teknik/utvecklingsmiljo.md): kom igång lokalt
- [Testning](teknik/testning.md): testlager och vad som krävs
- [Drift](teknik/drift.md): starta en installation, konfiguration, inloggning, händelser och hälsa
- [Demon](teknik/demo.md): sätta upp demon på en server, testdatan och inloggningen (ADR 0041)
- [Demotjänsten](teknik/demotjanst.md): specen för tjänsten som tar emot och visar alla händelser, spelar bank och kontrollerar att allt stämmer
- [API-konventioner](teknik/api-konventioner.md): hur adresser, filter, id och versioner namnges
- [Back office](teknik/backoffice.md): appen i `apps/backoffice`, datatabellen, språk, ikoner och test
- [Designsystemet](teknik/designsystem.md): tokens, temat för Web Awesome, komponenter och regler för text
- [API](../modules/api/openapi.yaml): kontraktet. Klickbar version på `/docs` när dev-servern kör.

## Styrning

- [Arbetssätt](arbetssatt.md): roller, flöde och vad klart betyder
- [Roadmap](roadmap.md): milstolpar
- [Status](status.md): senaste passet, nästa steg och det som är öppet
- [Statusarkiv](status-arkiv.md): tidigare pass
- [Beslut (ADR)](adr/README.md): arkitekturbeslut med motivering och källor
- [Granskningar](granskning/README.md): genomgångar av arkitektur och funktion, med fynd och förslag
- [Bygglogg](logg/README.md): hur varje ändring är byggd

## Så skriver vi

- **Funktion** beskriver beteende med exempel i kronor och datum, inte kod. Varje regel och beräkning som finns i koden ska gå att hitta här.
- **Teknik** beskriver hur det är byggt och varför, med länkar till koden och till ADR.
- **Markera vad som är byggt och vad som är planerat.** Det som saknas står sist i avsnittet under *Inte byggt än:*, och tas bort i samma PR som det byggs.
- **Inga antal som blir inaktuella**, som "19 listor" eller "98 operationer", utom i byggloggen och statusarkivet som beskriver ett visst läge.
- Exemplen använder påhittade data (Bella och Rex), samma som testerna, så att siffrorna går att kontrollera.
