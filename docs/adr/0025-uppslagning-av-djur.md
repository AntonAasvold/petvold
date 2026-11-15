# 0025. Uppslagning av djur, till exempel för kliniker

- Status: Beslutad
- Datum: 2026-11-15

## Sammanhang

En klinik som tar emot ett djur läser oftast chipet och vill veta om djuret finns hos försäkringsbolaget, till exempel för direktreglering. Enligt ADR 0024 ser roller som är bundna till en klinik inga djur, eftersom ett djur i registret visar vem som äger det. Beslutet är att kliniker ska kunna slå upp djur, men att det ska gå att styra per djur om djuret syns.

## Beslut

1. **En flagga per djur, `allowLookup`.** Den är en del av djurets uppgifter och sparas i varje revision. Därför syns det i historiken vem som öppnade eller stängde djuret, när och varför.
2. **Stängt från början.** Ett djur som registreras utan `allowLookup` kan inte slås upp. Säljkanalen eller kundservicen öppnar det, till exempel när ägaren har godkänt det. Vid en rättelse (`PUT`) måste flaggan alltid anges, så att den inte ändras av misstag.
3. **Ett eget anrop och en egen rättighet.** `GET /v1/animal-lookup?microchip=…` (eller `registration` eller `passport`) kräver rättigheten `animals:lookup`. Standardrollen `clinic` får den. `animals:read` ger fortfarande hela djuret med ägare och är inte tillåtet för roller bundna till klinik.
4. **En sammanfattning utan personuppgifter.** Uppslagningen visar djurets id, marknad, art, ras, kön, kastrering, namn, födelse, död och id-nummer. Den visar aldrig ägare, historik eller vem som ändrat något.
5. **Bara med ett exakt id-nummer.** Det går inte att söka på ägare eller lista djur.
6. **Omfång.** Bara djur i anroparens marknader hittas. En bindning till klinik eller försäkringar begränsar inte uppslagningen, eftersom svaret inte innehåller något om ägaren.
7. **Samma svar för okänt, stängt och fel marknad:** en tom lista. Den som slår upp kan inte se om ett stängt djur finns.

## Konsekvenser

- Kliniker kan hitta djur på chipnummer, men bara de djur som har öppnats.
- Ägaren kan styra synligheten via försäkringsbolagets kanaler. Petvold avgör inte om det är ägarens samtycke eller försäkringsbolagets standard som gäller.
- Det sparas inte vem som har slagit upp ett djur. Om det behövs, till exempel för att följa upp missbruk, blir det en åtkomstlogg i en senare ADR.
- En klinik kan prova chipnummer i följd och få fram djurens namn och födelsedatum för de djur som är öppna, men inte ägarna. Begränsning av antal anrop hör till installationens API-gateway.
- Installationer med en sparad rollinställning måste lägga till `animals:lookup` på `clinic` själva.

## Alternativ

- **Ge kliniken `animals:read`:** visar ägaren för vilken klinik som helst. Avvisat av samma skäl som i ADR 0024.
- **Öppet från början:** praktiskt för kliniker, men strider mot inbyggt dataskydd som standard (GDPR artikel 25.2). Om ett försäkringsbolag vill ha det kan säljkanalen skicka `allowLookup: true` vid registreringen.
- **Flaggan utanför revisionerna:** enklare att ändra, men då försvinner historiken över vem som öppnade djuret.
- **Ett standardvärde per installation eller marknad:** kan läggas till senare, om flera installationer vill ha olika standard.

## Källor

- GDPR artikel 5.1 c (uppgiftsminimering) och 25.2 (dataskydd som standard). eur-lex.europa.eu
- ISO 11784, om chipnumrets format. iso.org
- ADR 0016 och 0024.
