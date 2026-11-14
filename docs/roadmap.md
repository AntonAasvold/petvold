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
- [ ] Beviskedja per beslut (ADR 0018): underlag och motorns version sparas med beslutet
- [ ] Motivering krävs när beslutet avviker från förslaget
- [ ] Omräkning av sparade beslut, och scenarier som data (lager 3) som räknas om i CI
- [ ] Förklaring per beslut och begäran om mänsklig prövning
- [x] Integrationstester mot Postgres
- [ ] AsyncAPI för `claim.registered` och `claim.decided`
- [ ] Reserv, beslutsförslag, beslut, attest och betalning som kedja

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

**M4 – Pris och teckning**
- [ ] Tariff som rena funktioner per produktversion
- [ ] Prisindikation utan sparat tillstånd
- [ ] Teckningsregler och manuell prövning
- [ ] Rabatter som regler

## Senare

**M5 – Pengar**: Billing, betalningar, ledger för premier, tillgodohavande, utebliven betalning.

**M6 – Stöd**: dokument, utskick med preferenser, ärenden, interaktionslogg, klinikintegration.

**M7 – Drift**: Kubernetes med CloudNativePG, observabilitet, säkerhetskopiering, DORA-anpassning.

## Öppna frågor

- Licens: stängd, källkod tillgänglig eller öppen källkod?
- Gemensamt försäkringsbelopp för en kull.
- Överlåtelseregler per marknad.
- Moln och klientlager.
