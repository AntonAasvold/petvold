# Översikt

Petvold är en kärna för djurförsäkring (hund, katt och häst) för europeiska marknader. Den har inget eget gränssnitt för kunder eller handläggare. Allt sker via API, och försäkringsbolaget bygger sina egna gränssnitt eller kopplar in befintliga system.

Petvold installeras en gång per försäkringsbolag (ADR 0010). Varje kund har sin egen databas, sina egna produkter och sin egen konfiguration.

## Delar

| Del | Vad den gör | Läge |
| --- | --- | --- |
| Skademotor | Tar emot skador, bedömer dem mot policyn och produktens regler, räknar ut ersättning, fattar eller föreslår beslut och bokför förbrukat försäkringsbelopp. | Byggd, se [Skadereglering](skadereglering.md) |
| Regler | Produktens skaderegler som versionerade regeluppsättningar, publicerade med fyra ögon. | Byggd, se [Produktkonfiguration](produktkonfiguration.md#regeluppsättningar) |
| Referensdata | Arter, raser och kön med översättningar och historik. | Byggd, se [Referensdata](referensdata.md) |
| Produkt | Versionerade produkter med säljperiod, regelserie och valbara försäkringsbelopp och självrisker, publicerade med fyra ögon. | Byggd, se [Produktkonfiguration](produktkonfiguration.md#produkter-och-produktversioner) |
| Djur | Djur med id-nummer, historik och ägare över tid. | Byggd, se [Djurregister](djurregister.md) |
| Parter | Personer och organisationer med kontaktuppgifter, personnummer och historik. | Byggd, se [Parter](parter.md) |
| Policy | Försäkringar med full historik: vad som gällde när, och vad som var känt när. | Tecknande byggt, se [Policyer](policyer.md). Avslut, förnyelse och överlåtelse kommer (M3). Skademotorn läser policyn via ett gränssnitt och kan kopplas till ett befintligt system. |
| Pris och teckning | Premie och teckningsregler per produktversion. | Prisfunktion och tariffer byggda, se [Pris](pris.md). Prisindikation, prisvilkor och teckningsregler kommer (M4). |
| Billing och betalningar | Premier in, ersättningar ut, via flera betaltjänster. | *(planerat, M5)* |

## Grundprinciper

- **Varje beslut går att förklara.** En bedömning listar varje regel som prövats, med utfall och skäl, och hela beräkningen steg för steg.
- **Historiken ändras aldrig.** Beslut och bokföring läggs till, de skrivs aldrig över. En omprövning blir ett nytt beslut som bokför skillnaden.
- **Belopp i heltal i minsta valutaenhet.** 150 000 betyder 1 500,00 kr. Varje objekt har en valuta, och valutor växlas aldrig (ADR 0014).
- **Marknaden är alltid uttalad.** Samma motor bär olika marknaders regler, till exempel självrisk per period i Norden och självrisk per skada på andra håll.
- **Listor kommer en sida i taget.** Varje lista svarar med `items` och, om det finns mer, `nextCursor`. Nästa sida hämtas med `?cursor=…`. `limit` är 1–200, förval 50.
- **Texter på kundens språk.** Skälen i en bedömning är koder som översätts till svenska eller engelska efter anroparens språk.
