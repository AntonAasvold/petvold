-- migrate:up

-- Evidence per decision (ADR 0018): exactly the input the engine assessed,
-- the calculation model and the engine version. Never changed, so a decision
-- can be proven and recalculated later. sha256 of the canonical input equals
-- the decision's input_hash.
create table claims.decision_evidence (
  decision_id        text primary key references claims.decision,
  input              jsonb not null,
  calculation_model  text not null check (calculation_model <> ''),
  engine_version     text not null check (engine_version <> ''),
  created_at         timestamptz not null default now()
);

revoke update, delete on claims.decision_evidence from public;
grant select, insert on claims.decision_evidence to claims_service;

-- Every new decision must have its evidence, written in the same transaction.
-- Decisions made before this migration have none.
create function claims.assert_decision_has_evidence() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from claims.decision_evidence where decision_id = new.id) then
    raise exception 'Decision % has no evidence', new.id;
  end if;
  return null;
end $$;

create constraint trigger decision_has_evidence
  after insert on claims.decision
  deferrable initially deferred
  for each row execute function claims.assert_decision_has_evidence();

-- Deviation from the proposal: always with a reason code and a reason.
alter table claims.decision add column deviates_from_proposal boolean not null default false;
alter table claims.decision add column reason_code text;
alter table claims.decision add constraint decision_deviation_motivated
  check (not deviates_from_proposal or (reason_code is not null and coalesce(btrim(reason), '') <> ''));
alter table claims.decision add constraint decision_reason_code_known
  check (reason_code in ('pre_existing_condition', 'not_covered', 'insufficient_documentation', 'incorrect_invoice', 'other'));

-- migrate:down

alter table claims.decision drop constraint decision_reason_code_known;
alter table claims.decision drop constraint decision_deviation_motivated;
alter table claims.decision drop column reason_code;
alter table claims.decision drop column deviates_from_proposal;
drop trigger decision_has_evidence on claims.decision;
drop function claims.assert_decision_has_evidence();
drop table claims.decision_evidence;
