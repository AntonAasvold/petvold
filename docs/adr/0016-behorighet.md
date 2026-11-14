# 0016. Behörighet: rättigheter i kontraktet, roller per installation och åtkomst till data

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

API:et har en enkel rollkontroll i dag (`requireRole` i `claims-api/src/app.ts`):

- **Rollerna är hårdkodade per anrop** i koden. Kontraktet säger inget om vem som får göra vad.
- **Läsningar är inte skyddade.** Alla inloggade, även en klinik, kan läsa vilket ärende som helst, dess bedömning och beslut, och vilket djurs försäkringsbelopp som helst. Förhandsbedömning har heller ingen kontroll.
- **`system` släpper igenom allt.** En maskinklient som bara ska göra omprövningar får också fatta beslut.
- **`handler` och `approver` får göra samma sak.** Det finns inga beloppsgränser och ingen fyraögonsprincip.

Petvold installeras en gång per kund (ADR 0010). Varje försäkringsbolag har egna roller i sin identitetstjänst och egna regler för vem som får besluta om hur stora belopp. Petvold ska inte hantera användare själv.

De två vanligaste säkerhetsbristerna i API:er enligt OWASP är just dessa: åtkomst till objekt utan kontroll av att anroparen får se *det* objektet (API1, BOLA) och åtkomst till funktioner utan kontroll av rätten till funktionen (API5, BFLA).

## Beslut

Behörighet i tre lager.

**1. Rättigheter per anrop, deklarerade i kontraktet.**
- Varje operation i OpenAPI har exakt en rättighet i `x-permission`, i formen `<resurs>:<handling>`:

  | Operation | Rättighet |
  | --- | --- |
  | `POST /v1/claims` | `claims:register` |
  | `GET /v1/claims/{id}`, `.../assessment`, `.../decisions` | `claims:read` |
  | `POST /v1/claims/{id}/decisions` | `claims:decide` |
  | `POST /v1/claims/{id}/reassessments` | `claims:reassess` |
  | `POST /v1/claim-previews` | `claims:preview` |
  | `GET /v1/policies/{p}/animals/{a}/limits` | `limits:read` |

- API-lagret läser rättigheten ur kontraktet för varje operation och kontrollerar den. Koden upprepar den inte, så kontrakt och kod kan inte glida isär.
- Kontraktskontrollen (`lint:openapi`) underkänner en operation utan `x-permission`. Ett nytt anrop blir alltså stängt tills någon har tagit ställning.
- Saknad rättighet ger 403.

**2. Roller översätts till rättigheter per installation.**
- Roller kommer från anroparens token (OIDC/JWT från kundens identitetstjänst). Petvold lagrar inga användare.
- Översättningen roll → rättigheter är konfiguration per installation. Petvold levererar standardroller som utgångspunkt:

  | Roll | Rättigheter |
  | --- | --- |
  | `handler` | `claims:register`, `claims:read`, `claims:decide`, `claims:reassess`, `claims:preview`, `limits:read` |
  | `approver` | `claims:read`, `limits:read`, och attest när kedjan i M1 finns |
  | `clinic` | `claims:register`, `claims:read`, `claims:preview` |
  | `reassessment-job` | `claims:read`, `claims:reassess` |

- **Ingen roll släpper igenom allt.** `system` tas bort. Maskinklienter får en egen roll med de rättigheter de behöver.

**3. Åtkomst till data och beslutsrätt.**
- **Omfång per anropare.** Anroparen har attribut från sin token: vilka marknader den får arbeta i, och för en klinik dess klinik-id. En klinik ser bara ärenden den själv har skickat in. En handläggare ser bara ärenden i sina marknader. Ett ärende utanför omfånget ger 404, inte 403, så att det inte går att se att ärendet finns.
- **Beslutsrätt per belopp.** Varje roll kan ha en beloppsgräns per valuta. Ett beslut över gränsen blir ett beslutsförslag som någon annan med rätt att attestera måste godkänna. Den som föreslår får aldrig attestera sitt eget förslag (fyraögonsprincipen). Gränserna är konfiguration per installation.
- **Var kontrollen ligger.** Rättigheter och omfång kontrolleras i API-lagret. Beslutsrätt och fyraögonsprincip är affärsregler och ligger i `claims-core`. Tjänsten får en `Actor` (subjekt och beloppsgränser) i stället för bara ett namn, så att reglerna kan testas utan HTTP.
- **Spårbarhet.** Varje beslut sparar vem som fattade det, som i dag. Attest sparar vem som attesterade.

## Konsekvenser

- Kontraktet visar för kunder och granskare vem som får göra vad. Dokumentationssidan kan visa rättigheten per anrop.
- En kund kan ändra sina roller utan ny kod, men en felaktig konfiguration kan ge för breda rättigheter. Konfigurationen valideras vid start mot listan över kända rättigheter.
- Omfånget kräver att ärendet sparar vem som skickade in det (klinik-id). Det blir en ny migration.
- Beslutsrätten hänger ihop med kedjan beslutsförslag → beslut → attest i M1 och byggs tillsammans med den.
- Omfånget kontrolleras i koden, inte med radsäkerhet i Postgres. Vi har en tjänsteroll per modul (ADR 0015), och ett glömt villkor i en fråga fångas av tester per anrop och roll.
- Införs i tre PR:er:
  1. `x-permission` i kontraktet, kontroll i API-lagret, standardroller och en lint-regel. `system` tas bort.
  2. Omfång per marknad och klinik, med migration för klinik-id.
  3. Beloppsgränser och fyraögonsprincip, tillsammans med attest i M1.

## Alternativ

- **Behålla roller i koden:** enkelt, men varje kund skulle behöva ändra kod, och kontraktet säger inget om behörighet.
- **OAuth-scopes i `security`:** OpenAPI kan beskriva scopes, men scopes gäller vad en klient får göra å användarens vägnar, inte vad användaren själv får göra. Vi kan läsa rättigheter ur scopes senare om en kund vill det.
- **Extern policymotor (OPA, Cedar, OpenFGA):** kraftfullt, men ännu en tjänst att drifta per installation. Den här modellen går att flytta till Cedar senare om reglerna växer, eftersom rättigheter och attribut redan är separerade.
- **Radsäkerhet i Postgres (RLS):** stark garanti, men kräver att anroparens attribut sätts per transaktion och passar dåligt med en pool per tjänsteroll.

## Källor

- OWASP API Security Top 10 (2023): API1 *Broken Object Level Authorization*, API5 *Broken Function Level Authorization*. owasp.org/API-Security
- OWASP Application Security Verification Standard 4.0, kapitel V4 *Access Control*. owasp.org/www-project-application-security-verification-standard
- Sandhu, Ferraiolo, Kuhn: *The NIST Model for Role-Based Access Control* (2000). csrc.nist.gov/projects/role-based-access-control
- RFC 9068, *JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens* (roller och grupper i token).
- OpenAPI Specification 3.1, *Specification Extensions* (`x-`-fält). spec.openapis.org/oas/v3.1.0
