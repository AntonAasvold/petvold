# 0003. TypeScript på Node LTS med Hono

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Samma språk i kärnan, BFF och Lit-klienter minskar kontextbyten.

## Beslut

TypeScript i strikt läge, Node LTS, Hono för HTTP, npm workspaces, `node --test` med tsx.

## Konsekvenser

Snabb utveckling och ett ekosystem. Domänlogiken hålls fri från ramverk.

## Alternativ

Java/Kotlin: starkt i försäkring men tyngre för en liten grupp. Go: färre domänbibliotek.
