-- migrate:up

-- Automated decisions are marked (ADR 0018, GDPR art. 22): automatic
-- settlement and reassessment, where no person judged the outcome.
-- Earlier decisions: automated if the engine made them.
alter table claims.decision add column automated boolean;
update claims.decision set automated = (decided_by = 'auto');
alter table claims.decision alter column automated set not null;

-- A request for human review of an automated decision. Open until a claims
-- handler decides the claim; that decision closes it in the same transaction.
create table claims.review_request (
  id                    text primary key,
  claim_id              text not null references claims.claim,
  decision_id           text not null references claims.decision,
  decision_seq          int  not null check (decision_seq >= 1),
  requested_by          text not null check (requested_by <> ''),
  statement             text check (char_length(statement) between 1 and 4000),
  requested_at          timestamptz not null,
  closed_by_decision_id text unique references claims.decision,
  closed_at             timestamptz,
  constraint review_request_closed_together check ((closed_by_decision_id is null) = (closed_at is null))
);

-- At most one open request per claim.
create unique index review_request_one_open on claims.review_request (claim_id) where closed_at is null;

-- The decision a review answers. One decision answers at most one request.
alter table claims.decision add column review_request_id text unique references claims.review_request;
alter table claims.decision add constraint decision_review_is_human check (review_request_id is null or not automated);

-- A request concerns an automated decision on the same claim, with the right
-- sequence number; it is closed by a human decision on the same claim, once.
create function claims.check_review_request() returns trigger language plpgsql as $$
declare
  d claims.decision;
begin
  if tg_op = 'INSERT' then
    select * into d from claims.decision where id = new.decision_id;
    if d.claim_id <> new.claim_id or d.seq <> new.decision_seq then
      raise exception 'Decision % does not match claim %#%', new.decision_id, new.claim_id, new.decision_seq;
    end if;
    if not d.automated then
      raise exception 'Decision % is not automated', new.decision_id;
    end if;
    if new.closed_at is not null then
      raise exception 'A review request is stored open';
    end if;
    return new;
  end if;
  if old.closed_at is not null then
    raise exception 'Review request % is already closed', old.id;
  end if;
  select * into d from claims.decision where id = new.closed_by_decision_id;
  if d.claim_id <> new.claim_id or d.automated or d.review_request_id is distinct from new.id then
    raise exception 'Review request % must be closed by the human decision that answers it', new.id;
  end if;
  return new;
end $$;

create trigger review_request_checked
  before insert or update on claims.review_request
  for each row execute function claims.check_review_request();

revoke update, delete on claims.review_request from public;
grant select, insert on claims.review_request to claims_service;
grant update (closed_by_decision_id, closed_at) on claims.review_request to claims_service;

-- migrate:down

revoke update (closed_by_decision_id, closed_at) on claims.review_request from claims_service;
revoke select, insert on claims.review_request from claims_service;
alter table claims.decision drop constraint decision_review_is_human;
alter table claims.decision drop column review_request_id;
drop table claims.review_request;
drop function claims.check_review_request();
alter table claims.decision drop column automated;
