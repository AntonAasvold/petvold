# Affärsprocesser och affärsregler

Här beskrivs Petvolds affärsprocesser, steg för steg, och reglerna som styr dem. Varje regel har ett id, till exempel `OBET-02`, så att den går att hänvisa till och söka efter. Varje regel anger också varifrån den kommer: en lag, ett beslut (ADR) eller en inställning.

Funktionssidorna beskriver hur funktionerna används och ställs in. Den här delen beskriver vad som händer och varför.

## Processerna

| Process | Från och till | Regler |
| --- | --- | --- |
| [Premie och faktura](premie-och-faktura.md) | En policy tecknas eller förnyas, och kunden får en faktura | `PREM` |
| [Inbetalning](inbetalning.md) | Pengar kommer in på bolagets konto och kopplas till en faktura | `BET` |
| [Obetald premie](obetald-premie.md) | En faktura betalas inte: påminnelse, uppsägning och avslut | `OBET` |
| [Kreditering och tillgodohavanden](kreditering-och-tillgodohavanden.md) | Premien sänks, en faktura krediteras eller skrivs av, och ett tillgodohavande används eller betalas tillbaka | `KRED` |
| [Utbetalning](utbetalning.md) | En ersättning eller en återbetalning betalas ut till kunden eller kliniken | `UTB` |
| [Bokföring](bokforing.md) | Varje händelse med pengar blir en verifikation, och varje dag stängs | `BOK` |

Teckning, policyns livscykel, skadereglering, meddelanden och personuppgifter beskrivs i [funktionssidorna](../funktion/README.md) tills de får egna sidor här.

## Hur processerna hänger ihop

```mermaid
flowchart LR
    T[Teckning] --> P[Premie och faktura]
    P --> B[Inbetalning]
    P --> O[Obetald premie]
    O -->|uppsägning| L[Policyns livscykel]
    L -->|ändring, avslut| K[Kreditering]
    K --> U[Utbetalning]
    S[Skadereglering] --> U
    B --> Bok[Bokföring]
    K --> Bok
    U --> Bok
```

## Läsa en regel

| Fält | Betyder |
| --- | --- |
| Id | Processens prefix och ett nummer. Ett id byts aldrig. En regel som tas bort behåller sitt id med anteckningen *upphävd*. |
| Regel | Vad som gäller, kort |
| Källa | Lagen, beslutet (ADR) eller inställningen regeln kommer från |
| Inställning | Om bolaget kan ändra den, och var |
