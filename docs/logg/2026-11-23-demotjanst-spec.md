# Specen för demotjänsten i repot (PR #148)

**Datum:** 2026-11-23 **ADR:** 0041 **Moduler:** `api` (testdatan)

## Vad
Specen för tjänsten som tar emot och visar alla händelser, spelar bank och kontrollerar att allt stämmer, ligger nu i repot som [Demotjänsten](../teknik/demotjanst.md). Testdatan kan prenumerera på demotjänsten innan något händer.

## Hur det fungerar
- Specen skrevs 2026-11-21 som ett eget dokument. Den flyttades hit med det som byggts sedan:
  - händelserna från `billing` och `payments`
  - låtsasbankens format och utbetalningarna
  - kontrollerna B1–B4 och B8, som nu kan byggas
  - hur tjänsten läggs till i demons Compose
- `runDemo` tar `webhookUrl`, och `npm run demo:seed` läser den ur `DEMO_WEBHOOK_URL`. Prenumerationen på alla händelser görs innan första kunden. Händelserna väntar sedan i Petvolds kö tills Petvold startar efter `reset.sh`.

## Val och avvägningar
- **Specen i repot, inte bara som dokument.** Den som bygger tjänsten hittar den bredvid koden, och den ändras i samma PR som det den beskriver.
- **Ingen hemlighet i testdatan.** Prenumerationen skapas utan att hemligheten sparas. Demotjänsten byter hemligheten när den startar (`secret-rotations`), som specen redan beskrev för en prenumeration utan känd hemlighet.
- **Gamla tidsstämplar är inget problem.** Webhooks signeras när de skickas, inte när händelsen sker. Testdatans historik skickas när Petvold startar, med dagens tid, och händelsernas `time` är fortfarande dagen de hände. Jag trodde först att demotjänsten skulle behöva godta gamla signaturer, men det behövs inte.

## Att känna till
- `DEMO_WEBHOOK_URL` sätts inte i `deploy/demo/compose.yaml` förrän demotjänsten finns där. Annars väntar tusentals leveranser på en adress som inte svarar.
- Punkt 4 i specens lista över det Petvold behöver är fortfarande öppen: `termNo` på `policy.issued` och `policy.cancelled`.

## Filer
- `docs/teknik/demotjanst.md`
- `modules/api/src/demo-data.ts`, `modules/api/scripts/demo-seed.ts` och `modules/api/test/demo-data.test.ts`
