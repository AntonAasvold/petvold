# 0020. Roller och beloppsgränser som versionerad konfiguration via API

- Status: Föreslagen
- Datum: 2026-11-14

## Sammanhang

Enligt ADR 0016 och 0019 översätts roller till rättigheter, bindningar och beloppsgränser per installation. I dag skickas inställningen till `createApp` i koden, så att höja en handläggares gräns kräver en ny version av Petvold.

Ett försäkringsbolag ändrar sådant ofta: en ny handläggare får en högre gräns, en ny valuta läggs till, en partnerklinik får se försäkringsbelopp. Ändringen ska kunna göras från ett administrativt gränssnitt, gå att spåra, och inte kunna användas för att någon ger sig själv mer makt.

## Beslut

**1. En egen modul `access`** med schemat `access` och tjänsterollen `access_service` (ADR 0001). Den äger rollinställningen och dess historik. Andra moduler läser den bara via modulens tjänst.

**2. Inställningen är versionerad och ändras aldrig.**
- Varje ändring är en ny version av hela rollinställningen, med `changedBy`, `changedAt` och en obligatorisk motivering.
- Gällande inställning är den senaste versionen. Historiken visar exakt vad som gällde när, så att ett beslut kan kopplas till de gränser som gällde då.
- Version 1 skapas från `DEFAULT_ROLES` när installationen startar första gången.

**3. API.**
- `GET /v1/access/roles` visar gällande inställning (rättighet `access:read`).
- `GET /v1/access/roles/versions` visar historiken (`access:read`).
- `POST /v1/access/roles/versions` sparar en ny version (`access:manage`). Anropet kräver `Idempotency-Key`.
- Anropet anger vilken version ändringen bygger på (`basedOnVersion`). Har någon annan hunnit spara en ny version svarar Petvold 409, och ingen ändring skrivs över.

**4. Spärrar.**
- **Validering.** Den nya versionen valideras som vid start: kända rättigheter och bindningar, gränser som icke-negativa heltal och giltiga valutakoder. Fel ger 422.
- **Ingen ändrar sina egna roller.** Den som ändrar får inte lägga till, ta bort eller ändra en roll som den själv har (403). Det hindrar att någon ger sig själv högre gränser. Det hindrar också att den sista administratören låser ute sig själv.
- **Ny standardroll `admin`** med `access:read` och `access:manage`. Den har inga rättigheter i skadeärenden.

**5. Användning vid anrop.** API-lagret läser gällande inställning vid varje anrop. En ändring gäller alltså direkt, utan omstart.

## Konsekvenser

- Gränser och roller kan ändras utan ny kod, från ett administrativt gränssnitt eller med API-anrop.
- **Fyra ögon.** En administratör kan ändra andra rollers gränser på egen hand. Ändringen spåras, men den attesteras inte. Fyra ögon för ändringar av inställningen är ett möjligt nästa steg, med samma mönster som ADR 0019.
- **En fråga per anrop.** Att läsa inställningen vid varje anrop kostar en liten databasfråga. Om det blir märkbart kan inställningen cachas per version.
- **En ny databasroll.** `access_service` måste skapas i drift (CloudNativePG) och lokalt (`db/init`).
- **Utan databas för inställningen.** `createApp({ roles })` utan modulen `access` håller inställningen i minnet, med `roles` som version 1. Det används i tester.

## Alternativ

- **Inställningen i en fil eller miljövariabel:** enkelt, men ändringar kräver omstart och saknar historik och spärrar.
- **Användare och gränser per person i Petvold:** ADR 0016 bestämmer att Petvold inte lagrar användare. Gränser per nivå görs med roller, till exempel `handler-senior`.
- **Låta identitetstjänsten bära gränserna i tokenen:** då hamnar affärsregler i kundens identitetstjänst, utan versioner eller spärrar i Petvold.

## Källor

- OWASP API Security Top 10 (2023), API5 *Broken Function Level Authorization*. owasp.org/API-Security
- NIST SP 800-53 Rev. 5, AC-5 *Separation of Duties* och AC-6 *Least Privilege*. csrc.nist.gov
- RFC 9110, avsnitt 13.1.1 och 15.5.10: villkorade förfrågningar och 409 *Conflict* (optimistisk låsning). rfc-editor.org
- ADR 0001, 0016 och 0019.
