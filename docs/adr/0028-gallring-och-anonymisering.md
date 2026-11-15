# 0028. Gallring och anonymisering av personuppgifter

- Status: Föreslagen
- Datum: 2026-11-15

## Sammanhang

Petvold sparar personuppgifter i partmodulen (ADR 0026): namn, kontaktuppgifter, adress, födelsedatum och personnummer. Historiken skrivs aldrig över (ADR 0018, 0024, 0026), men personuppgifter får inte sparas längre än nödvändigt (GDPR artikel 5.1 e). Den registrerade kan dessutom begära radering (artikel 17).

Samtidigt måste ett försäkringsbolag spara en del uppgifter:
- Räkenskapsinformation sparas i sju år (bokföringslagen 7 kap. 2 §).
- Den som vill ha försäkringsersättning måste väcka talan inom tio år från försäkringsfallet (försäkringsavtalslagen 7 kap. 4 §). Underlaget till beslutet behövs så länge en tvist är möjlig.

Rätten till radering gäller inte när uppgifterna behövs för en rättslig förpliktelse eller för att fastställa, göra gällande eller försvara rättsliga anspråk (artikel 17.3 b och e). Lagstiftning och lagringstider skiljer sig mellan marknader, och Petvold installeras hos flera försäkringsbolag (ADR 0010). Kvar att bestämma:

- var personuppgifterna finns
- vad som tas bort och hur
- när det sker
- vem som får göra det

## Beslut

1. **Personuppgifter finns bara i partmodulen.** Andra moduler pekar på parter med `pty_…` och kopierar aldrig namn, kontaktuppgifter eller personnummer till sina tabeller, ögonblicksbilder eller händelser. Skademotorns underlag innehåller i dag bara id:n, och regeln gäller även policymodulen (M3). Då räcker det att anonymisera på ett ställe.
2. **Anonymisering i stället för radering.**
   - Partens personuppgifter tas bort i alla revisioner, och personnummer och organisationsnummer tas bort.
   - Part-id:t, sorten och marknaden finns kvar, så att ägarskap, policyer, beslut och bokföring fortfarande hänger ihop.
   - Parten markeras som `anonymized`, och svaret visar inga personuppgifter.
3. **Det enda undantaget från att historiken aldrig skrivs över.**
   - Anonymiseringen görs av en databasfunktion som ägs av migreringsrollen (`security definer`). Tjänsterollen `parties_service` får bara köra funktionen och kan fortfarande inte uppdatera eller ta bort rader direkt.
   - Funktionen sparar en post i `parties.erasure` med part-id, vem som begärde och godkände, när och på vilken grund, men inga personuppgifter.
4. **Lagringstider som inställning per installation och marknad**, versionerade och ändringsbara via API:et, som rollinställningen (ADR 0020). Varje marknad anger:
   - hur länge en part sparas efter sin **sista relation**, till exempel ett avslutat ägarskap, en avslutad policy eller ett avslutat skadeärende
   - en förvald längsta tid som är lika lång som den längsta lagstadgade tiden. För Sverige föreslås tio år efter det senaste försäkringsfallet, eftersom det är längre än bokföringens sju år.

   Petvold föreslår standardvärden med källor. Försäkringsbolaget ansvarar för att värdena är rätt.
5. **Sista relation via en port.** Varje modul som pekar på parter svarar på `lastActivity(partyId)`: djurregistret med det senaste ägarskapets slut, skademotorn med det senaste beslutet, och policymodulen med det senaste avslutet. Partmodulen beräknar när parten får anonymiseras, utan att läsa andra modulers tabeller (ADR 0001).
6. **Gallring automatiskt, med fyra ögon.**
   - Ett jobb listar parter vars lagringstid har gått ut.
   - Varje anonymisering kräver att en person godkänner den. Anonymiseringen går inte att ångra, så den följer fyraögonsprincipen som attest (ADR 0019): den som begär får inte godkänna.
7. **Begäran om radering (artikel 17).**
   - En begäran registreras på parten med datum.
   - Om parten inte har någon relation som kräver att uppgifterna sparas, anonymiseras den med fyra ögon.
   - Annars avslås begäran med skälet och det datum då parten tidigast får anonymiseras. Parten begränsas då (artikel 18): den syns inte vid sökning, och bara rollen med `parties:privacy` kan läsa den.
   - Svaret till den registrerade skickas av försäkringsbolaget. Petvold lagrar underlaget.
8. **Behörighet.** Nya rättigheter `parties:privacy` (se begränsade parter, registrera begäran och begära anonymisering) och `parties:erase` (godkänna anonymisering). En ny roll `privacy-officer` får båda. Ingen standardroll har `parties:erase` utan `parties:privacy`.
9. **Säkerhetskopior.** Anonymiserade uppgifter finns kvar i säkerhetskopior tills de gallras enligt installationens rutin. Efter en återställning körs anonymiseringarna i `parties.erasure` igen, i ordning, innan systemet öppnas.
10. **Utanför beslutet:**
    - användar-id:n i `changedBy` och liknande fält. De pekar på försäkringsbolagets anställda och gallras enligt bolagets egna rutiner.
    - fritext, till exempel fakturarader och motiveringar, kan innehålla personuppgifter som någon har skrivit in. API:et ska tydligt säga att fritext inte får innehålla personuppgifter, och en senare ADR får avgöra om fritext ska kunna rensas.

## Konsekvenser

- Rätten till radering kan uppfyllas utan att beslut, bokföring och ägarkedjor går sönder.
- Historiken är oföränderlig med ett enda dokumenterat undantag, som bara går att använda via en funktion och fyra ögon.
- Varje modul som pekar på parter måste uppfylla `lastActivity`. Policymodulen (M3) får det som krav.
- Lagringstiderna är försäkringsbolagets ansvar. Petvold föreslår bara värden.
- Organisationers uppgifter är inte personuppgifter, men en enskild firma kan vara det. De hanteras på samma sätt.

## Alternativ

- **Radera parten helt:** bryter ägarskap, policyer och beslut som pekar på den, och raderar underlag som behövs enligt lag.
- **Kryptera varje part med en egen nyckel och kasta nyckeln (crypto-shredding):** skyddar även säkerhetskopior, men kräver nyckelhantering per part och fungerar inte med sökning på personnummer. Det kan bli ett tillägg senare.
- **Ingen automatisk gallring, bara på begäran:** strider mot lagringsbegränsningen i artikel 5.1 e.
- **Fasta lagringstider i koden:** tiderna skiljer sig mellan marknader och kan ändras i lag.
- **Mjuk radering med en flagga och uppgifterna kvar:** uppgifterna finns då fortfarande, och det är inte radering.

## Källor

- GDPR artikel 5.1 e (lagringsminimering), 17 (radering, med undantagen i 17.3 b och e), 18 (begränsning) och 25 (inbyggt dataskydd). eur-lex.europa.eu
- Bokföringslag (1999:1078) 7 kap. 2 §, om att räkenskapsinformation sparas i sju år. riksdagen.se
- Försäkringsavtalslag (2005:104) 7 kap. 4 §, i lydelse enligt SFS 2013:1092, om talan inom tio år. riksdagen.se
- Integritetsskyddsmyndigheten (IMY) om rätten till radering och lagringstid. imy.se
- ADR 0001, 0010, 0018, 0019, 0020 och 0026.
