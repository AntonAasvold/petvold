# Back office

Ett gränssnitt för handläggare och back office, byggt på Petvolds API (ADR 0035). Bolaget kan använda det som det är, eller bygga sitt eget med API:t.

## Vad som finns

| Del | Gör | Kräver |
| --- | --- | --- |
| Skador | Arbetsköerna: väntar på beslut, väntar på komplettering, väntar på attest, prövning begärd och beslutade. Ett ärende med uppgifter, beräkning, bedömning regel för regel, beslut och förklaring. | `claims:read` |
| Besluta | Godkänn eller avslå. Mot förslaget krävs skälkod och motivering. Över gränsen blir beslutet ett förslag. | `claims:decide`, och `claims:override` mot förslaget |
| Attestera | Attestera eller skicka tillbaka någon annans förslag | `claims:approve` |
| Pröva | Begär prövning av ett automatiskt beslut för kundens räkning, med kundens synpunkt. En begäran besvaras av ett nytt beslut. | `claims:request-review`, `claims:decide` |
| Ompröva | Bedöm ärendet igen med det som är känt nu | `claims:reassess` |
| Bilagor | Lägg till en bilaga som adress i bolagets arkiv med kontrollsumma, eller ersätt en | `claims:register` |
| Rätta | Rätta behandlingsdagar, diagnos, fakturarader och kanal, med skäl. Ärendet får en ny revision. | `claims:register` |
| Komplettera | Begär underlag av kunden eller kliniken, registrera att det kommit in, eller återkalla begäran | `claims:request-information`, och `claims:register` för att registrera svaret |
| Policyer | Sök på policy-, djur- eller part-id, personnummer eller chipnummer. Policyn med termer, förbehåll, versioner över tid och historik. | `policies:read`, och `parties:read` eller `animals:read` för personnummer och chip |
| Ansökningar | Kön för manuell prövning, och godkända och avslagna ansökningar. Ansökan med svar och reglernas kontroller. Godkänn eller avslå med motivering, eller återkalla. | `policies:read`, `policies:underwrite` för att pröva, `policies:write` för att återkalla |
| Förslag | Förslag som väntar på svar: överlåtelse till ny ägare och avslut när djuret dött. Godkänns eller avböjs från policyn. | `policies:read`, `policies:write` för att svara |
| Meddelanden | Det som behöver en person: misslyckade, försenade och de som saknar en text som lagen kräver. Meddelandet med innehåll, lagrum och utskick. Rapportera ett utskick för hand. | `notices:read`, `notices:deliver` för att rapportera |
| Webhooks | Prenumerationer och händelser som inte kom fram. Skapa en prenumeration, stänga av och sätta på, ny hemlighet och skicka igen. | `webhooks:read`, `webhooks:manage` för att ändra |

| Inställningar | Roller och gränser, gallring och bolagets texter för meddelanden, som versioner med skäl och historik | `access:read`, `parties:privacy` eller `notices:read`. Att ändra kräver `access:manage`, `parties:erase` eller `notices:configure`. |

| Produkter | Produkterna och varje produktversion med innehåll, säljperiod och livscykel | `catalog:read`, `catalog:write` för utkast, `catalog:publish` för att publicera, skicka tillbaka och avsluta försäljning |
| Regeluppsättningar | Serierna (skaderegler, tariffer, prisvillkor och teckningsregler) och varje version med livscykel | `rules:read`, `rules:write` för utkast, `rules:publish` för att publicera, skicka tillbaka och avveckla |

*Inte byggt än:* simulering av en regelversion mot sparade beslut, och formulär för tariffer, prisvillkor och teckningsregler.

## Toppraden och menyn

- **Toppraden** visar Petvold och Back office, ett sökfält, språkval, vem som är inloggad och Logga ut.
- **Sökfältet** öppnar en skada (`clm_…`), policy (`pol_…`), ansökan (`app_…`) eller ett meddelande (`ntc_…`) direkt. Allt annat söks bland policyerna: djur- eller part-id, personnummer och chipnummer. Ett personnummer hamnar aldrig i webbadressen.
- **Menyn** visar de avsnitt användaren har rätt till. Det valda avsnittet är svart med vit text. En räknare visar hur många som väntar i:
  - skadornas kö för beslut
  - ansökningar till manuell prövning
  - förslag
  - meddelanden som behöver en person
  - webhooks som inte kom fram

  Räknaren visar högst 100, och "100+" om det finns fler. Den uppdateras när man byter sida.

## Parter

Avsnittet Parter (rätten `parties:read`) gäller personer och organisationer (ADR 0026):

- **Hitta en part** med personnummer, organisationsnummer eller part-id. Ett nummer skickas i sökningens innehåll och hamnar aldrig i en adress. Ett `pty_`-id i sökfältet i toppraden öppnar parten direkt.
- **Registrera en part** (rätten `parties:write`): person eller organisation, marknad, namn, kontaktuppgifter, adress, språk och ett nummer om det finns. Appen säger vad som saknas innan något skickas, till exempel en adress som bara delvis är ifylld.
- **Partens sida:**
  - uppgifterna och numren, där personnummer visas maskade
  - policyerna där parten är försäkringstagare, för den som får läsa policyer
  - historiken med varje revision
- **Ändra uppgifterna** (rätten `parties:write`): formuläret börjar på de nuvarande uppgifterna och kräver ett skäl. Varje ändring blir en ny revision.
- **Lägg till ett nummer** (rätten `parties:write`).
- **Begär radering** (rätten `parties:privacy`) med ett skäl utan personuppgifter. En annan dataskyddsansvarig beslutar (ADR 0028).

En anonymiserad part kan inte ändras.

## Teckna och ändra policyer

- **Teckna försäkring** (rätten `policies:write`) går att starta på tre ställen:
  - **djurets sida**, med djur och ägare ifyllda
  - **kundens sida**, i kortet med kundens policyer, med kunden som försäkringstagare. Formuläret listar kundens levande djur att välja bland, och ett annat djur kan anges med id.
  - **sidan Policyer**, med ett tomt formulär

  Formuläret:
  - **ett djur som redan är försäkrat** på startdagen ger en rad med policyn och den dag en ny policy kan börja, så att `409` inte blir en överraskning
  - välj en produktversion som säljs för djurets art på startdagen, med årsbelopp, självrisk och kampanjkod
  - **prisindikation** från tariffen (`POST /v1/quotes`): grundpris, premie per år och för termen. En produkt utan tariff får premien för en term angiven för hand.
  - **kundens godkännande:** kanal, tid, referens och, för en produkt med dokument, vilka dokument kunden fick se. Villkor och förköpsinformation krävs (ADR 0031, 0032).
  - **en produkt med hälsofrågor** visar frågorna. Svaren skickas med en ansökan (`POST /v1/applications`), och ansökans sida öppnas: godkänd, godkänd med förbehåll, till manuell prövning eller avslag (ADR 0031). En fråga om diagnoser som besvaras med ja kräver diagnoskoderna. Prisindikationen visar vad svaren skulle ge.
- **På policyns sida** finns åtgärderna:
  - **Ändra valen** från i dag eller senare, med skäl
  - **Säg upp** med det skäl lagen känner till. Skälet avgör från när, och vissa skäl kräver dag eller anteckning.
  - **Ångra uppsägningen,** bara när den är policyns senaste transaktion
  - **Förnya för hand,** för en policy som förnyelsekörningen listat för beslut

## Radering

Avsnittet Radering (rätten `parties:privacy`) är kön för att anonymisera parter (ADR 0028). Menyn räknar begäranden som väntar.

- **Begäran** görs från partens sida, med ett skäl utan personuppgifter, eller av körningen för gallring.
- **Godkänna** (rätten `parties:erase`) anonymiserar parten för alltid. Den som begärde kan aldrig godkänna, utan ser "Någon annan måste godkänna din begäran".
- **Avslå** (rätten `parties:privacy`) när uppgifterna måste sparas, till exempel för en pågående skada (GDPR artikel 17.3). En begäran från personen själv kräver då ett datum som uppgifterna är begränsade till (artikel 18).

## Grupper

Partens sida visar kull- och hushållsgrupper där parten är försäkringstagare, och den som har rätten `policies:write` kan skapa en ny (ADR 0007). En kullgrupp pekar på kullen i djurregistret. Gruppens sida visar medlemmarna över tid och har två åtgärder:
- lägga till en policy från en dag. Gruppens försäkringstagare måste ha policyn, och en policy är med i en grupp i taget.
- avsluta ett medlemskap med skäl

## Djur

Avsnittet Djur (rätten `animals:read`) gäller djurregistret (ADR 0024, 0027):

- **Hitta ett djur** med chipnummer, registreringsnummer, pass, ägare (part-id) eller djur-id. Ett `ani_`-id i sökfältet i toppraden öppnar djuret direkt.
- **Registrera ett djur** (rätten `animals:write`): marknad, art, ras, kön, namn, födelsedatum, kastrerad, om kliniker får hitta det, chipnummer och ägare från en dag. Från partens sida är ägaren ifylld. Art, ras och kön väljs ur referensdatan på användarens språk.
- **Djurets sida** visar uppgifter, nummer, ägare över tid, policyer (för den som får läsa policyer), kullen det föddes i och historiken.
- **Rätta uppgifterna** med skäl, till exempel kastrerad, rättad ras eller dödsdatum. Art och marknad ändras aldrig.
- **Ägarbyte** till en annan part från en dag. Det nuvarande ägarskapet slutar den dagen, och en policy på djuret får ett förslag om överlåtelse. Ett dött djur byter inte ägare.
- **Lägg till ett nummer:** chipnummer, registreringsnummer eller pass.
- **Registrera en kull:** uppfödaren äger varje djur från födelsedagen, mor och far anges som djur-id, och varje djur får namn, kön, ras och chipnummer. Kullens sida länkar till djuren.

Partens sida visar också djuren parten äger i dag, med "Registrera djur".

## Körningar

Sidan Körningar (rätten `jobs:read`) visar Petvolds dagliga körningar och reläets döda poster. Den som har `jobs:operate` kan köra en körning nu, pausa och återuppta den, och skicka en död post igen. Se [Körningar](korningar.md).

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

## Registrera en skada

Den som har rätten `claims:register` kan registrera en skada, till exempel en som kunden skickat in på papper. Knappen "Registrera skada" finns i skadornas kö och på en policy. Från policyn är policyn redan ifylld.

1. **Policyn.** Ange policyns id och hämta den. Marknad, valuta och djur kommer från policyn och går inte att ändra i formuläret.
2. **Behandlingen.** Ange kanal (kund eller klinik), första och sista behandlingsdag och diagnoskod. Skadenumret ges av Petvold när skadan registreras.
3. **Fakturan.** En rad per post med beskrivning, kategori, belopp inklusive moms och, om fakturan anger det, momsen. Summan visas under raderna.
4. **Förhandsbedöm.** Skadan bedöms utan att sparas. Svaret visar förslaget, regler som kräver granskning eller inte är uppfyllda, och beräkningen steg för steg.
5. **Registrera skadan.** Knappen visar det fakturerade beloppet. Skadan bedöms igen och kan beslutas automatiskt direkt. Sedan öppnas ärendet.

Appen säger vad som saknas innan något skickas. Ett skadenummer som redan används ger ett besked från API:t.

## Stänga en skada utan beslut

En skada som inte har beslutats kan stängas i kortet "Stäng utan beslut" (ADR 0036):

- **Återkallad av kunden** (rätten `claims:register`). Kunden vill inte längre få skadan prövad.
- **Avvisa** (rätten `claims:decide`), med skälet dubblett, registrerad av misstag eller inte en skada. Vid dubblett anges den andra skadans id.

Båda kräver en motivering. Ett stängt ärende visar avslutet i stället för beslutskortet, och märket i huvudet är helfyllt. Skadornas kö har flikarna Återkallade och Avvisade.

## Bilagor

Kortet "Bilagor" under detaljerna listar ärendets bilagor (ADR 0036):
- typ, mediatyp, storlek, vem och när
- kontrollsumman
- länken "Öppna i arkivet", som går till bolagets arkiv. Arkivet avgör vem som får se filen.

En ersatt bilaga är överstruken och märkt "Ersatt". "Lägg till bilaga" öppnar formuläret: typ, adress i arkivet, kontrollsumma, mediatyp, storlek och valfritt vilken bilaga den ersätter. Filen måste först finnas i arkivet, eftersom Petvold inte tar emot filer än.

## Rätta en skada

Knappen "Rätta" i ärendets huvud öppnar samma formulär som för en ny skada, ifyllt med ärendet som det är nu (ADR 0036). Policyn går inte att ändra. Raderna behåller sina id:n, och en ny rad får ett id som ärendet inte har. Förhandsbedömningen visar vad den rättade skadan skulle ge. Ett skäl krävs.

Efter rättelsen visar huvudet "Revision 2". Historiken visar rättelsen med de ändrade uppgifterna och skälet, och vid ett beslut står revisionen det fattades på. Var det senaste beslutet en persons öppnas ärendet igen: läget blir "Väntar på beslut", en rad säger varför, och beslutskortet kommer tillbaka. Knappen visas inte för ett stängt ärende eller när ett förslag väntar på attest.

## Komplettering

Den som har rätten `claims:request-information` kan begära underlag som saknas (ADR 0036). Knappen "Begär komplettering" öppnar formuläret:

1. **Till:** kunden eller kliniken.
2. **Saknas:** specificerad faktura, journal, remiss eller annat. Minst en.
3. **Vad som saknas,** med egna ord.
4. **Svar senast** är valfritt. Lämnas det tomt gäller produktens skaderegler, normalt 30 dagar med påminnelse efter 14.

Ärendet får läget "Väntar på komplettering", och kortet för kompletteringen hamnar först i högerspalten. Beslutskortet visas inte förrän begäran är stängd. Kortet visar mottagaren, vad som saknas, svarsdatumet och påminnelsen. Där finns två knappar:
- **"Underlaget har kommit in"** (rätten `claims:register`). Ärendet går tillbaka till kön.
- **"Återkalla begäran"**, med en anteckning om varför.

Historiken visar meddelandena till kunden om ärendet, med typ och läge, och "Öppna" går till meddelandet. Det gäller skadebeskedet och meddelandena om komplettering. Under Inställningar kan meddelandet om utgång stängas av.

Går svarsdatumet ut utan svar står det i kortet att underlaget inte kom in. Kön visar då märket "Underlag saknas". Ett sent svar kan registreras ändå.

**Fristen i FAL 7 kap. 1 §:**
- Raden under rubriken visar när underlaget blev komplett, och för ett obeslutat ärende hur många av de 30 dagarna som är kvar.
- Efter 30 dagar blir märket helfyllt.
- Kön har kolumnen "Underlaget komplett", som går att sortera bland de ärenden som är hämtade.
- Ett beslut som fattats mer än 30 dagar efter att underlaget var komplett märks i historiken.

## Skadeärendet

- **Huvudet** har en brödsmula tillbaka till kön, skadenumret som rubrik och ärendets id. Klickar man på id:t kopieras det. Status är ett helfyllt märke när ärendet är beslutat och ett streckat när det väntar på någon.
- **En rad under rubriken** visar djuret, kunden, policyn (en länk) och hur och när skadan kom in. Djurets och kundens namn visas bara för den som får läsa djur och parter.
- **Två spalter.** Till vänster ligger underlaget: beräkningen, bedömningen regel för regel och detaljerna. Till höger ligger beslutet och historiken. Högerspalten följer med när man rullar. På smala skärmar hamnar den under underlaget.
- **Beräkningen** visas steg för steg, en rad per steg: det fakturerade beloppet, varje avdrag och ersättningen. Varje rad har en stapel som visar hur stor del av det fakturerade beloppet steget är. Avdragen är skrafferade och har en rad om regeln, till exempel "25 % av det som är kvar efter den fasta självrisken". Avdrag som är noll visas inte. Under stegen står hur mycket som är kvar av försäkringsbeloppet och vad kunden betalar.
- **Historiken** är svart och visar nyast först:
  - när skadan kom in
  - varje beslut, med "Varför?" som öppnar förklaringen
  - förslag som väntar på attest eller har skickats tillbaka
  - begäranden om prövning

  Det som väntar på någon har ett streckat märke. Varje rad visar också händelsens namn, till exempel `claim.decided`, så att handläggare och utvecklare ser samma sak.

## Besluta och attestera

Ärendet visar de åtgärder som användaren har rätt till just nu.

1. **Besluta.** Beslutskortet har en kraftigare ram än resten.
   - **Därför behövs en handläggare.** Kortet börjar med skälen till att ärendet inte reglerades automatiskt: vilken regel som kräver granskning eller inte är uppfylld, med regelns egen text, och om ersättningen är över produktens gräns för automatisk reglering.
   - **Två valkort,** Godkänn utbetalning och Avslå, med en rad om vad som händer. Förslaget från bedömningen är förvalt och märkt.
   - **Knappen säger vad som händer:** "Godkänn utbetalning · 12 165 kr" eller "Avslå ersättningen".
   - **Ett avslag kräver alltid en motivering.** Om man väljer det andra utfallet än förslaget kräver appen också en skälkod. Båda sparas med beslutet (ADR 0018).
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
2. **Ändra.** Formuläret används för produkter och skaderegler, men det går också att växla till JSON.
   - **En produkt:** marknad och valuta, namn per språk, arter, serierna för skaderegler, tariff, prisvillkor och teckningsregler, försäkringsbeloppen, självriskerna och inställningarna för policyer. En självrisk har kod, namn, fast belopp och hur ofta det tas ut, periodens längd, rörlig procent och högre procent efter ålder. Tomma inställningar får förvalet, som visas i grått. Produktens dokument redigeras i JSON.
   - **Skaderegler:** marknad, gränsen för automatiskt beslut, om moms ersätts, kategorier som aldrig ersätts, diagnosgrupper (en per rad, `kod = grupp`), och dagarna för komplettering.
   - **Tariffer, prisvillkor och teckningsregler** redigeras som JSON.
   - **Kontrollerna:** formuläret säger vad som är fel innan något skickas. Det som formuläret inte visar finns kvar när utkastet sparas. API:t kontrollerar innehållet mot kontraktet och produktens regler, och appen visar varje fält som är fel.
   - **En vald version** visar en sammanfattning, och innehållet som JSON går att fälla ut.
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
