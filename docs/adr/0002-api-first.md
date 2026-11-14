# 0002. API först med kontrakt som källa till sanning

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Kärnan är headless. Kanaler och handläggarytor ligger utanför.

## Beslut

OpenAPI 3.1 per modul och AsyncAPI för händelser. Anrop valideras mot kontraktet i drift, testerna validerar svaren, och en lint kontrollerar att kontrakt och kod har samma operationer. Fel som problem+json, `Idempotency-Key` obligatorisk på beslut och betalningar, markörbaserad sidindelning.

## Konsekvenser

Kontraktet ändras före koden. Klienter kan genereras.

## Alternativ

Kod först med genererat kontrakt: kontraktet blir en bieffekt och glider.
