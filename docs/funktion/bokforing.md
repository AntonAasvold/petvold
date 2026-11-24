# Bokföring

Petvold bokför varje händelse som rör pengar som en verifikation med dubbel bokföring, för bolagets ekonomisystem (ADR 0040, punkt 9).

**Läge:** verifikationerna finns (steg 6a). Kontoplanen, som översätter till bolagets kontonummer, och dagsavslutet med CSV kommer i steg 6b.

## Verifikationerna

- **En verifikation per händelse**, med debet och kredit som går ihop.
- **Nummer** ur en obruten serie per marknad och år, till exempel `V-SE-2026-000123`.
- **Bokföringsdag:** fakturans dag, kreditnotans dag, inbetalningens bokföringsdag, eller marknadens dag för händelsen.
- **En hänvisning** till händelsen och till objektet: faktura, kreditnota, inbetalning, utbetalning, återbetalning eller skada.
- **Ändras aldrig.** En rättelse är en ny verifikation.
- **Samma händelse två gånger** ger en verifikation.

| Händelse | Debet | Kredit |
| --- | --- | --- |
| `invoice.issued` | Premiefordran (betalaren) | Premieintäkt, skatt på premie och delbetalningsavgifter, per rad med perioden |
| `invoice.credited`, kreditnota | Premieintäkt, skatt och avgifter, fördelat som på fakturaraden | Premiefordran |
| `invoice.credited`, avskrivning | Kundförluster | Premiefordran |
| `payment.succeeded` | Bank | Okopplade inbetalningar |
| `payment.matched` | Okopplade inbetalningar | Premiefordran (betalaren) |
| `refund.ordered` | Premiefordran (betalaren) | Återbetalningar att betala |
| `claim.payout_ordered` | Skadekostnad | Ersättningar att betala |
| `payout.paid`, ersättning | Ersättningar att betala | Bank |
| `payout.paid`, återbetalning | Återbetalningar att betala | Bank |

`invoice.paid`, `invoice.overdue` och `payout.failed` flyttar inga pengar och bokförs inte.

## Kontona

Petvold bokför på sina egna slag av konton. Kontoplanen i steg 6b översätter dem till bolagets kontonummer.

| Konto | Betyder |
| --- | --- |
| `bank` | Bolagets bankkonto |
| `premium-receivable` | Premie som betalarna är skyldiga, per betalarkonto (`payerAccountId`). Ett negativt saldo är betalarens tillgodohavande. |
| `premium-income` | Premieintäkt, med perioden premien gäller |
| `premium-tax` | Skatt på premie, om marknaden har den |
| `installment-fees` | Avgifter för delbetalning |
| `unmatched-payments` | Inbetalningar som ännu inte kopplats till en betalare |
| `customer-losses` | Avskriven premie |
| `claims-cost` | Beslutad ersättning |
| `claims-payable` | Beslutad ersättning som inte betalats ut |
| `refunds-payable` | Tillgodohavanden som ska betalas tillbaka och inte betalats ut |

- **Varje inbetalning går först till okopplade inbetalningar.** När `billing` kopplat den till en betalare, med referensen eller av en person, flyttas den till premiefordran. Saldot på okopplade inbetalningar är alltså alltid det som ligger i kön.
- **Tillgodohavanden** är ett negativt saldo på premiefordran per betalare. Bolaget kan flytta dem till skuld i sitt ekonomisystem vid periodens slut.
- **Periodisering** av premien, avsättningar och rapporter till tillsynen görs i bolagets ekonomisystem. Varje rad för premie bär perioden, `period.from` till `period.to` (exklusivt).

## Anrop

| Anrop | Vad det ger |
| --- | --- |
| `GET /v1/verifications?market=…&from=…&to=…&objectId=…` | Verifikationerna efter nummer, med bokföringsdag mellan `from` och `to` |
| `GET /v1/verifications/{id}` | En verifikation |
| `GET /v1/account-balances?market=…&from=…&to=…` | Debet, kredit och saldo per konto och valuta |

Alla kräver `accounting:read`, som rollen `accountant` har.

```
GET /v1/verifications?objectId=inv_7f3…

{ "items": [{
  "number": "V-SE-2026-000042", "bookingDate": "2026-11-21", "currency": "SEK",
  "text": "Invoice SE-2026-000017",
  "source": { "eventType": "invoice.issued", "objectType": "invoice", "objectId": "inv_7f3…" },
  "lines": [
    { "account": "premium-receivable", "debit": 40500, "credit": 0, "payerAccountId": "bac_…" },
    { "account": "premium-income", "debit": 0, "credit": 40000, "policyId": "pol_…", "period": { "from": "2026-12-01", "to": "2027-01-01" } },
    { "account": "installment-fees", "debit": 0, "credit": 500, "policyId": "pol_…", "period": { "from": "2026-12-01", "to": "2027-01-01" } }
  ]
}] }
```

## Kontroll

Ett test kör tre månader av demons testdata och stämmer av varje konto mot modulerna:

| Konto | Ska vara |
| --- | --- |
| `premium-receivable` | Det betalarna är skyldiga, minus deras tillgodohavanden (`billing`) |
| `unmatched-payments` | Kön med okopplade inbetalningar |
| `bank` | Det som kommit in, minus det som betalats ut (`payments`) |
| `claims-payable` och `refunds-payable` | Utbetalningar som inte är betalda än |
