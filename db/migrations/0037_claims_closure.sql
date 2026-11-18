-- migrate:up

-- A claim closed without a decision (ADR 0036): withdrawn by the customer, or
-- dismissed, e.g. as a duplicate. One closure per claim, only before any
-- decision, and never changed or removed. The database keeps both rules itself.
create table claims.claim_closure (
  claim_id      text primary key references claims.claim,
  id            text not null unique,
  kind          text not null check (kind in ('withdrawn', 'dismissed')),
  reason_code   text check (reason_code in ('duplicate', 'registered-in-error', 'not-a-claim')),
  reason        text not null check (length(reason) between 1 and 2000),
  duplicate_of  text references claims.claim,
  closed_by     text not null,
  closed_at     timestamptz not null,
  constraint closure_dismissal_has_code check ((kind = 'dismissed') = (reason_code is not null)),
  constraint closure_duplicate_names_claim check ((reason_code = 'duplicate') = (duplicate_of is not null)),
  constraint closure_not_itself check (duplicate_of is distinct from claim_id)
);

-- A claim with a decision cannot be closed, and a closed claim cannot be decided.
-- Own error codes, so the store can tell them from other errors: PVC01 closed, PVC02 decided.
create function claims.check_closure_no_decision() returns trigger language plpgsql as $$
begin
  if exists (select 1 from claims.decision where claim_id = new.claim_id) then
    raise exception 'Claim % has a decision and cannot be closed', new.claim_id using errcode = 'PVC02';
  end if;
  return new;
end $$;

create trigger claim_closure_no_decision before insert on claims.claim_closure
  for each row execute function claims.check_closure_no_decision();

create function claims.check_decision_not_closed() returns trigger language plpgsql as $$
begin
  if exists (select 1 from claims.claim_closure where claim_id = new.claim_id) then
    raise exception 'Claim % is closed and cannot be decided', new.claim_id using errcode = 'PVC01';
  end if;
  return new;
end $$;

create trigger decision_not_closed before insert on claims.decision
  for each row execute function claims.check_decision_not_closed();

-- A closure releases the reserve: a reserve journal may now refer to the claim,
-- a decision on it, or its closure.
create or replace function claims.check_journal_source() returns trigger language plpgsql as $$
begin
  if new.source_type = 'claim_decision' or new.source_id <> new.claim_id then
    if not exists (select 1 from claims.decision where id = new.source_id and claim_id = new.claim_id)
       and not (new.source_type = 'claim_reserve'
                and exists (select 1 from claims.claim_closure where id = new.source_id and claim_id = new.claim_id)) then
      raise exception 'Journal % refers to %, which is not a decision or closure on claim %', new.id, new.source_id, new.claim_id;
    end if;
  end if;
  return new;
end $$;

revoke update, delete on claims.claim_closure from public;
grant select, insert on claims.claim_closure to claims_service;

-- migrate:down

-- Journals that refer to a closure cannot be expressed in the earlier schema.
delete from claims.journal_line where journal_id in (select j.id from claims.journal j join claims.claim_closure k on k.id = j.source_id);
delete from claims.journal where id in (select j.id from claims.journal j join claims.claim_closure k on k.id = j.source_id);
create or replace function claims.check_journal_source() returns trigger language plpgsql as $$
begin
  if new.source_type = 'claim_decision' or new.source_id <> new.claim_id then
    if not exists (select 1 from claims.decision where id = new.source_id and claim_id = new.claim_id) then
      raise exception 'Journal % refers to %, which is not a decision on claim %', new.id, new.source_id, new.claim_id;
    end if;
  end if;
  return new;
end $$;

revoke select, insert on claims.claim_closure from claims_service;
drop trigger decision_not_closed on claims.decision;
drop function claims.check_decision_not_closed();
drop trigger claim_closure_no_decision on claims.claim_closure;
drop function claims.check_closure_no_decision();
drop table claims.claim_closure;
