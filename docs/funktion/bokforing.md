# Bokföring

Petvold bokför varje händelse som rör pengar som en verifikation med dubbel bokföring, för bolagets ekonomisystem (ADR 0040, punkt 9).

**Läge:** verifikationerna (steg 6a), kontoplanen och dagsavslutet med CSV (steg 6b) finns. SIE 4 och perioder som stängs för hand kommer när en installation behöver dem.

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

Petvold bokför på sina egna slag av konton. [Kontoplanen](#kontoplanen) översätter dem till bolagets kontonummer i dagsavslutets fil.

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

## Dagsavslutet

Körningen `accounting.day-close` stänger varje dag före i dag, klockan 06:00 i marknaden ([Körningar](korningar.md)). Dagarna stängs i ordning, från dagen efter den senast stängda, och ingen dag hoppas över, också när den inte har några verifikationer. Den första stängningen börjar vid den tidigaste bokföringsdagen, också när en verifikation för en tidigare dag kom in efter dagens första.

- **En stängd dag ändras aldrig.** En verifikation för en dag som redan är stängd bokförs på första öppna dag, och dess egen dag sparas som `eventDate`. Det händer till exempel när en inbetalning med gårdagens bokföringsdag kommer in efter klockan 06:00.
- **Stängningen sparar** antalet verifikationer, debet och kredit per valuta, vilken version av kontoplanen filen använder, vilka kontoslag som saknar kontonummer i den, och filens kontrollsumma (SHA-256).
- **Händelsen `accounting.day_closed`** går till webhooks, med dagen som `subject`.
- **Filen** görs av dagens verifikationer och kontoplanen som gällde vid stängningen. Varje gång kontrolleras den mot kontrollsumman, så den blir alltid densamma.

```
GET /v1/day-closes/SE/2026-12-01/file
content-type: text/csv; charset=utf-8
x-content-sha256: 4f1c…

verification,booking_date,event_date,account,account_name,petvold_account,debit,credit,currency,text,payer_account,policy,claim,period_from,period_to,object_type,object_id,event_id
V-SE-2026-000042,2026-12-01,2026-12-01,1510,Kundfordringar,premium-receivable,405.00,,SEK,Invoice SE-2026-000017,bac_…,,,,,invoice,inv_…,bev_…
V-SE-2026-000042,2026-12-01,2026-12-01,3010,Premieintäkt,premium-income,,400.00,SEK,Invoice SE-2026-000017,,pol_…,,2026-12-01,2027-01-01,invoice,inv_…,bev_…
```

En rad per verifikationsrad, med komma och UTF-8 (RFC 4180). Beloppen är decimaltal med punkt. Ett kontoslag utan kontonummer har slagets namn i kolumnen `account`.

## Kontoplanen

Kontoplanen översätter Petvolds kontoslag till bolagets kontonummer, per marknad. Den är en inställning med versioner (ADR 0020). En ny version gäller för dagar som stängs från då, och en stängd dag behåller den version den stängdes med.

```
POST /v1/settings/chart-of-accounts/versions
{
  "basedOnVersion": 0,
  "reason": "Bolagets kontoplan",
  "markets": { "SE": {
    "bank": { "number": "1930", "name": "Bank" },
    "premium-receivable": { "number": "1510", "name": "Kundfordringar" },
    "premium-income": { "number": "3010", "name": "Premieintäkt" },
    "unmatched-payments": { "number": "2990", "name": "Okopplade inbetalningar" }
  } }
}
```

Kontonumren ovan är bara ett exempel. Bolagets egna kommer från dess ekonomisystem.

## Anrop

| Anrop | Vad det ger |
| --- | --- |
| `GET /v1/verifications?market=…&from=…&to=…&objectId=…` | Verifikationerna efter nummer, med bokföringsdag mellan `from` och `to` |
| `GET /v1/verifications/{id}` | En verifikation |
| `GET /v1/account-balances?market=…&from=…&to=…` | Debet, kredit och saldo per konto och valuta |
| `GET /v1/day-closes?market=…&from=…&to=…` | De stängda dagarna |
| `GET /v1/day-closes/{market}/{day}/file` | En stängd dags verifikationer som CSV |
| `GET /v1/settings/chart-of-accounts` och `.../versions` | Kontoplanen och dess versioner |
| `POST /v1/settings/chart-of-accounts/versions` | En ny version av kontoplanen (`accounting:configure`) |

Läsningen kräver `accounting:read`. Rollen `accountant` har den och `accounting:configure`.

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
