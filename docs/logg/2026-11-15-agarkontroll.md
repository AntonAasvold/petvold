# Djurregistret kontrollerar ägaren (PR #38)

**Datum:** 2026-11-15 **ADR:** 0026 (punkt 8) **Moduler:** `animals`, `api`

## Vad

Ett djur kan bara registreras eller byta ägare till en part som finns och hör till djurets marknad.

## Hur det fungerar

1. `AnimalDeps` har en valfri port, `parties: PartyPort`, med `marketOf(partyId)`.
2. `AnimalService.register` och `transfer` anropar `checkOwner(partyId, market)` efter de andra kontrollerna. Om partens marknad inte är djurets, eller parten saknas (`null`), blir det `AnimalError('validation')`, alltså `422`.
3. `createApp` skapar `parties` före `animals` och skickar tjänsten som port, eftersom `PartyService.marketOf` har rätt form. Dev-servern gör likadant.

## Val och avvägningar

- **En port i stället för ett beroende.** `animals` importerar inget från `parties` (ADR 0001), precis som med referensdatan.
- **Samma marknad.** Då ser den som ser djuret också ägaren, och omfånget hänger ihop.
- **Samma svar för en part som saknas och en part i en annan marknad.** Den som registrerar djur kan inte använda felmeddelandet för att ta reda på om en part finns i en marknad som den inte ser.
- **`422`, inte `404`.** Felet gäller innehållet i anropet, inte adressen.

## Att känna till

- Utan port, som i vissa tester, kontrolleras bara formatet `pty_…`.
- Ägarskap som redan finns kontrolleras inte i efterhand.
- API-testerna för djur lägger in Anna, Bo och Dag direkt i en `InMemoryPartyStore`.

## Filer

- `modules/animals/src/index.ts` (`PartyPort`, `checkOwner`)
- `modules/api/src/app.ts`, `modules/api/src/dev-server.ts`
- `modules/api/test/animals.test.ts`, `modules/animals/test/animal-service.test.ts`
