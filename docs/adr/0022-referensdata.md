# 0022. Referensdata: koder, översättningar och historik

- Status: Föreslagen
- Datum: 2026-11-15

## Sammanhang

ADR 0021 lägger referensdata (arter, raser, kön) i modulen `catalog`. Djur, produkter och policyer kommer att peka på dessa koder, och kunder, kliniker och handläggare ska se dem på sitt eget språk. Kvar att bestämma:

- vad som identifierar ett värde
- hur det ändras
- hur översättningar lagras

## Beslut

1. **Ett värde identifieras av en kod som aldrig ändras**, till exempel `dog` eller `dog-labrador-retriever`. Koden består av små bokstäver, siffror och bindestreck och är unik inom sin sort (`species`, `breed`, `sex`).
2. **En kod tas aldrig bort och byter aldrig namn.** Sparade djur och policyer pekar på den. En kod som inte ska användas längre avaktiveras (`active: false`). Den går fortfarande att läsa men erbjuds inte för nya data.
3. **Översättningar är data på värdet** (`labels`, språktagg → text enligt BCP 47), inte kod. Ett nytt språk eller en rättad stavning kräver ingen ny version av Petvold. API:et ger `label` på anroparens språk (`Accept-Language`) och faller tillbaka på engelska och därefter på första språket.
4. **Varje ändring är en ny revision.** Databasen tillåter bara att rader läggs till: tjänsterollen `catalog_service` får läsa och lägga till, men inte ändra eller ta bort. En ändring kräver föregående revision (optimistisk låsning) och en motivering. Historiken visar vem som ändrade vad, när och varför.
5. **En ras tillhör en art, och kopplingen ändras aldrig.** En ras som hamnat under fel art avaktiveras, och en ny kod skapas.
6. **Inga fyra ögon.** Referensdata påverkar inte beslut eller pengar direkt, och varje ändring spåras. Produkter och produktversioner, som påverkar pris och villkor, får fyra ögon när de byggs.

## Konsekvenser

- Andra moduler sparar bara koden och kan lita på att den alltid finns.
- Etiketter kan ändras utan att data som pekar på koden påverkas.
- Listan med sorter är fast i kod och i databasen. En ny sort, till exempel diagnoskoder eller fakturakategorier, kräver en migration.
- Ett nytt standardvärde i en senare version av Petvold kommer inte in automatiskt. Det läggs till via API:et, på samma sätt som roller (ADR 0020).

## Alternativ

- **Uppräkningar i kod (`enum`):** varje ny ras skulle kräva en ny version av Petvold.
- **Översättningar i språkkatalogen (`messages.ts`):** samma problem. Dessutom ägs listorna av försäkringsbolaget och inte av Petvold.
- **Hela listan versionerad som en enhet, som rollinställningen (ADR 0020):** ger ett gemensamt versionsnummer, men en ändring av en ras skulle skapa en version av alla raser. Historik per kod räcker och är lättare att granska.
- **Fri borttagning:** bryter referenser från sparade djur och policyer.

## Källor

- IETF BCP 47, *Tags for Identifying Languages*. rfc-editor.org/info/bcp47
- RFC 9110, avsnitt 12.5.4 (`Accept-Language`). rfc-editor.org/rfc/rfc9110
- FCI:s rasnomenklatur, som exempel på en publik raslista som en installation kan läsa in. fci.be
- ADR 0001, 0020 och 0021.
