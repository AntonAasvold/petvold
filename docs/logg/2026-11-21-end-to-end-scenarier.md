# End-to-end-scenarier för en hel kundresa (PR #119)

**Datum:** 2026-11-21 **ADR:** – **Moduler:** docs

## Vad
`docs/end-to-end-scenario.md` beskriver fem scenarier som testas för hand i back office, från ny kund till radering:
1. teckning
2. hälsofrågor och prövning
3. skada
4. livet med policyn
5. kunden lämnar

Varje steg anger token, vad man gör och vad som ska hända. Sist finns en lista över det som saknas i gränssnittet.

## Hur listan togs fram
Varje operation i `openapi.yaml` jämfördes med anropen i `apps/backoffice/src`. 18 av 143 operationer saknar gränssnitt. De som rör kundresan står i listan, tillsammans med det som saknas i hela Petvold: premier och betalningar (M5), och mallar för andra meddelanden än skadebesked och försäkringsbrev.

## Att känna till
- **Knapparnas namn** är back office svenska texter. Ändras en text ska scenariot ändras med den.
- **Scenarierna är inte automatiserade.** Flera steg finns redan som flödestester i `apps/backoffice/e2e`.
