# 0019. Attestkedja: beslutsförslag, attest och utbetalningsorder

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

ADR 0016 bestämmer att varje roll kan ha en beloppsgräns per valuta, och att ett beslut över gränsen kräver attest av någon annan (fyraögonsprincipen). ADR 0017 bestämmer att skadekedjan i M1 slutar med en utbetalningsorder som händelse. Betalningsmodulen tar emot den när den finns (M5).

Kvar att bestämma är hur kedjan ser ut i data:

- Ett beslut bokförs i samma transaktion som det sparas (ADR 0018). Om ett beslut över gränsen sparades direkt, skulle ledgern visa en ersättning som ingen har attesterat.
- Underlaget kan ändras mellan förslag och attest, till exempel av en retroaktiv policyändring eller en annan skada som förbrukar försäkringsbelopp. En attest måste gälla exakt det som föreslogs.
- Betalningsmodulen behöver veta vad som ska betalas ut, utan att läsa skademotorns tabeller (ADR 0001).

Intern kontroll med dualitet (ingen ensam person kan både initiera och godkänna en utbetalning) är ett grundkrav i styrningen av försäkringsföretag. Källor nedan.

## Beslut

**1. Ett beslut över gränsen blir ett beslutsförslag, inte ett beslut.**
- `POST /v1/claims/{id}/decisions` svarar som i dag med `201` och ett beslut när ersättningen ryms inom handläggarens gräns, och med `202` och ett beslutsförslag när den inte gör det.
- Förslaget sparas i en egen tabell, `claims.decision_proposal`. Det bokförs inte, öppnar ingen självriskperiod och ger ingen utbetalningsorder.
- Förslaget innehåller allt som behövs för beslutet: handling, utfall, belopp, valuta, motivering och kontrollsumman (`inputHash`) för underlaget.
- Ett ärende har högst ett öppet förslag. Medan det är öppet kan ingen annan fatta beslut i ärendet (409).
- Ersättning 0, till exempel ett avslag, kräver aldrig attest.

**2. Attest gör förslaget till ett beslut.**
- `POST /v1/claims/{id}/proposals/{proposalId}/approvals` kräver rättigheten `claims:approve`.
- **Fyra ögon.** Den som attesterar får inte vara den som föreslog (403).
- **Gräns för attest.** Attestantens egen gräns per valuta gäller också (403 över den).
- **Samma underlag.** Motorn bedömer ärendet igen. Om kontrollsumman inte är densamma som i förslaget har underlaget ändrats, och attesten avvisas (409). Förslaget måste då skickas tillbaka och göras om.
- Beslutet sparas med `decidedBy` = den som föreslog, `approvedBy` = attestanten och `proposalId`. Förslaget stängs i samma transaktion som beslutet, underlaget och bokföringen.
- `POST .../proposals/{proposalId}/returns` skickar tillbaka förslaget med en motivering. Inget beslut fattas.

**3. Gränser per roll och valuta, i rollinställningen.**
- `decisionLimits` (för `claims:decide`) och `approvalLimits` (för `claims:approve`) per valuta i minsta enhet.
- Bara roller som har rättigheten räknas. Den högsta gränsen bland dem gäller.
- En roll med rättigheten men utan gränser har ingen gräns. En valuta som saknas i en angiven gräns har gränsen 0, så att allt i den valutan kräver attest. Det är det säkra felet.
- Automatiska beslut och omprövningar omfattas inte. Där styr produktens regler (`autoSettleMax`), och de följer förslaget utan att någon bedömer det.

**4. Utbetalningsorder som händelse.**
- Varje beslut som ökar ärendets ersättning skriver händelsen `claim.payout_ordered` i samma transaktion. Händelsen innehåller ordernummer, ärende, beslut, belopp (ökningen), valuta, policy, kanal och klinik.
- Mottagaren väljs i betalningsmodulen (öppen fråga i ADR 0017: klinik eller kund).
- En omprövning som sänker ersättningen ger ingen order. Återkrav är en öppen fråga i M3 och M5.

## Konsekvenser

- Ledgern innehåller bara attesterade beslut. Ett öppet förslag syns i listan över förslag, inte i bokföringen. Reserven (nästa steg) visar det förväntade beloppet under tiden.
- Två tidpunkter för en attest: förslaget har `proposedAt`, beslutet `decidedAt`. Beviskedjan sparar underlaget vid attesten, och det är identiskt med förslagets eftersom kontrollsumman måste stämma.
- Databasen upprätthåller reglerna: ett öppet förslag per ärende, att förslaget stängs en gång, och att den som attesterar inte är den som föreslog.
- Rollinställningen blir större. Felaktiga gränser (negativa, inte heltal) stoppar starten.

## Alternativ

- **Beslut med status (föreslaget, attesterat) i samma tabell:** ett beslut skulle ändra status, vilket bryter regeln att beslut aldrig ändras. Bokföringen skulle behöva vänta på statusen.
- **Bokföra direkt och återföra vid avslag:** ledgern skulle visa oattesterade utbetalningar och få onödiga rättelser.
- **Gräns per användare i stället för per roll:** Petvold lagrar inga användare (ADR 0016). En kund kan skapa roller per nivå, till exempel `handler-senior`.

## Källor

- Finansinspektionens föreskrifter och allmänna råd om styrning, riskhantering och kontroll i försäkringsföretag (FFFS 2015:12), om intern kontroll. fi.se
- Europaparlamentets och rådets direktiv 2009/138/EG (Solvens II), artikel 41 (företagsstyrning) och artikel 46 (intern kontroll). eur-lex.europa.eu
- COSO, *Internal Control – Integrated Framework* (2013), om uppdelning av arbetsuppgifter (*segregation of duties*). coso.org
- ADR 0001, 0016, 0017 och 0018.
