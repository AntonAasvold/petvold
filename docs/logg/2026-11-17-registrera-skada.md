# Registrera skada i back office (PR #90)

**Datum:** 2026-11-17 **ADR:** 0018, 0035 **Moduler:** apps/backoffice

## Vad
En handläggare kan registrera en skada i back office, till exempel en som kunden skickat in på papper. Innan skadan sparas visar en förhandsbedömning förslaget, reglerna att titta på och beräkningen. Det här är första steget i skadeprocessen hela vägen, ett nytt avsnitt i roadmapen före M5.

## Hur det fungerar
1. **Inget nytt i kontraktet.** `POST /v1/claims` (`claims:register`) och `POST /v1/claim-previews` (`claims:preview`) fanns redan, och handläggarrollen har båda rättigheterna.
2. **`src/claim-form.ts` är ren.** `claimFormProblems` säger vad som saknas, med en nyckel per problem. `toClaimInput` bygger anropet med marknad, valuta och djur från policyn och beloppen i minsta enhet.
3. **`<pv-claim-register>`** på `/claims/new` har samma två spalter som skadeärendet: formuläret till vänster och förhandsbedömningen med knappen till höger. Routen ligger före `/claims/{id}`, så att "new" inte tolkas som ett id.
4. **Registreringen** skickar `Idempotency-Key`. Ändras formuläret släpps nyckeln, eftersom API:t svarar med fel om samma nyckel kommer med annat innehåll. Efter `201` öppnas ärendet.
5. **`<pv-waterfall>`** följer nu sin egen bredd med en container query. I den smala spalten lades stapeln annars mellan text och belopp och pressade ihop texten.

## Val och avvägningar
- **Id och skadenummer väljs i appen.** Kontraktet säger att klienten väljer id (`clm_…`). Skadenumret föreslås slumpvis som `S-<år>-<sex siffror>` och går att ändra, och ett nummer som redan används ger `409`. En serie som servern håller är bättre och står i roadmapen till ADR 0036.
- **Diagnoskoden skrivs in.** Koderna finns i produktens regelserie, men vägen dit går via produktversionen och regelserien. Förhandsbedömningen säger om koden är okänd (`DIAGNOSIS_KNOWN`), och det räcker tills vidare.
- **Kategorierna** är de som exempelreglerna använder. Produktens regler avgör vad som ersätts. En okänd kategori ersätts som vanligt, så listan begränsar inte motorn.
- **Policyn anges med id,** eller fylls i från policyns sida. Sökning på personnummer finns under Policyer, och ett personnummer hör inte hemma i ett formulär för skador.

## Rättat efteråt (PR #92)
- **Fälten låg inte i linje.** Raderna justerades mot nederkanten, så att knappen "Hämta policyn" skulle hamna i höjd med fältet. Tipset under diagnosfältet tryckte då ned de andra fälten. Nu justeras fälten mot överkanten.
- **Knappen ligger inuti policyfältet** (Web Awesomes `end`-plats). En knapp bredvid fältet hamnar annars i höjd med tipset, och ett tips utanför fältet når inte skärmläsare genom `wa-input`s shadow DOM.

## Att känna till
- Flödestestet registrerar en skada på Bella med 900 kr. Det är under självrisken, så ersättningen blir 0 och försäkringsbeloppet påverkas inte för de andra testerna.
- Ikonen `trash` är ny i `icons.json`.

## Filer
- `apps/backoffice/src/views/claim-register.ts` (ny), `src/claim-form.ts` (ny), `src/components/app-shell.ts`, `src/components/waterfall.ts`, `src/views/claims-queue.ts`, `src/views/policy-detail.ts`, `src/views/labels.ts`, `src/locales/sv.ts`, `icons.json`
- `apps/backoffice/test/claim-form.test.ts` (ny), `e2e/register.spec.ts` (ny)
- `docs/funktion/backoffice.md`, `docs/teknik/backoffice.md`, `docs/roadmap.md`
