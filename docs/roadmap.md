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
- [ ] Förklaring per beslut och begäran om mänsklig prövning
- [x] Integrationstester mot Postgres
- [ ] Behörighet (ADR 0016): rättigheter i kontraktet, omfång per marknad och klinik
- [ ] Reserv, beslutsförslag, beslut och attest som kedja, med beloppsgränser och fyraögonsprincip. Ett attesterat beslut ger en utbetalningsorder (händelse). Själva betalningen kommer med betalningsmodulen i M5.

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
- Utbetalning av ersättning från skademotorn.
- Billing: premieplaner, fakturor, påminnelser, tillgodohavande och utebliven betalning.
- Ledger för premier och betalningar.

**M6 – Stöd**: dokument, utskick med preferenser, ärenden, interaktionslogg, klinikintegration.

**Händelser utåt**: CloudEvents-kuvert och AsyncAPI när det finns en mottagare utanför Petvold (ADR 0008).

**M7 – Drift**: Kubernetes med CloudNativePG, observabilitet, säkerhetskopiering, DORA-anpassning.

## Öppna frågor

- Licens: stängd, källkod tillgänglig eller öppen källkod?
- Gemensamt försäkringsbelopp för en kull.
- Överlåtelseregler per marknad.
- Självriskperiod över förnyelse: konfigurerbart per produkt (`periodEndsAtRenewal`, standard är att perioden fortsätter). Kvar: perioden ska bara fortsätta så länge skyddet är oavbrutet, inte över avslut, uppehåll eller ny ägare.
- Retroaktivt avslut när ersättning redan är betald för tiden efter avslutet: återkrav, avräkning mot premieåterbetalning eller avskrivning?
- Premieåterbetalning vid avslut: per dag eller enligt produktens regel, och vid ånger?
- Moln och klientlager.
