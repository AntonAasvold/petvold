# 0034. Konventioner för API-kontraktet

- Status: Beslutad
- Datum: 2026-11-16

## Sammanhang

Kontraktet har 104 operationer som byggts under 30 PR:er. De följer i stort sett samma mönster, men en granskning 2026-11-16 hittade avvikelser:
- Inställningarna ligger på tre olika sätt: `/v1/retention-settings`, `/v1/notice-settings` och `/v1/access/roles`.
- Sökning och uppslag har tre former: `/v1/animal-lookup`, `/v1/party-searches` och `/v1/products/on-sale`.
- Ett djur ligger i adressen, fast policyn bara har ett djur: `/v1/policies/{policyId}/animals/{animalId}/limits`.
- Samma sak heter olika: `state` för skador och `status` för allt annat, och fem olika namn på filter för en part.
- Flera id saknar mönster i kontraktet.

Inga regler fanns nedskrivna, så varje ny operation valde själv. ADR 0002 säger att kontraktet är källan, men inte hur det ska se ut.

Arbetssättet säger att en brytande ändring kräver `/v2`. Ingen kanal är i drift än, och ADR 0031 gjorde redan en brytande ändring i `/v1`.

## Beslut

1. **Reglerna skrivs ner** i [api-konventioner.md](../teknik/api-konventioner.md):
   - adresser
   - handlingar
   - filter
   - id
   - versioner
   - fel
   - sidindelning
   - ordlistan över vad "version" betyder
2. **CI kontrollerar dem.** `npm run lint:openapi` kör `conventionProblems` i `modules/api/src/conventions.ts`. Avvikelserna som finns när beslutet fattas står i en lista (`KNOWN_DEVIATIONS`). Kontrollen stoppar en ny avvikelse, och en post i listan som inte längre avviker. Listan kan alltså bara krympa.
3. **Avvikelserna rättas i `/v1` direkt**, utan alias. Ingen kanal är i drift, så det är billigast nu.
4. **Från första kanalen i drift gäller arbetssättet.** En brytande ändring kräver då `/v2`, eller ett tillägg som inte bryter. Den dagen skrivs i `docs/status.md`.

## Konsekvenser

- **En ny operation följer samma regler** utan att någon behöver komma ihåg dem.
- **Rättelsen bryter mot `/v1`.** Exemplen, testerna, dokumentationen och dev-serverns utskrifter ändras i samma PR.
- **Kontrollen är enkel.** Den kontrollerar namn och form, inte om en resurs är rätt modellerad. Det kräver fortfarande granskning.

## Alternativ

- **Spectral med en regeluppsättning.** Det är ett etablerat verktyg, men det är ett beroende till för några få regler. De passar som vanlig kod bredvid kontraktskontrollen som redan finns.
- **Alias för de gamla adresserna.** Det behövs inte innan någon kanal är i drift, och det skulle göra kontraktet större.
- **`/v2` direkt.** Det ger två versioner att underhålla innan den första ens används.

## Källor

- Microsoft REST API Guidelines och Zalando RESTful API Guidelines, som publika exempel på samma sorts regler: substantiv i plural, kebab-case i adresser och camelCase i fält.
- ADR 0002, 0016, 0031 och granskningen 2026-11-15.
