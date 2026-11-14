-- migrate:up

-- The clinic that submitted the claim, from the caller's token (ADR 0016).
-- A clinic only sees its own claims. Claims submitted by others have none.
alter table claims.claim add column clinic_id text check (clinic_id <> '');
create index claim_clinic_id on claims.claim (clinic_id) where clinic_id is not null;

-- migrate:down

drop index claims.claim_clinic_id;
alter table claims.claim drop column clinic_id;
