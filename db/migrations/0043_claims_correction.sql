-- migrate:up

-- A correction of a claim's details (ADR 0036). The claim and its lines stay
-- as registered (revision 1); each correction adds the next revision with the
-- details as they became. Nothing is changed or removed.
create table claims.claim_correction (
  claim_id      text not null references claims.claim,
  revision      int not null check (revision >= 2),
  id            text not null unique,
  -- channel, treatmentFrom, treatmentTo, diagnosisCode and lines after the correction.
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  fields        text[] not null check (cardinality(fields) >= 1 and fields <@ array['channel', 'treatmentFrom', 'treatmentTo', 'diagnosisCode', 'lines']),
  reason        text not null check (char_length(reason) between 1 and 2000),
  corrected_by  text not null check (corrected_by <> ''),
  corrected_at  timestamptz not null,
  reopens       boolean not null,
  primary key (claim_id, revision)
);

-- Revisions follow each other without gaps, and a closed claim is not corrected (PVC01).
create function claims.check_claim_correction() returns trigger language plpgsql as $$
begin
  if new.revision > 2 and not exists (select 1 from claims.claim_correction where claim_id = new.claim_id and revision = new.revision - 1) then
    raise exception 'Claim % has no revision %', new.claim_id, new.revision - 1;
  end if;
  if exists (select 1 from claims.claim_closure where claim_id = new.claim_id) then
    raise exception 'Claim % is closed', new.claim_id using errcode = 'PVC01';
  end if;
  return new;
end $$;

create trigger claim_correction_checked before insert on claims.claim_correction
  for each row execute function claims.check_claim_correction();

-- The revision a decision was made on. Earlier decisions were made on revision 1.
alter table claims.decision add column claim_revision int not null default 1 check (claim_revision >= 1);

revoke update, delete on claims.claim_correction from public;
grant select, insert on claims.claim_correction to claims_service;

-- migrate:down

alter table claims.decision drop column claim_revision;
revoke select, insert on claims.claim_correction from claims_service;
drop trigger claim_correction_checked on claims.claim_correction;
drop function claims.check_claim_correction();
drop table claims.claim_correction;
