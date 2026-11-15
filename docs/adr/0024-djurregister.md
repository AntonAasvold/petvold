# 0024. Djurregister: djur, id-nummer och ägarskap

- Status: Beslutad
- Datum: 2026-11-15

## Sammanhang

Policyn gäller ett djur (ADR 0007). Skademotorn läser i dag djurets födelsedatum från policyn. Innan policyer kan tecknas (M3) behövs ett register över djuren: vad djuret är, hur det identifieras och vem som äger det vid en viss tidpunkt. Ägarbyten är vanliga, till exempel när valpar säljs, och de påverkar försäkringen (överlåtelse, ADR 0007). Kvar att bestämma:

- vad registret innehåller
- hur ändringar sparas
- hur ägarskap över tid fungerar
- vem som får se djuren

## Beslut

1. **En ny modul, `animals`,** med schemat `animals` och tjänsterollen `animals_service` (ADR 0001).
2. **Uppgifter om djuret** sparas som revisioner, och ingen rad ändras:
   - art, ras och kön (koder ur referensdatan, ADR 0022), där rasen måste höra till arten
   - kastrerad
   - namn
   - födelsedatum
   - dödsdatum

   En rättelse eller ändring kräver gällande revision och en motivering. **Marknad och art ändras aldrig.** Ett djur registrerat med fel art registreras om.
3. **Id-nummer** (chip, registreringsnummer, pass) är unika i installationen och tas aldrig bort. Chipnummer har 15 siffror (ISO 11784) och sparas utan mellanslag. Övriga nummer sparas med versaler. Samma nummer på två djur ger `409`.
4. **Ägarskap med giltighetstid.**
   - Varje ägarskap har ett från-datum och ett till-datum, där till-datumet inte räknas in.
   - Ett ägarbyte avslutar det gällande ägarskapet samma dag som det nya börjar, i en transaktion, så att det aldrig finns glapp eller överlapp.
   - Ett ägarskap kan inte ändras i efterhand, bara avslutas. Databasen tillåter bara att `valid_to` sätts, och bara en gång.
   - Ett nytt ägarskap kan inte börja efter att djuret dött.
5. **Ägare är parter (`pty_…`).** Partmodulen (M2) kommer att äga personer och organisationer. Tills den finns kontrollerar registret bara formatet på id:t.
6. **Behörighet och omfång** (ADR 0016):
   - `animals:read` och `animals:write`, och en ny roll `animal-registrar`. `handler` och `approver` får läsa.
   - Djuret har en marknad, och anroparen ser bara djur i sina marknader. Ett djur utanför omfånget ger `404`.
   - Roller som är bundna till klinik eller försäkringar ser inga djur, eftersom registret inte kan avgöra vilka djur som hör till en viss klinik eller försäkring. Kliniker får därför inte slå upp djur än.
7. **Inga händelser än.** `animal.ownership_changed` och `animal.died` behövs när policymodulen ska reagera på dem (M3), och de byggs då med en outbox som i skademotorn (ADR 0008).

## Konsekvenser

- Ett djur har en spårbar historik: vem som ändrade vad och varför, och vem som ägde det på ett givet datum (`ownerOn`).
- Policymodulen kan läsa födelsedatum och art från registret i stället för att bära dem själv.
- Att rätta ett felregistrerat ägarbyte kräver ett nytt ägarbyte. Det finns ingen rättelse av giltighetstid i efterhand. Om det behövs blir det en bitemporal modell i en ny ADR.
- Uppgifter om ägare är personuppgifter. Registret sparar bara part-id:t, men den som kan läsa djur kan se vem som äger dem.

## Alternativ

- **Djuret som en del av policyn:** ett djur kan byta försäkring och ägare. Historiken skulle splittras mellan policyer.
- **Bitemporal historik för ägarskap redan nu:** gör det möjligt att rätta ett ägarbyte bakåt i tiden, men är mer än vad som behövs innan policymodulen finns.
- **Klinikers åtkomst via chipnummer:** praktiskt för direktreglering, men det skulle visa ägaren för vilken klinik som helst. Det kräver ett eget beslut om dataminimering.

## Källor

- ISO 11784 och 11785, om RFID-märkning av djur (chipnumrets format). iso.org
- Förordning (EU) 576/2013 om förflyttning av sällskapsdjur utan kommersiellt syfte, som kräver chip och pass för resor. eur-lex.europa.eu
- Jordbruksverkets register över hundar, som exempel på ett ägarregister med chipnummer. jordbruksverket.se
- GDPR artikel 5.1 c, om uppgiftsminimering. eur-lex.europa.eu
- ADR 0001, 0007, 0008, 0016 och 0022.
