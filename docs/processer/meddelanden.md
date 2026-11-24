# Meddelanden till kunden

Lagen kräver att kunden får vissa besked i tid. Petvold avgör vilka besked som krävs, till vem, när de senast ska skickas och vad de ska innehålla. Bolagets dokumentsystem, eller Petvold om bolaget vill, gör dokumentet och skickar det.

**Roller:** modulerna skriver händelser. `notices` gör meddelanden av dem. Dokumentsystemet (`document-service`) skickar och rapporterar. Kommunikationsansvarig (`communications-manager`) ställer in texterna.

## Flödet

1. **Något händer,** till exempel att en policy tecknas eller en skada beslutas.
2. **Ett meddelande skapas** med typ, mottagare, språk, innehåll som fält, lagrum och sista dag.
3. **Dokumentsystemet hämtar det** eller får `notice.created`, gör dokumentet och skickar det.
4. **Utskicket rapporteras**, som skickat med dokumentets id och kontrollsumma, eller som misslyckat.
5. **Det som fastnar** visas för en person: misslyckat, inte skickat i tid eller ofullständigt.

## Regler

| Id | Regel | Källa | Inställning |
| --- | --- | --- | --- |
| MEDD-01 | Kunden får ett försäkringsbrev när en policy tecknas, senast tre dagar efter. | FAL 2 kap. 4 §, distansavtalslagen 3 kap. 11 § | `promptlyDays` |
| MEDD-02 | Kunden får ett förnyelsebesked senast den nya termens första dag. | FAL 2 kap. 5–6 §§, 3 kap. 5 § | – |
| MEDD-03 | Bolagets uppsägning skickas senast den dag bolaget anger att den skickades. Vid obetald premie står det att uppsägningen inte gäller om premien betalas före en viss dag. | FAL 3 kap. 3 och 7 §§, 5 kap. 2 § | – |
| MEDD-04 | En avslagen ansökan ger ett besked med skälen och hur beslutet prövas, senast tre dagar efter. | FAL 7 kap. 6 § | Bolagets text `review` |
| MEDD-05 | Varje skadebeslut ger ett skadebesked med utfall, belopp, huvudskäl och beräkningen. För ett automatiskt beslut står det att en person kan pröva det. | FAL 7 kap. 1 §, GDPR artikel 22.3 | Bolagets text `review` |
| MEDD-06 | En faktura skickas på fakturans dag, eftersom tiden att betala räknas från den dag den skickades. | FAL 5 kap. 1 § | Bolagets text `payment` |
| MEDD-07 | "Snarast" är tre dagar om bolaget inte valt annat, mellan 1 och 30. | ADR 0032 | Marknadens `promptlyDays` |
| MEDD-08 | Typer som lagen inte kräver kan stängas av: bekräftelse av kundens uppsägning, erbjudande till ny ägare, utgången begäran om komplettering och påminnelse om betalning. En typ som lagen kräver kan inte stängas av. | ADR 0032 | `disabledTypes` |
| MEDD-09 | Mottagaren är försäkringstagaren den dag beskedet gäller. Vid ett avslag är det den sökande, vid ett erbjudande den nya ägaren och för en skada försäkringstagaren på första behandlingsdagen. | ADR 0032 | – |
| MEDD-10 | Språket är partens, annars marknadens. | ADR 0032 | Partens `language` |
| MEDD-11 | Samma händelse ger aldrig två meddelanden av samma typ. | ADR 0008, ADR 0032 | – |
| MEDD-12 | Innehållet är fält med ett versionerat schema, och partens och djurets id, aldrig namn eller adress. | ADR 0032 | – |
| MEDD-13 | Saknas en text som lagen kräver blir meddelandet ofullständigt och hamnar hos en person. | FAL 7 kap. 6 §, ADR 0032 | Bolagets texter |
| MEDD-14 | En rapport om ett utskick ändras aldrig. Ett nytt försök är en ny rapport. Skälet till ett misslyckande får inte innehålla personuppgifter. | ADR 0032 | – |
| MEDD-15 | Ett meddelande behåller inställningarna det skapades med. En ny version gäller bara nya meddelanden. | ADR 0020, ADR 0032 | – |
| MEDD-16 | Ett sent besked flyttar inte en frist som räknas från beskedet. Det märks som sent och visas för en person. | ADR 0032 | – |

## Exempel

Kajsas policy tecknas den 16 november. Ett försäkringsbrev skapas med sista dag den 19 november (MEDD-01) på svenska, eftersom Lena har svenska som språk (MEDD-10). Dokumentsystemet skickar det till Lenas digitala brevlåda samma dag och rapporterar dokumentets id och kontrollsumma (MEDD-14). Då kan bolaget senare visa exakt vilket brev Lena fick.

## Mer

- [Meddelanden till kunden](../funktion/meddelanden.md): typerna, innehållet, utskicken och inställningarna
- [Dokument](../funktion/dokument.md): när Petvold gör breven
- [ADR 0032](../adr/0032-meddelanden-och-dokument-till-kunden.md)
