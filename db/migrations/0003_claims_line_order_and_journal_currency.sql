-- migrate:up

-- Fakturaraderna ska komma tillbaka i samma ordning som de skickades.
-- Tabellerna är tomma i alla miljöer när detta skrivs, därav not null utan standardvärde.
alter table claims.claim_line add column line_no int not null check (line_no >= 1);
alter table claims.claim_line add constraint claim_line_order unique (claim_id, line_no);

-- Ledgern ska vara självbeskrivande: varje journal har en valuta (ADR 0014).
alter table claims.journal add column currency char(3) not null check (currency ~ '^[A-Z]{3}$');

-- migrate:down

alter table claims.journal drop column currency;
alter table claims.claim_line drop constraint claim_line_order;
alter table claims.claim_line drop column line_no;
