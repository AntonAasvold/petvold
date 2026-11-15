# ADR om teckningsregler och ansökan (PR #64)

**Datum:** 2026-11-15 **ADR:** 0031 (Beslutad) **Moduler:** inga, bara dokumentation

## Vad

Ett förslag till hur Petvold prövar ansökningar och sparar kundens godkännande (granskningen F1 och F3). Ingen kod.

## Hur det ska fungera

- **Teckningsreglerna är data i `decisioning`,** som tariffen. Produktversionen pekar på en serie (`underwritingSeries`). Reglerna som gäller på ansökningsdagen används.
- **En ren funktion i `underwriting-core`** prövar art, ras, ålder på startdagen och svaren på hälsofrågorna. Den ger godkänd, godkänd med förbehåll, manuell prövning eller avslag med skälskod, och redovisar varje regel.
- **Ansökan sparas i policymodulen** med underlaget, så att det går att visa vilka frågor som ställdes och vad som svarades. En godkänd ansökan tecknar policyn i samma transaktion. En ansökan till manuell prövning hamnar i en kö för `policies:underwrite`.
- **Godkännandet** (kanal, referens och tid) sparas vid varje tecknande, som vid överlåtelse.

## Val och avvägningar

- **Ansökan sparas, i stället för `422` och ett nytt anrop som vid manuellt pris.** Ett avslag ska kunna styrkas och ge ett brev med skäl (FAL 7 kap. 6 §). Manuell prövning behöver en kö.
- **Reglerna på ansökningsdagen, inte på startdagen** som tariffen. Frågorna ställs när kunden ansöker.
- **Fasta regeltyper i stället för ett regelspråk.** De är lättare att granska med fyra ögon och att förklara för kunden.
- **Åldersgränser bara för nya försäkringar.** Förnyelsen prövas inte på nytt.

## Att känna till

- `POST /v1/policies` finns kvar för produkter utan teckningsregler och kräver `acceptance`.
- Brevet vid avslag och förköpsinformationen hör till F2.
- Frågor som beror på varandra och förbehåll efter tecknandet ingår inte.

## Filer

- `docs/adr/0031-teckningsregler-och-ansokan.md`
