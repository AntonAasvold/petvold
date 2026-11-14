# 0004. Postgres via CloudNativePG, självhostat

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Bitemporala data, exclusion constraints och transaktioner med outbox kräver en riktig relationsdatabas. Kärnan ska inte bero på en BaaS.

## Beslut

Postgres, ett schema per modul, drift med CloudNativePG på Kubernetes. Supabase eller Firebase får användas för klientlagret men äger aldrig sanningen.

## Konsekvenser

Full kontroll och ingen ny kritisk leverantör. Kräver kompetens i databasdrift.

## Alternativ

Supabase för kärnan: bra start men binder drift och auth. Hanterad molndatabas: möjlig senare.
