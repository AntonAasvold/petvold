# 0023. Produktversioner: innehåll, livscykel och säljperiod

- Status: Föreslagen
- Datum: 2026-11-15

## Sammanhang

ADR 0021 lägger produkter och produktversioner i modulen `catalog` och bestämmer att produktversionen pekar på en regelserie. Policyer bär redan ett id för produktversionen (till exempel `SE-HUND-VV-LIV@2026.2`). Skademotorn har hittills översatt id:t till en regelserie med en funktion i installationen. Kvar att bestämma:

- vad en produktversion innehåller
- hur den publiceras
- hur säljperioden fungerar
- hur andra moduler hittar den

## Beslut

1. **Id:t är `<produkt>@<version>`.** Produktkoden har stora bokstäver, siffror och bindestreck. Versionen väljs av den som skriver produkten, till exempel `2026.2`. Id:t är det som policyer och skador sparar.
2. **Innehåll:**
   - marknad och valuta
   - arter (koder ur referensdatan)
   - namn per språk
   - regelserie
   - för veterinärvård: valbara försäkringsbelopp, valbara självrisker (en kod per alternativ med samma villkorsmodell som policyn, `DeductibleTerms`), standardval och karenstid
3. **Livscykel:** `draft → in_review → published`, som för regeluppsättningar (ADR 0021).
   - Ett utkast kan ändras.
   - Granskning låser innehållet och räknar ut en kontrollsumma över innehåll och säljstart.
   - Vid granskning kontrolleras att arterna finns och är aktiva, och att regelserien har en publicerad version som gäller när försäljningen börjar.
   - Publicering kräver en annan person än den som skickade till granskning (fyra ögon).
4. **En publicerad version ändras aldrig**, med ett undantag: försäljningen kan avslutas tidigare. Det nya slutdatumet får inte ligga före dagens datum, och det får bara flyttas tidigare, aldrig senare. Motiveringen sparas.
5. **Högst en version av en produkt säljs samma dag.** Det kontrolleras i tjänsten och av en trigger. Den som säljer behöver därför aldrig välja mellan två versioner.
6. **En version som inte säljs längre gäller ändå för de policyer som redan har den.** Därför finns inget steg för avveckling. Skademotorn hittar regelserien för varje publicerad version, oavsett säljperiod.
7. **Kontroller mot andra moduler går via tjänster.** Katalogen får två funktioner av installationen: `speciesActive`, som läser katalogens egen referensdata, och `ruleSeriesInForce`, som frågar `decisioning`. Inga tabeller läses över modulgränsen (ADR 0001).
8. **Rättigheter:**
   - `catalog:write` (rollen `catalog-manager`) skriver utkast och skickar till granskning.
   - `catalog:publish` (rollen `catalog-publisher`) publicerar, skickar tillbaka och avslutar försäljning.
   - `catalog:read` läser.
9. **Villkor för ett val:** den rena funktionen `vetCareTermsFor` ger policyns villkor för kundens val av försäkringsbelopp och självrisk. Policymodulen (M3) kommer att använda den när en policy tecknas.

## Konsekvenser

- Skademotorn läser regelserien från produktversionen, och den tillfälliga funktionen i installationen försvinner. En policy på en okänd eller opublicerad produktversion får inga regler, och skademotorn svarar `409`.
- En ny produkt eller ett nytt prisalternativ kräver ingen ny version av Petvold, bara en ny produktversion.
- Bara veterinärvård finns som moment. Livförsäkring, ansvar och andra moment läggs till när motorn kan bedöma dem.
- Pris finns inte i produktversionen än. Det kommer med prismodulen (M4).

## Alternativ

- **Numrerade versioner som för regler:** enklare att räkna fram nästa, men produktversioner har redan namn som syns utåt (`2026.2`), och policyerna använder dem.
- **Ett avvecklingssteg som för regler:** en avvecklad version skulle sakna regler för befintliga policyer. Ett slutdatum för försäljningen räcker.
- **Fri ändring av säljperioden:** att förlänga en avslutad försäljning ändrar vad som har sålts i efterhand. En ny version är tydligare.

## Källor

- EIOPA, *Guidelines on product oversight and governance* (POG), om godkännande och översyn av försäkringsprodukter. eiopa.europa.eu
- Försäkringsdistributionsdirektivet (EU) 2016/97, artikel 25, om produktgodkännande. eur-lex.europa.eu
- NIST SP 800-53 Rev. 5, AC-5 *Separation of Duties*. csrc.nist.gov
- ADR 0001, 0016, 0021 och 0022.
