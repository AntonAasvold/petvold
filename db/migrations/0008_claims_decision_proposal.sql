-- migrate:up

-- Decision proposals (ADR 0019): a handler decision whose payout exceeds the
-- handler's limit. Nothing is booked until someone else approves it. The
-- approval becomes a decision that closes the proposal in the same transaction.
create table claims.decision_proposal (
  id                       text primary key,
  claim_id                 text not null references claims.claim,
  action                   text not null check (action in ('accept', 'reject')),
  outcome                  text not null check (outcome in ('approved', 'partial', 'rejected')),
  payout_minor             bigint not null check (payout_minor >= 0),
  currency                 char(3) not null,
  input_hash               text not null,
  proposed_by              text not null check (proposed_by <> ''),
  proposed_at              timestamptz not null,
  reason                   text,
  reason_code              text check (reason_code in ('pre_existing_condition', 'not_covered', 'insufficient_documentation', 'incorrect_invoice', 'other')),
  deviates_from_proposal   boolean not null,
  proposer_limit_minor     bigint not null check (proposer_limit_minor >= 0 and proposer_limit_minor < payout_minor),
  status                   text not null default 'open' check (status in ('open', 'approved', 'returned')),
  closed_by                text,
  closed_at                timestamptz,
  decision_id              text unique references claims.decision,
  return_reason            text,
  constraint proposal_deviation_motivated
    check (not deviates_from_proposal or (reason_code is not null and coalesce(btrim(reason), '') <> '')),
  constraint proposal_closed_consistently check (
    (status = 'open' and closed_by is null and closed_at is null and decision_id is null and return_reason is null)
    or (status = 'approved' and closed_by is not null and closed_at is not null and decision_id is not null and return_reason is null)
    or (status = 'returned' and closed_by is not null and closed_at is not null and decision_id is null
        and coalesce(btrim(return_reason), '') <> '')
  ),
  constraint proposal_four_eyes check (status <> 'approved' or closed_by <> proposed_by)
);

-- At most one open proposal per claim.
create unique index decision_proposal_one_open on claims.decision_proposal (claim_id) where status = 'open';

-- An approved decision names its approver and proposal. The approver is never the one who decided.
alter table claims.decision add column approved_by text;
alter table claims.decision add column proposal_id text unique references claims.decision_proposal;
alter table claims.decision add constraint decision_approval_complete
  check ((approved_by is null) = (proposal_id is null));
alter table claims.decision add constraint decision_four_eyes
  check (approved_by is null or approved_by <> decided_by);

-- A proposal is closed once, and an approval only by the decision that approves it.
create function claims.check_proposal_close() returns trigger language plpgsql as $$
declare
  d claims.decision;
begin
  if old.status <> 'open' then
    raise exception 'Proposal % is already %', old.id, old.status;
  end if;
  if new.status = 'approved' then
    select * into d from claims.decision where id = new.decision_id;
    if d.claim_id <> new.claim_id or d.proposal_id is distinct from new.id or d.approved_by is distinct from new.closed_by then
      raise exception 'Proposal % must be closed by the decision that approves it', new.id;
    end if;
  end if;
  if (new.id, new.claim_id, new.action, new.outcome, new.payout_minor, new.currency, new.input_hash, new.proposed_by,
      new.proposed_at, new.reason, new.reason_code, new.deviates_from_proposal, new.proposer_limit_minor)
     is distinct from
     (old.id, old.claim_id, old.action, old.outcome, old.payout_minor, old.currency, old.input_hash, old.proposed_by,
      old.proposed_at, old.reason, old.reason_code, old.deviates_from_proposal, old.proposer_limit_minor) then
    raise exception 'Only the closing of proposal % may change', old.id;
  end if;
  return new;
end $$;

create trigger decision_proposal_closed_once
  before update on claims.decision_proposal
  for each row execute function claims.check_proposal_close();

revoke update, delete on claims.decision_proposal from public;
grant select, insert on claims.decision_proposal to claims_service;
grant update (status, closed_by, closed_at, decision_id, return_reason) on claims.decision_proposal to claims_service;

-- migrate:down

revoke update (status, closed_by, closed_at, decision_id, return_reason) on claims.decision_proposal from claims_service;
revoke select, insert on claims.decision_proposal from claims_service;
alter table claims.decision drop constraint decision_four_eyes;
alter table claims.decision drop constraint decision_approval_complete;
alter table claims.decision drop column proposal_id;
alter table claims.decision drop column approved_by;
drop table claims.decision_proposal;
drop function claims.check_proposal_close();
