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
| Policyer | Sök på policy-, djur- eller part-id, personnummer eller chipnummer. Policyn med termer, förbehåll, versioner över tid och historik. | `policies:read`, och `parties:read` eller `animals:read` för personnummer och chip |
| Ansökningar | Kön för manuell prövning, och godkända och avslagna ansökningar. Ansökan med svar och reglernas kontroller. Godkänn eller avslå med motivering, eller återkalla. | `policies:read`, `policies:underwrite` för att pröva, `policies:write` för att återkalla |
| Förslag | Förslag som väntar på svar: överlåtelse till ny ägare och avslut när djuret dött. Godkänns eller avböjs från policyn. | `policies:read`, `policies:write` för att svara |
| Meddelanden | Det som behöver en person: misslyckade, försenade och de som saknar en text som lagen kräver. Meddelandet med innehåll, lagrum och utskick. Rapportera ett utskick för hand. | `notices:read`, `notices:deliver` för att rapportera |
| Webhooks | Prenumerationer och händelser som inte kom fram. Skapa en prenumeration, stänga av och sätta på, ny hemlighet och skicka igen. | `webhooks:read`, `webhooks:manage` för att ändra |

| Inställningar | Roller och gränser, gallring och bolagets texter för meddelanden, som versioner med skäl och historik | `access:read`, `parties:privacy` eller `notices:read`. Att ändra kräver `access:manage`, `parties:erase` eller `notices:configure`. |

| Produkter | Produkterna och varje produktversion med innehåll, säljperiod och livscykel | `catalog:read`, `catalog:write` för utkast, `catalog:publish` för att publicera, skicka tillbaka och avsluta försäljning |
| Regeluppsättningar | Serierna (skaderegler, tariffer, prisvillkor och teckningsregler) och varje version med livscykel | `rules:read`, `rules:write` för utkast, `rules:publish` för att publicera, skicka tillbaka och avveckla |

*Inte byggt än:* simulering av en regelversion mot sparade beslut, och formulär för innehållet i stället för JSON.

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

## Policyer, ansökningar och förslag

- **Sökningen** känner igen vad man skriver: `pol_…` öppnar policyn, `ani_…` och `pty_…` listar djurets eller försäkringstagarens policyer.
  - Ett personnummer söks med `POST /v1/parties/searches`, så att numret aldrig hamnar i en adress eller logg.
  - Ett chipnummer på 15 siffror söks i djurregistret.
- **Policyn** visar det som gäller i dag överst. Under det finns:
  - termerna med försäkringsbelopp, självrisk och premie
  - förbehållen och var de kom ifrån
  - versionerna över tid, med när varje version blev känd och när den ersattes
  - historiken över alla ändringar
- **En ansökan i kön** visar djuret som det var när ansökan kom in, svaren och varje kontroll i reglerna med regelversion. Den som prövar godkänner eller avslår, alltid med en motivering:
  - Ett godkännande tecknar policyn med de förbehåll som reglerna föreslår.
  - Ett avslag kräver en skälkod, och den sökande får ett meddelande med skälen (ADR 0032).
  - Har startdagen passerat anges en ny.
- **Ett förslag** öppnas från policyn. En överlåtelse godkänns med var den nya ägaren godkände villkoren, till exempel per telefon. Ett avböjande kräver ett skäl.

## Meddelanden och webhooks

- **Meddelanden** börjar på fliken "Behöver en person", alltså samma kö som `GET /v1/notices?attention=true`.
  - Varje rad visar varför meddelandet hamnade där: misslyckat, försenat eller text saknas.
  - Meddelandet visar innehållet som fält, lagrummen och varje utskick med kanal, tid och dokument-id.
  - Den som har `notices:deliver`, till exempel dokumentsystemet eller en person som har skickat ett brev för hand, kan rapportera utskicket.
- **Webhooks:**
  - Listan visar prenumerationerna. En prenumeration som misslyckas markeras innan den stängs av automatiskt.
  - Fliken "Kom inte fram" listar döda händelser för alla prenumerationer.
  - En ny prenumeration visar hemligheten en enda gång, med en knapp för att kopiera den. Detsamma gäller en ny hemlighet.
  - Från prenumerationen kan man skicka döda händelser igen, en i taget eller alla, och stänga av eller sätta på den.

## Inställningar

Varje inställning är versionerad (ADR 0020, 0028, 0032). En ändring blir en ny version, bygger på den som gäller och kräver ett skäl. Hann någon annan ändra först, svarar API:t `409` och appen erbjuder att ladda om. Historiken visar varje version med vem, när och varför.

- **Roller och gränser:** tabellen visar varje roll, vad den är bunden till, gränserna för att besluta och attestera, och rättigheterna. En gräns ändras per roll, sort och valuta i kronor eller euro, och ett tomt belopp tar bort gränsen för valutan. Rättigheter ändras med API:t (`POST /v1/settings/roles/versions`) eller `npm run roles:sync`.
- **Gallring:** år efter den senaste relationen per marknad. En marknad som inte finns med gallras aldrig automatiskt.
- **Meddelanden:** per marknad:
  - dagar för "snarast"
  - de typer som lagen inte kräver och som stängs av
  - avsändare och text om prövning på svenska och engelska

  Utan text om prövning blir ett avslag ofullständigt (ADR 0032).

## Produkter och regler

Produkter och regeluppsättningar har samma livscykel (ADR 0021, 0023): utkast, granskning och publicering. En produkts försäljning kan sedan avslutas, och en regelversion kan avvecklas.

1. **Nytt utkast.** "Nytt utkast från den här" kopierar innehållet från vald version. För en produkt föreslås nästa versionsnamn, till exempel `2026.2`. Regelversioner numreras av API:t.
2. **Ändra.** Innehållet redigeras som JSON. API:t kontrollerar det mot kontraktet och produktens regler, och appen visar varje fält som är fel.
3. **Skicka till granskning.** Innehållet låses med en kontrollsumma.
4. **Publicera eller skicka tillbaka.** Den som skickade in kan inte publicera (fyra ögon), och appen säger det. Att skicka tillbaka kräver ett skäl.
5. **Avsluta.** En produkts försäljning avslutas från en dag, med skäl. Två versioner av en produkt kan inte säljas samma dag, så den gamla avslutas innan den nya publiceras. En regelversion avvecklas med skäl.

## Språk

Svenska och engelska. Appen börjar på webbläsarens språk, svenska om det inte är engelska. Valet gäller tills fliken stängs.
- Belopp och datum skrivs på språkets sätt.
- Skälen i en bedömning kommer från API:t på samma språk.

## Personuppgifter

- Inget sparas i webbläsaren utom språket under sessionen.
- Personnummer visas maskade, som API:t ger dem.
- Utloggning rensar allt.
