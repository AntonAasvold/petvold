# Arbetssätt

Hur Petvold drivs. Kort med avsikt: ändra filen när något inte fungerar.

## Roller

| Vem | Ansvar |
| --- | --- |
| Anton | Produktägare och arkitekt. Prioriterar, fattar beslut, granskar och mergar. |
| Claude | Utvecklare och sparringpartner. Föreslår, skriver kod och tester, skriver ADR-utkast, håller `status.md` aktuell. |

Inget mergas till `main` utan att Anton har granskat det.

## Rent ursprung

Petvold är ett privat projekt, skilt från anställning.

- Arbete sker på egen tid, egen dator och egna konton.
- Inget material från arbetsgivare: inga specifikationer, data, villkor, regler, dokument eller kod.
- Underlag är publika källor (publik dokumentation, publika försäkringsvillkor, lagtext) och egna idéer. Ange källan i ADR eller PR när ett mönster är hämtat utifrån.
- Exempeldata är påhittade.

## Rytm

- **Arbetspass**: varje pass börjar med att läsa `docs/status.md` och slutar med att uppdatera den.
- **Veckovis**: gå igenom roadmapen, flytta saker mellan *Nu*, *Nästa* och *Senare*.
- **Per milstolpe**: kort retro i `docs/status.md` – vad höll, vad ändrar vi.

## Från idé till main

1. **Issue** beskriver behovet och vad som gör det klart. Etikett: `modul:<namn>` och `typ:feature|bug|chore|adr`.
2. **Branch** från `main`: `feat/<kort-namn>`, `fix/<kort-namn>`, `docs/<kort-namn>`.
3. **Pull request** med mallen. Små PR:er, en sak i taget.
4. **CI grönt**: typkontroll, tester, databastester, kontraktslint och språkkontroll.
5. **Granskning** och squash-merge.

## Klart betyder

- Kontraktet (OpenAPI/AsyncAPI) är uppdaterat först, koden sedan.
- Tester täcker det nya, inklusive minst ett fel- eller gränsfall. En ny beräkning eller regel har minst en egenskap ([testning.md](teknik/testning.md)).
- Pengar i minsta valutaenhet, datum som `ISODate`, marknad explicit.
- Nya beslut har en ADR. Ändrade beslut får en ny ADR som ersätter den gamla.
- Dokumentationen är uppdaterad i samma PR: [funktion](funktion/) för beteende och konfiguration, [teknik](teknik/) för hur det är byggt. Ny regel, beräkning eller inställning betyder ny text med exempel.
- `docs/status.md` säger vad som ändrats och vad som är nästa steg.

## Beslut (ADR)

Allt som är svårt att ändra senare – modulgränser, datamodell, kontraktskonventioner, teknikval – skrivs som en ADR i `docs/adr/`. Mall: `0000-mall.md`. Status: *Föreslagen*, *Beslutad*, *Ersatt av NNNN*.

## Språk och namn

- All kod på engelska: identifierare, kommentarer, felmeddelanden, loggar, testnamn, SQL, konfiguration, kontrakt och exempeldata. Undantag: språkkataloger för användare (t.ex. den svenska i `messages.ts`) och migreringar som redan körts. `npm run lint:lang` stoppar svenska tecken i koden.
- Dokumentation, ADR, PR-beskrivningar och commit-meddelanden på svenska.
- Id-prefix per typ: `pol_`, `clm_`, `ani_`, `pty_` …

## Versioner

- Kontrakt: semver per modul. Brytande ändringar kräver ny huvudversion av sökvägen (`/v2`).
- Händelser: `type` innehåller version, t.ex. `petvold.claim.decided.v1`.
- Databas: framåtmigreringar, aldrig ändring av en körd migration.
