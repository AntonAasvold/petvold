# 0006. Bitemporala policyversioner och transaktionslivscykel

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

En skada ska prövas mot det som gällde på skadedagen och som var känt vid beslutet. Ändringar kommer i fel ordning.

## Beslut

Policyversioner har giltighetstid och registreringstid. Ändringar går genom livscykeln utkast → initierad → validerad → prissatt → riskbedömd → accepterad → utfärdad. Reversering och sammansatta transaktioner för ändring i fel ordning. Term som egen entitet.

## Konsekvenser

Varje beslut går att återskapa och varje premiedifferens går att spåra. Mer komplex modell än enkla versioner.

## Alternativ

Bara giltighetstid: kan inte svara på vad vi visste vid ett visst tillfälle.
