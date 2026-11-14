-- migrate:up

-- Limit accounts carry their currency, like the claim_* accounts (ADR 0014):
--   limit_consumed:<currency>:<animal>:<coverage>:<policy year start>
-- Existing rows get the currency of their journal. History is otherwise
-- immutable; this rewrites names only, never amounts.
update claims.journal_line jl
   set account = regexp_replace(jl.account, '^(limit_consumed|limit_available):', '\1:' || j.currency || ':')
  from claims.journal j
 where j.id = jl.journal_id
   and jl.account ~ '^limit_(consumed|available):'
   and jl.account !~ '^limit_(consumed|available):[A-Z]{3}:';

-- migrate:down

update claims.journal_line
   set account = regexp_replace(account, '^(limit_consumed|limit_available):[A-Z]{3}:', '\1:')
 where account ~ '^limit_(consumed|available):[A-Z]{3}:';
