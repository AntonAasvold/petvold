# Roadmap

Mål: kunna teckna en hundförsäkring och reglera en skada från början till slut, i en marknad, med alla delar i Petvold. Sedan katt, häst och en EUR-marknad.

## Nu

**M0 – Grund**
- [x] Skademotorn med kontrakt, tester och Postgres-schema
- [x] Arbetssätt, roadmap, ADR och CI
- [x] Gemensam kärna i kod: `Money`, `Market`, `DateRange` (`modules/common`)
- [ ] Gemensamma kontraktsdelar: `Money`, `Ref`, problem+json, sidindelning
- [x] Lokal miljö med Postgres (docker compose), dbmate och databastester i CI

**M1 – Skademotorn på riktig lagring**
- [x] `ClaimsStore` mot Postgres (klarar den gemensamma sviten)
- [x] Outbox i samma transaktion som ärendet och beslutet, med relä
- [x] Dev-servern på Postgres
- [x] Gemensam testsvit för `ClaimsStore` (lager 4) och databastester (lager 6)
- [x] Beviskedja per beslut (ADR 0018): underlag och motorns version sparas med beslutet
- [x] Motivering krävs när beslutet avviker från förslaget
- [x] Omräkning av sparade beslut, och scenarier som data (lager 3) som räknas om i CI
- [x] Förklaring per beslut och begäran om mänsklig prövning
- [x] Integrationstester mot Postgres
- [x] Behörighet (ADR 0016): rättigheter i kontraktet, omfång per marknad och klinik
- [x] Beslutsförslag, beslut och attest som kedja, med beloppsgränser och fyraögonsprincip (ADR 0019). Ett beslut som höjer ersättningen ger en utbetalningsorder (händelse). Själva betalningen kommer med betalningsmodulen i M5.
- [ ] Reserv: bokas i ledgern när ärendet går till handläggare och löses upp när beslutet bokas.
- [ ] Gränser och roller som konfiguration per installation, ändringsbara via API med historik

## Nästa

**M2 – Produkt och djur**
- [ ] Produktkatalog: versionerade produktpaket, regler, referensdata (arter, raser, kön) med översättningar
- [ ] Beslutsmotorn `decisioning` (ADR 0018): regeluppsättningar i databasen, publicering med fyra ögon, kontrollsumma i beviskedjan och simulering av regelutkast
- [ ] Djurregister: djur, kullar, ägarskap med giltighetstid
- [ ] Part: person, organisation, roller

**M3 – Policy**
- [ ] Bitemporala versioner, term, transaktionslivscykel
- [ ] Ändring, reversering och ändring i fel ordning
- [ ] PolicyGroup och överlåtelse
- [ ] ADR om policyns livscykel: tecknande, ändring, förnyelse, avslut och överlåtelse, med legala ramar per marknad (försäkringsavtalslagen, regler för distansavtal) och källor
- [ ] Förnyelse:
  - förnyelsekörning före förfallodagen
  - ny term med vald produktversion
  - nytt pris och prövning (åldersgränser, nya undantag)
  - avisering till kunden
  - händelse `policy.renewed`
- [ ] Avslut:
  - kundens uppsägning
  - ånger inom ångerfristen
  - bolagets uppsägning vid utebliven betalning
  - djuret dött eller sålt
  - avslutsdatum bakåt i tiden (bitemporalt)
  - reversering av avslut
  - händelse `policy.cancelled`
  - produktinställning för avslut under avtalstiden: tillåtet när som helst eller bara till förfallodagen (avtalet löper ut), uppsägningstid och premieåterbetalning
  - avslut som alltid är tillåtna oavsett inställning, per marknad: ånger inom ångerfristen (distansavtal) och när försäkringsbehovet faller bort, till exempel när djuret dör eller säljs. Petvold validerar att en produkt inte stänger dem.
- [ ] Skademotorn vid förnyelse och avslut: omprövning av skador efter ett retroaktivt avslut, och självriskperiod och försäkringsbelopp över termgränsen

**M4 – Pris och teckning**
- [ ] Tariff som rena funktioner per produktversion
- [ ] Prisindikation utan sparat tillstånd
- [ ] Teckningsregler och manuell prövning
- [ ] Rabatter som regler

## Senare

**M5 – Pengar**
- Premieåterbetalning vid avslut och ny premieplan vid förnyelse.
- Betalningsmodul (ADR 0017): porten `PaymentProvider`, tillståndsmaskin, fake-adapter och gemensam testsvit.
- Betalintegrationer, en adapter per tjänst:
  - Stripe (kort, sparat kort)
  - Swish (betalning och utbetalning)
  - Open banking (PSD2, betalningsinitiering)
  - Autogiro (Bankgirot)
  - SEPA Direct Debit
  - Bankfil ISO 20022 (`pain.001`, `camt.054`)
- Utbetalning av ersättning från skademotorn. Obetald, förfallen premie kvittas först om villkoren tillåter det, och kvittningen syns i utbetalningsordern och i förklaringen till kunden.
- Billing: premieplaner, fakturor, påminnelser, tillgodohavande och utebliven betalning.
- Ledger för premier och betalningar, med bokföringsperioder som skärs på bokföringsdatum och dagsavslut. En stängd period ändras aldrig: en rättelse bokas i en öppen period.

**M6 – Stöd**: dokument, utskick med preferenser, ärenden, interaktionslogg, klinikintegration.

**Händelser utåt**: CloudEvents-kuvert och AsyncAPI när det finns en mottagare utanför Petvold (ADR 0008). Varje händelse bär ärendets id och ett spårnings-id (W3C Trace Context), så att allt som hänt i ett ärende kan följas över moduler.

**Insikt – läsmodell för portföljen**: en egen modul som bara läser händelser och kan byggas om genom att spela upp dem. Den visar till exempel automatiseringsgrad, andel avvikelser, tid till utbetalning och prövningar. Belopp läses ur ledgern, och modulen håller inga egna. Kärnan ändras inte.

**M7 – Drift**: Kubernetes med CloudNativePG, observabilitet, säkerhetskopiering, DORA-anpassning. Volymprov med genererade portföljer (tusentals försäkringar och skador) mot Postgres, med mål för svarstid och genomströmning.

## Öppna frågor

- Kvittning av premie mot ersättning: när villkor och lag tillåter det per marknad, och om kunden ska kunna välja bort det. Utreds med källor i ADR:n för utbetalning.

- Licens: stängd, källkod tillgänglig eller öppen källkod?
- Gemensamt försäkringsbelopp för en kull.
- Överlåtelseregler per marknad.
- Självriskperiod över förnyelse: konfigurerbart per produkt (`periodEndsAtRenewal`, standard är att perioden fortsätter). Kvar: perioden ska bara fortsätta så länge skyddet är oavbrutet, inte över avslut, uppehåll eller ny ägare.
- Retroaktivt avslut när ersättning redan är betald för tiden efter avslutet: återkrav, avräkning mot premieåterbetalning eller avskrivning?
- Premieåterbetalning vid avslut: per dag eller enligt produktens regel, och vid ånger?
- Moln och klientlager.

## Källor för punkter som lagts till 2026-11-14

Punkterna om kvittning, bokföringsperioder, spårnings-id, läsmodell och volymprov är allmän praxis. De bygger på publika källor och inte på något annat systems material (ADR 0009).

- Bokföringslag (1999:1078): löpande bokföring, verifikationer och att bokförda uppgifter inte får ändras utan att ändringen dokumenteras.
- W3C Trace Context (W3C Recommendation). w3.org/TR/trace-context
- CloudEvents 1.0, tillägget *Distributed Tracing*. github.com/cloudevents/spec
- Martin Fowler: *CQRS* (2011) och *Event Sourcing* (2005). martinfowler.com
- Kvittning: allmänna civilrättsliga regler och försäkringsvillkoren. Exakta lagrum per marknad fastställs i ADR:n innan det byggs.
