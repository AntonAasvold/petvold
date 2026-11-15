# 0026. Parter: personer och organisationer

- Status: Beslutad
- Datum: 2026-11-15

## Sammanhang

Djurregistret pekar på ägare med part-id (`pty_…`, ADR 0024), och policyn kommer att peka på försäkringstagare (M3). Det behövs en modul som håller personerna och organisationerna. Uppgifterna är personuppgifter, och personnummer kräver särskild försiktighet. Kvar att bestämma:

- vad en part innehåller
- hur ändringar sparas
- hur personnummer och organisationsnummer hanteras
- var en parts roller finns
- vem som får se parterna

## Beslut

1. **En ny modul, `parties`,** med schemat `parties` och tjänsterollen `parties_service` (ADR 0001).
2. **Två sorter:**
   - en **person** har förnamn, efternamn och eventuellt födelsedatum
   - en **organisation**, till exempel en kennel eller ett stuteri, har ett namn

   Båda kan ha e-post, telefon i internationellt format, adress och önskat språk. Sort och marknad ändras aldrig.
3. **Uppgifterna sparas som revisioner**, som för djuren. En ändring ersätter alla uppgifter och kräver gällande revision och en motivering. En uppgift som utelämnas tas bort i den nya revisionen men finns kvar i historiken.
4. **Id-nummer:**
   - Det finns personnummer och organisationsnummer, alltid med land, och de är unika per land.
   - De tas aldrig bort. Ett nytt personnummer, till exempel efter ett byte, läggs till.
   - Svenska nummer kontrolleras. Personnummer har 12 siffror, ett giltigt datum och en kontrollsiffra, och samordningsnummer (dag + 60) godtas. Organisationsnummer har 10 siffror och en kontrollsiffra.
   - Nummer från andra länder kontrolleras bara till formen.
5. **Personnummer visas aldrig.**
   - Varje svar visar dem maskerade (`19850312-****`) med `masked: true`.
   - Sökning görs med `POST /v1/party-searches` och numret i anropets innehåll, så att det inte hamnar i adresser eller åtkomstloggar.
   - Organisationsnummer är offentliga och visas.
6. **Roller finns inte i partmodulen.** Vad en part är för verksamheten (ägare, försäkringstagare, betalningsmottagare) ägs av modulen som har relationen: djurregistret har ägarskapet, och policyn får försäkringstagaren. En part har därför ingen rollista som kan bli inaktuell.
7. **Behörighet och omfång** (ADR 0016):
   - `parties:read` och `parties:write`, och en ny roll `party-registrar`.
   - `handler`, `approver` och `animal-registrar` får läsa.
   - Parten har en marknad, och anroparen ser bara parter i sina marknader. Roller som är bundna till klinik eller försäkringar ser inga parter.
8. **Djurregistret kontrollerar ägaren** via porten `PartyPort.marketOf`. Ägaren måste finnas och höra till djurets marknad, både vid registrering och vid ägarbyte. Annars blir svaret `422`, med samma text oavsett om parten saknas eller finns i en annan marknad. Det betyder att den som registrerar djur inte kan ta reda på om en part finns i en marknad som den inte ser. En ägare som flyttar till ett annat land hanteras när det behövs.

## Konsekvenser

- Ägare och försäkringstagare får namn och kontaktuppgifter, med historik över vem som ändrade vad.
- Kundservice kan hitta en kund på personnummer utan att numret syns i svar eller loggar.
- Djurregistret kan inte peka på en ägare som inte finns. Ägarskap som registrerades innan kontrollen fanns kontrolleras inte i efterhand.
- **Radering enligt GDPR artikel 17 är inte löst.** Historiken skrivs aldrig över, men försäkringsuppgifter måste sparas en viss tid. En ADR om gallring och anonymisering behövs innan Petvold används med riktiga kunder.
- **Personnumret sparas i klartext** i databasen och skyddas av databasens rättigheter och installationens kryptering av lagringen. Kryptering per fält kan bli en senare ADR.
- **Kundens egen kanal**, alltså en roll bunden till försäkringar, ser inte sin egen part än. Det kräver en bindning till part i tokenen.
- **Kontaktpersoner för organisationer** byggs inte nu.

## Alternativ

- **Roller som en lista på parten:** enkel att läsa, men den måste hållas i takt med ägarskap och policyer i andra moduler.
- **Personnumret som id:** gör id:t till en personuppgift som sprids till alla moduler och händelser. Ett eget id (`pty_…`) gör att andra moduler aldrig behöver numret.
- **Sökning med `GET` och numret i adressen:** vanligt, men adresser loggas av proxyer och API-gateways.
- **Personnumret helt dolt, utan sökning:** skyddar mer, men kundservice behöver hitta kunden när den ringer.

## Källor

- Skatteverket, SKV 704: Personnummer och samordningsnummer (format och kontrollsiffra). skatteverket.se
- Bolagsverket om organisationsnummer. bolagsverket.se
- Lag (2018:218) med kompletterande bestämmelser till EU:s dataskyddsförordning, 3 kap. 10 §, om när personnummer får behandlas. riksdagen.se
- GDPR artikel 5.1 c (uppgiftsminimering), 17 (radering) och 25 (inbyggt dataskydd). eur-lex.europa.eu
- ITU-T E.164, om telefonnummer i internationellt format. itu.int
- ADR 0001, 0016 och 0024.
