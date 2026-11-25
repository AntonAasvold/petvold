# Omräkning av beslut i back office (PR #NN)

**Datum:** 2026-11-25 **ADR:** 0018, 0035 **Moduler:** `apps/backoffice`

## Vad
Förklaringen av ett beslut i skadeärendet har knappen **Räkna om från underlaget**. Den räknar om beslutet från det sparade underlaget och visar om resultatet blev detsamma.

## Hur det fungerar
`<pv-explanation-dialog>` anropar `POST /v1/claims/{id}/decisions/{seq}/replays`, som funnits sedan ADR 0018. Svaret visas på tre sätt:
- `identical`: samma resultat, med motorns version
- `different`: varje skillnad med sökväg, sparat värde och omräknat värde
- `model_unavailable`: beräkningsmodellen som motorn saknar

## Val och avvägningar
- **I förklaringen och inte som en egen sida.** Den som vill veta varför ett beslut blev som det blev vill ofta också se att det håller. Dialogen öppnas redan för varje beslut i historiken.
- **Ingen rättighet utöver `claims:read`**, som i API:t. Omräkningen sparar inget.

## Filer
- `apps/backoffice/src/components/explanation-dialog.ts`, `locales/sv.ts`, `e2e/decisions.spec.ts`
