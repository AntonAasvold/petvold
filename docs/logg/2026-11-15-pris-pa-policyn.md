# Priset på policyn (PR #58)

**Datum:** 2026-11-15 **ADR:** 0030 **Moduler:** `policies`, `pricing-core`, `api`

## Vad

För en produkt med tariff räknar Petvold premien vid tecknande, ändring och förnyelse. Underlaget sparas på termen. Ett manuellt pris kräver en egen rättighet och en motivering.

## Hur det fungerar

1. **`PolicyService.priceFor(offer, …)`** hämtar tariffen och prisvillkoren via `TariffPort` och anropar `price`. Den sparar indata utan postnummer men med zonen (`TermPricing.input`). En produkt utan tariff ger `null`.
2. **`premiumFor(pricing, given, override, rights, by, currency)`** väljer premien:
   - Utan tariff krävs en premie från anroparen.
   - Utan given premie, eller med samma premie som tariffens, gäller tariffens.
   - En annan premie kräver `rights.mayOverridePrice` (annars `forbidden`, alltså `403`) och en motivering. Då sparas `override.computedPremium`.
3. **Tecknande.** Djuret kommer från djurregistret och postnumret från `PartyPort.postalCodeOf`. Med `groupId` räknas platsen i gruppen ut och policyn går med i gruppen efteråt. Kampanjkoden gäller som ny policy.
4. **Ändring.** Hela termen prissätts med de nya valen och djurets ålder vid termens början. Platsen i gruppen kommer från `placeInGroup`. Kampanjer gäller inte.
5. **Förnyelse.** `planRenewal` prissätter den nya termen med gällande tariff och djurets nya ålder, som `newPolicy: false`. Om priset inte går att räkna ger körningen `price-not-available`.
6. **API-lagret** sätter `CallerRights` från `policies:price-override`. Rollen `underwriter` har den.

## Val och avvägningar

- **En premie som är lika med tariffens behöver ingen motivering.** En kanal som visar priset från prisindikationen och skickar med det ska inte stoppas.
- **Postnumret hämtas vid varje prissättning.** Om kunden flyttar får förnyelsen den nya zonen. Det gamla postnumret sparas aldrig.
- **Tecknandet går med i gruppen efter att policyn har sparats**, med samma kontroller som `addMember`. Det är två steg och inte en transaktion. Om det andra steget misslyckas finns policyn utan grupp och med grupprabatt. Felet syns i svaret och kan rättas genom att lägga till policyn i gruppen.
- **Kontraktets testprodukt har tariff.** API-testerna låter tariffen räkna Rex premie (2 052 kr) i stället för att ange 4 800 kr.

## Att känna till

- **Provisioner till säljare och ombud finns inte än.** De är en ny punkt i M5 och behöver en ADR: vem som sålde policyn, provisionsavtal, återtag vid avslut och krav på information enligt lagen om försäkringsdistribution.
- **Simulering av tariffer mot sparade priser** är nästa steg.
- **Bellas policy i dev-servern saknar underlag**, eftersom den lades in före tariffen.

## Filer

- `modules/policies/src/index.ts` (`priceFor`, `premiumFor`, `placeInGroup`, `TermPricing`, `CallerRights`), `modules/policies/src/postgres.ts`
- `modules/pricing-core/src/index.ts` (`zone` som indata)
- `db/migrations/0028_policies_pricing.sql`
- `modules/api/src/app.ts`, `modules/api/src/permissions.ts`, `modules/api/openapi.yaml`
- `modules/policies/test/policy-service.test.ts`, `modules/policies/test-suites/policy-store.ts`, `modules/api/test/policies.test.ts`
