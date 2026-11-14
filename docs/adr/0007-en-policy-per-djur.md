# 0007. En försäkring per djur, samlade i grupper

- Status: Beslutad
- Datum: 2026-11-14

## Sammanhang

Uppfödare behöver försäkra kullar som sedan delas upp när valparna säljs. Hushåll har flera djur.

## Beslut

En policy per djur. `PolicyGroup` samlar policyer för kull eller hushåll med gemensam signering, faktura och grupprabatt. Överlåtelse byter försäkringstagare eller ger en ny policy med `continuityOf`.

## Konsekvenser

Skador, dokument och historik behöver inga undantag. Ett gemensamt kullbelopp kräver ett konto på gruppnivå.

## Alternativ

Flera djur per policy: komplicerar överlåtelse, historik och skadereglering.
