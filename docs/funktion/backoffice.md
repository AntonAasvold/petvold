# Back office

Ett gränssnitt för handläggare och back office, byggt på Petvolds API (ADR 0035). Bolaget kan använda det som det är, eller bygga sitt eget med API:t.

## Vad som finns

| Del | Gör | Kräver |
| --- | --- | --- |
| Skador | Arbetsköerna: väntar på beslut, väntar på attest, prövning begärd och beslutade. Ett ärende med uppgifter, beräkning, bedömning regel för regel, beslut och förklaring. | `claims:read` |
| Besluta | Godkänn eller avslå. Mot förslaget krävs skälkod och motivering. Över gränsen blir beslutet ett förslag. | `claims:decide`, och `claims:override` mot förslaget |
| Attestera | Attestera eller skicka tillbaka någon annans förslag | `claims:approve` |
| Pröva | Begär prövning av ett automatiskt beslut för kundens räkning, med kundens synpunkt. En begäran besvaras av ett nytt beslut. | `claims:request-review`, `claims:decide` |
| Ompröva | Bedöm ärendet igen med det som är känt nu | `claims:reassess` |

*Inte byggt än:*
- policyer och ansökningar (steg 3)
- meddelanden och webhooks (steg 4)
- inställningar (steg 5)

## Logga in

- **I drift** loggar man in med bolagets konto, via bolagets identitetstjänst (OIDC). Appen får en token som bara finns i minnet. En omladdning av sidan loggar in igen genom identitetstjänstens session.
- **Lokalt** väljer man en av dev-serverns tokens, till exempel `dev-handler` eller `dev-approver`.

**Menyerna följer rättigheterna.** Appen visar bara de delar som användaren har rätt till, enligt `GET /v1/me`. API:t prövar ändå varje anrop. Ett ärende utanför det användaren får se visas som "Finns inte", precis som i API:t.

## Arbeta i köerna

- **Flikarna** byter kö.
- **Listan** hämtar 50 åt gången. "Visa fler" hämtar nästa sida, och det görs också när man går till sista raden med tangentbordet.
- **Tangentbordet:**
  - piltangenterna flyttar mellan cellerna
  - Home och End går till radens början och slut
  - Ctrl+Home och Ctrl+End går till listans första och sista cell
  - Page Up och Page Down flyttar tio rader
  - Enter öppnar ärendet

## Besluta och attestera

Ärendet visar de åtgärder som användaren har rätt till just nu.

1. **Besluta.** Formuläret börjar på förslaget från bedömningen. Om man väljer det andra utfallet visar appen att beslutet går emot förslaget och kräver skälkod och motivering. De sparas med beslutet (ADR 0018).
2. **Över gränsen.** Om ersättningen är högre än användarens gräns blir beslutet ett förslag som väntar på attest (ADR 0019). Appen säger det direkt.
3. **Attestera.** Den som har rätt att attestera ser förslaget, vem som gjorde det och deras gräns, och kan attestera eller skicka tillbaka med en motivering. Den som gjorde förslaget ser att någon annan måste attestera det.
4. **Underlaget ändrades.** Varje beslut skickar bedömningens `inputHash`. Om ärendet har ändrats sedan det öppnades, till exempel för att en annan skada förbrukat försäkringsbeloppet, svarar API:t `409`. Appen säger det och erbjuder att ladda om.
5. **Förklaringen.** "Varför?" på ett beslut visar huvudskälet, eventuell avvikelse från förslaget och beräkningen steg för steg, på användarens språk.

Varje åtgärd skickas med en idempotensnyckel. Om nätverket svajar och man försöker igen blir det inte två beslut.

## Språk

Svenska och engelska. Appen börjar på webbläsarens språk, svenska om det inte är engelska. Valet gäller tills fliken stängs.
- Belopp och datum skrivs på språkets sätt.
- Skälen i en bedömning kommer från API:t på samma språk.

## Personuppgifter

- Inget sparas i webbläsaren utom språket under sessionen.
- Personnummer visas maskade, som API:t ger dem.
- Utloggning rensar allt.
