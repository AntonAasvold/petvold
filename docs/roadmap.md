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
- [ ] `ClaimsStore` mot Postgres med outbox i samma transaktion
- [ ] Teststrategi lager 3–6: scenarier som data, gemensam svit för `ClaimsStore`, databastester (ADR 0012)
- [ ] Integrationstester mot Postgres
- [ ] AsyncAPI för `claim.registered` och `claim.decided`
- [ ] Reserv, beslutsförslag, beslut, attest och betalning som kedja

**M1b – Skademotorn klarar referensprodukten** ([kravunderlag](referensprodukt-hund.md))
- [ ] ADR: konton på gruppnivå, skadans startdatum, försäkringshistorik per djur, ersättningstyper
- [ ] Startdatum på skadan och uppslag av täckning på det (RP-37, RP-12)
- [ ] Delbelopp per år och kategori, och räknare över livstid (RP-32, RP-33)
- [ ] Självrisk per moment, befrielse efter orsak och rabatt (RP-34–36)
- [ ] Villkor som kräver obruten försäkring sedan viss ålder (RP-20, RP-21)
- [ ] Utredning fram till diagnos och automatiskt förbehåll som händelse (RP-14)
- [ ] Fast ersättning för liv och användbarhet (RP-50–55)
- [ ] Dolda fel med samordning mot köparens försäkring (RP-62, RP-63)
- [ ] Gemensamt belopp och självrisk för flock (RP-65)
- [ ] Referensprodukten som scenarier enligt teststrategin

## Nästa

**M2 – Produkt och djur**
- [ ] Produktkatalog: versionerade produktpaket, regler, referensdata (arter, raser, rasgrupper med blandraser, kön) med översättningar
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
- ~~Gemensamt försäkringsbelopp för en kull.~~ Behövs, se flock i [referensprodukten](referensprodukt-hund.md) (RP-65).
- Överlåtelseregler per marknad.
- Moln och klientlager.
