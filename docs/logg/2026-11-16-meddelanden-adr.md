# ADR om meddelanden och dokument till kunden (PR #68)

**Datum:** 2026-11-16 **ADR:** 0032 (Föreslagen) **Moduler:** inga, bara dokumentation

## Vad

Ett förslag till hur Petvold ser till att kunden får de besked och dokument som lagen kräver (granskningen F2). Ingen kod.

## Hur det ska fungera

- **Kundmeddelanden.** En ny modul, `communications`, skapar ett meddelande när en händelse kräver ett besked. Det gäller till exempel en tecknad, förnyad eller uppsagd policy, eller en avslagen ansökan. Meddelandet har typ, mottagare, innehåll som fält, lagrum och sista dag.
- **Bolagets dokumentsystem** hämtar väntande meddelanden, gör dokumentet med sina mallar och skickar det. Sedan rapporterar det kanal, tid, dokumentets id och kontrollsumma.
- **Produktens dokument** (villkor, förköpsinformation och faktablad) har kontrollsumma och låses med produktversionen. Godkännandet anger vilka dokument som visades.

## Val och avvägningar

- **Petvold avgör vad som ska skickas, men skapar och skickar inte dokumentet.** Bolagen har redan system för mallar och utskick. Bara Petvold vet när ett besked krävs och vad det måste innehålla.
- **Innehållet är fält, inte text.** Då kan ett krav som skälen vid avslag inte glömmas bort.
- **En egen modul** i stället för meddelanden i policymodulen, eftersom ansökningar och skador också ger besked.
- **Petvold ändrar inte upphörandedagen** om beskedet skickas sent. Uppsägningen markeras för en person.

## Att känna till

- Mallar, PDF och kundens val av kanal ingår inte. Kundens val av kanal hör till M6.
- Skadebesked läggs till när skademotorns beslut ska nå kunden från Petvold.

## Filer

- `docs/adr/0032-meddelanden-och-dokument-till-kunden.md`
