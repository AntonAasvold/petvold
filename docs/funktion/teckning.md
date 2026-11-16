# Teckning

Teckningsreglerna avgör om en ansökan om en ny försäkring godkänns, godkänns med förbehåll, går till manuell prövning eller avslås. Beslutet bakom finns i ADR 0031.

*Läge:* teckningsreglerna och funktionen som prövar dem är byggda. Ansökan, som kör reglerna och sparar resultatet, och kön för manuell prövning kommer i nästa steg.

## Vad reglerna innehåller

Teckningsreglerna är en versionerad serie i regelmodulen, med beräkningsmodellen `underwriting.v1`. De har samma livscykel som skaderegler och tariffer: utkast, granskning och publicering med fyra ögon (se [Produktkonfiguration](produktkonfiguration.md#regeluppsättningar)). Reglerna som gäller på **ansökningsdagen** används.

| Del | Betyder |
| --- | --- |
| `ageLimits` | Per art: lägsta ålder i dagar och högsta ålder i hela år på startdagen. En art som saknas avslås (`species-not-covered`). Gränserna gäller nya försäkringar, inte förnyelse. |
| `questions` | Hälsofrågorna. Varje fråga har ett id, en text per språk och en typ. `boolean` besvaras med ja eller nej. `diagnoses` besvaras med ja och diagnoskoderna, eller med nej. En fråga kan gälla bara vissa arter. |
| `answerRules` | Vad ett ja leder till: `rider` (förbehåll), `refer` (manuell prövning) eller `decline` (avslag), alltid med en skälskod. En regel kan gälla bara vissa diagnoser (`onlyFor`). |
| `breedRules` | Raser som går till manuell prövning eller avslås, med skälskod. |

## Utfallet

Alla regler prövas, och det strängaste utfallet vinner:

| Utfall | När |
| --- | --- |
| `accept` | Ingen regel slår till |
| `accept-with-riders` | Bara förbehåll |
| `refer` | Någon regel ger manuell prövning, och ingen ger avslag |
| `decline` | Någon regel ger avslag |

Svaret redovisar varje kontroll med resultat och underlag: art, ålder i dagar och år, ras och varje fråga. Skälskoderna för manuell prövning och avslag listas i den ordning de hittades. Försäkringsavtalslagen kräver skäl vid avslag (FAL 3 kap. 1 § och 7 kap. 6 §). Kanalen översätter koden till kundens språk.

**Förbehåll.** Ett förbehåll från en fråga av typen `diagnoses` undantar de diagnoser kunden angav, plus de som regeln listar. Ett förbehåll från en ja- eller nej-fråga undantar regelns diagnoser. Skademotorn prövar förbehållen som i dag (se [Skadereglering](skadereglering.md)).

**Svaren kontrolleras.** Alla frågor för arten måste besvaras en gång. Ett ja på en fråga av typen `diagnoses` kräver diagnoskoder. Ett nej eller en ja- eller nej-fråga tar inga koder.

## Exempel

Påhittade regler för hund i Sverige:

```json
{
  "market": "SE",
  "ageLimits": [{ "species": "dog", "minAgeDays": 42, "maxAgeYears": 9 }],
  "questions": [
    { "id": "previous-illness", "type": "diagnoses",
      "labels": { "sv": "Har djuret varit sjukt, skadat eller behandlats av veterinär de senaste två åren?" } },
    { "id": "ongoing-symptoms", "type": "boolean",
      "labels": { "sv": "Har djuret symtom just nu som inte har undersökts av veterinär?" } }
  ],
  "answerRules": [
    { "question": "previous-illness", "outcome": "decline", "reason": "heart-disease", "onlyFor": ["CAR-MITRAL", "CAR-DCM"] },
    { "question": "previous-illness", "outcome": "rider", "reason": "previous-illness", "riderDescription": "Uppgiven vid ansökan" },
    { "question": "ongoing-symptoms", "outcome": "refer", "reason": "ongoing-symptoms" }
  ],
  "breedRules": []
}
```

Utfallet för några ansökningar som startar 2026-11-15:

| Ansökan | Utfall |
| --- | --- |
| Doris, född 2023-05-02, nej på båda frågorna | `accept` |
| Doris, ja på tidigare sjukdom med öroninflammation (`ORA-OTIT`) | `accept-with-riders`, förbehåll för `ORA-OTIT` |
| Doris, ja på tidigare sjukdom med mitralisinsufficiens (`CAR-MITRAL`) | `decline`, skäl `heart-disease` |
| Doris, ja på symtom som inte undersökts | `refer`, skäl `ongoing-symptoms` |
| En valp född 2026-10-05, 41 dagar gammal | `decline`, skäl `too-young` |
| En hund som fyller 10 år på startdagen | `decline`, skäl `too-old` |
