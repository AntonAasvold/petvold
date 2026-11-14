-- migrate:up

-- Fakturaraderna ska komma tillbaka i samma ordning som de skickades.
-- Befintliga rader får en ordning efter radens id.
alter table claims.claim_line add column line_no int;
update claims.claim_line cl
   set line_no = n.line_no
  from (select claim_id, line_id, row_number() over (partition by claim_id order by line_id) as line_no
          from claims.claim_line) n
 where n.claim_id = cl.claim_id and n.line_id = cl.line_id;
alter table claims.claim_line alter column line_no set not null;
alter table claims.claim_line add constraint claim_line_line_no_positive check (line_no >= 1);
alter table claims.claim_line add constraint claim_line_order unique (claim_id, line_no);

-- Ledgern ska vara självbeskrivande: varje journal har en valuta (ADR 0014).
-- Befintliga journaler får valutan från beslutet de bokför.
alter table claims.journal add column currency char(3);
update claims.journal j set currency = d.currency from claims.decision d where d.id = j.source_id;
alter table claims.journal alter column currency set not null;
alter table claims.journal add constraint journal_currency_iso check (currency ~ '^[A-Z]{3}$');

-- migrate:down

alter table claims.journal drop column currency;
alter table claims.claim_line drop constraint claim_line_order;
alter table claims.claim_line drop column line_no;
