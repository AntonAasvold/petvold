# 0027. Kullar i djurregistret

- Status: Föreslagen
- Datum: 2026-11-15

## Sammanhang

Uppfödare försäkrar ofta en hel kull innan valparna säljs (ADR 0007). Kullen behöver finnas i djurregistret, så att valparna kan registreras på en gång och spåras till sina föräldrar och sin uppfödare. När en valp säljs är det ett vanligt ägarbyte (ADR 0024).

## Beslut

1. **En kull är djur som föds tillsammans.** Den har marknad, art, födelsedatum, uppfödare (en part, ADR 0026) och eventuellt mor (`damId`) och far (`sireId`).
2. **Alla djur i kullen registreras på en gång**, i en transaktion, med uppfödaren som ägare från födelsedatumet. Varje djur har namn och kön och kan ha ras, id-nummer och `allowLookup`.
3. **Kullen ändras aldrig.** Ett djur som hör till kullen men inte registrerades med den registreras som ett eget djur. Ett djur kan bara höra till en kull, och djuret visar det med `litterId`.
4. **Föräldrarna kontrolleras** om de anges:
   - de ska vara registrerade djur av samma art i samma marknad
   - modern ska vara hona och fadern hane
   - båda ska vara födda före kullen
   - modern får inte ha dött före födseln. Fadern får det, eftersom inseminering är möjlig.
5. **Rasen ärvs** om båda föräldrarna har samma ras och ingen ras anges för djuret. Annars är rasen okänd, eller den som anges.
6. **Uppfödaren kontrolleras som andra ägare:** parten ska finnas i kullens marknad (ADR 0026).
7. **Samma rättigheter och omfång som för djur:** `animals:write` registrerar och `animals:read` läser. En kull utanför anroparens marknader ger `404`.
8. **Högst 24 djur per kull.**

## Konsekvenser

- Försäljningen av en valp är ett vanligt ägarbyte, och historiken visar uppfödaren som första ägare.
- Policymodulen (M3) kan försäkra en kull som en grupp (`PolicyGroup`, ADR 0007) och peka på kullens djur.
- Ett fel i kullen, till exempel fel mor, kan inte rättas i kullen. Uppgifterna om varje djur rättas som vanligt.
- Inga händelser än. `litter.registered` byggs när policymodulen behöver den.

## Alternativ

- **Föräldrar på varje djur i stället för en kull:** ger släktskap, men inte gruppen som uppfödaren försäkrar och säljer från.
- **En kull som kan ändras:** till exempel för att lägga till en valp senare. Det gör kullen till en egen historik att hålla reda på, och det behövs inte innan policymodulen finns.
- **Ras som blandning av föräldrarnas:** referensdatan har inga blandraser, så en okänd ras är ärligare.

## Källor

- Svenska Kennelklubbens regler för registrering av kullar, som exempel på uppgifter om en kull (mor, far, uppfödare, födelsedatum). skk.se
- ADR 0007, 0024 och 0026.
