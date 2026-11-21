# 0017. Betalningar via en port med en adapter per betaltjänst

- Status: Beslutad (2026-11-21, med ADR 0040)
- Datum: 2026-11-14

## Sammanhang

Petvold behöver flytta pengar åt två håll:

- **In:** premier från kunder, både som engångsbetalning när försäkringen tecknas och som återkommande dragning.
- **Ut:** ersättningar för skador till kunder eller direkt till kliniker, och återbetalningar av premie.

Varje marknad och varje försäkringsbolag använder olika betaltjänster:

| Typ | Exempel | Används till |
| --- | --- | --- |
| Kort | Stripe | Engångsbetalning, sparat kort för återkommande dragning |
| Mobil betalning | Swish (Sverige) | Engångsbetalning, utbetalning till privatperson |
| Open banking (PSD2) | Betalningsinitiering via en aggregator, eller direkt mot bankens API (Berlin Group NextGenPSD2) | Engångsbetalning från konto |
| Autogiro och direktdebitering | Bankgirots Autogiro (Sverige), SEPA Direct Debit (EUR) | Återkommande dragning med medgivande |
| Bankfil | ISO 20022 `pain.001` ut, `camt.054` tillbaka | Utbetalningar i större mängd, avstämning |

Ett försäkringsbolag har ofta redan avtal med några av dessa. Petvold måste kunna använda dem utan att domänen (billing, skador) vet vilken tjänst som används.

Billing och betalningar är två olika saker:
- **Billing** vet *vad som är skuldsatt*: premieplaner, fakturor, tillgodohavanden, påminnelser. Den beror på policy och pris (M3–M4).
- **Betalningar** vet *hur pengar flyttas*: initiera, följa status, ta emot bekräftelser, återbetala och betala ut. Den behövs redan i M1 för att betala ut ersättningar.

## Beslut

**1. En egen modul `payments`**, separat från billing och skador. Den äger betalningar, medgivanden och utbetalningar med sin historik, i ett eget schema `payments`. Andra moduler beställer via dess API eller tjänst och får veta resultatet via händelser (`payment.succeeded`, `payment.failed`, `payout.paid`, …) från outboxen (ADR 0008).

**2. En port, `PaymentProvider`, och en adapter per betaltjänst.** Porten beskrivs efter förmåga, inte efter tjänst:

```ts
interface PaymentProvider {
  readonly id: string;                         // 'stripe', 'swish', 'autogiro', 'fake' …
  capabilities(): ProviderCapability[];        // vad den kan, per marknad, valuta och metod

  collect(req: CollectRequest): Promise<ProviderResult>;             // engångsbetalning
  createMandate?(req: MandateRequest): Promise<ProviderResult>;      // medgivande för återkommande dragning
  collectWithMandate?(req: MandateCollectRequest): Promise<ProviderResult>;
  payout?(req: PayoutRequest): Promise<ProviderResult>;              // utbetalning
  refund?(req: RefundRequest): Promise<ProviderResult>;

  getStatus(ref: ProviderRef): Promise<ProviderStatus>;              // avstämning om en avisering uteblir
  parseNotification(raw: RawNotification): Promise<ProviderNotification>; // verifierad och översatt webhook/callback
}
```

- **`ProviderResult`** är antingen *klar*, *pågår* eller *kräver åtgärd av betalaren*. Åtgärden kan vara en adress att skicka betalaren till, en token eller QR-kod för Swish, eller ett medgivande som ska signeras. Petvold visar inga betalsidor själv.
- **`parseNotification`** verifierar signatur eller certifikat och översätter tjänstens avisering till en gemensam form. Ingen annan del av Petvold läser tjänstens format.
- **Belopp** in och ut ur porten är heltal i minsta enhet med valuta (ADR 0014). Adaptern översätter till tjänstens format, till exempel decimalsträng.

**3. Petvolds egen tillståndsmaskin.** En betalning går `created → pending → (requires_action) → succeeded | failed | cancelled`, och kan sedan återbetalas helt eller delvis. Tjänstens status översätts till den. Aviseringar kan komma dubbelt eller i fel ordning, så ett slutläge ändras aldrig av en senare avisering.

**4. Idempotens hela vägen.** Petvolds id för betalningen skickas som idempotensnyckel eller referens till tjänsten, så att ett omförsök aldrig drar pengar två gånger.

**5. Val av tjänst är konfiguration per installation** (ADR 0010): för varje marknad, syfte (premie, ersättning, återbetalning) och metod anges vilken adapter som används. Konfigurationen valideras vid start mot adaptrarnas `capabilities()`.

**6. Inga kortuppgifter i Petvold.** Kort hanteras bara via tjänstens egna betalsidor eller fält, så att Petvold hålls utanför kraven för den som lagrar kortdata (PCI DSS). Hemligheter, certifikat och nycklar ligger i installationens hemlighetshantering, aldrig i databasen.

**7. En gemensam testsvit för adaptrar**, som `claimsStoreSuite` (ADR 0012). En adapter är klar när den klarar sviten mot tjänstens testmiljö, till exempel Stripes testläge eller Swish testmiljö. En `fake`-adapter klarar samma svit och används i tester och i dev-servern.

**8. Omförsök och avstämning** körs som jobb: `getStatus` för betalningar som stått i *pågår* för länge, nya dragningar och bankfiler. Jobben körs i Postgres (pg-boss eller en egen tabell), utan någon ny tjänst. Det beslutas i en egen ADR när det första jobbet behövs.

## Konsekvenser

- Billing, skador och kundgränssnitt ser bara Petvolds betalningar, aldrig tjänstens.
- En ny betaltjänst är en ny adapter som klarar sviten. Domänen ändras inte.
- Varje adapter måste översätta tjänstens status till tillståndsmaskinen. Det är där felen kommer att finnas, så sviten och testmiljöerna är viktiga.
- Webhooks kräver att installationen kan ta emot anrop utifrån. Lokalt används `fake`-adaptern eller en tunnel.
- Utbetalning av ersättning blir det första användningsfallet: beslut → reserv → attest → `payout`.
- Bokföring av betalningar (kundreskontra, bankkonto) hör till ledgern i M5. Betalningsmodulen skickar händelser, och ledgern bokför.

**Tidplan:** betalintegrationerna väntar till M5 (beslut 2026-11-14). I M1 slutar skadekedjan med att ett attesterat beslut ger en utbetalningsorder som händelse. Betalningsmodulen tar emot den när den finns.

**Införs i steg:**
1. Kontrakt för betalnings-API:t, porten, tillståndsmaskinen och `fake`-adaptern med den gemensamma sviten.
2. Schema `payments`, lagring och outbox.
3. Den första riktiga adaptern.
4. Utbetalning av ersättning från skademotorn.
5. Fler adaptrar efter behov.

## Alternativ

- **En betaltjänst för allt (till exempel bara Stripe):** enklast, men försäkringsbolag har egna avtal, och Autogiro och Swish är nödvändiga i Sverige.
- **En betalningsaggregator som enda adapter:** färre integrationer, men en extra mellanhand och avgift, och en del bolag vill ha direktavtal. En aggregator kan vara en adapter bland andra.
- **Port per tjänst i stället för per förmåga:** domänen skulle behöva känna till Swish och Stripe. Det motsäger syftet.
- **Billing och betalningar i samma modul:** utbetalning av skador skulle bero på billing, som inte finns förrän M5.

## Öppna frågor för beslut

Besvarade i ADR 0040 (2026-11-21): ersättningen går till kunden, eller till kliniken vid avtal om direktreglering. Bankfiler är första adaptern, sedan Stripe eller Surfboard, Autogiro via Bankgirots filer och Swish.


- Vilken adapter först: Stripe (bäst testmiljö), Swish (Sverige) eller open banking via en aggregator?
- Ersättning till klinik eller kund, eller båda?
- Ska Autogiro gå via bankfil direkt mot Bankgirot eller via en tjänsteleverantör?

## Källor

- Stripe API Reference: *Payment Intents*, *Setup Intents*, *Refunds*, *Idempotent requests*, *Webhooks* (signaturer). docs.stripe.com/api
- Swish för handel, teknisk integrationsguide (betalningsbegäran, återbetalning, callback, certifikat), och Swish Utbetalning. developer.swish.nu
- Europaparlamentets och rådets direktiv (EU) 2015/2366 (PSD2), betalningsinitiering. eur-lex.europa.eu
- The Berlin Group, *NextGenPSD2 Access to Account Framework*. berlin-group.org
- Bankgirot, *Autogiro* (medgivanden och dragningar). bankgirot.se
- European Payments Council, *SEPA Direct Debit Core Rulebook*. europeanpaymentscouncil.eu
- ISO 20022, meddelanden `pain.001` (betalningsuppdrag) och `camt.054` (avisering). iso20022.org
- PCI Security Standards Council, *PCI DSS* och självskattning SAQ A. pcisecuritystandards.org
