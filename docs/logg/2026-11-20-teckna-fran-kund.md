# Teckna försäkring från kundens sida (PR #110)

**Datum:** 2026-11-20 **ADR:** 0029, 0035 **Moduler:** apps/backoffice

## Vad
En försäkring kan nu tecknas från kundens sida och från sidan Policyer, inte bara från djurets sida. Från kunden listar formuläret kundens djur att välja bland.

## Hur det fungerar
- **Kundens sida:** kortet "Policyer som försäkringstagare" har knappen, som öppnar `/policies/new?holder=pty_…`. Knappen kräver `policies:write` och visas inte för en anonymiserad part.
- **Sidan Policyer:** knappen öppnar ett tomt formulär. Vyn får `me` från skalet för att veta om knappen ska visas.
- **Formuläret:** `loadWho` hämtar försäkringstagarens djur med `GET /v1/animals?ownerPartyId=`, utan döda djur. De visas i en lista över fältet för djurets id. Ett val fyller i id:t och hämtar produkterna för djurets art.

## Val och avvägningar
- **Fältet för djurets id finns kvar.** Försäkringstagaren behöver inte äga djuret i registret, till exempel när en förälder tecknar för ett barns djur.

## Filer
- `apps/backoffice/src/views/party-detail.ts`, `src/views/policies-search.ts`, `src/views/policy-issue.ts`, `src/components/app-shell.ts`, `src/locales/sv.ts`, `e2e/policy-issue.spec.ts`
- `docs/funktion/backoffice.md`
