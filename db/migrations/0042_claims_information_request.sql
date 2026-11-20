-- migrate:up

-- A request for more information before a claim can be decided (ADR 0036).
-- Open until it is answered, cancelled or expires; a late answer may still
-- close an expired request. The days come from the product's claims rules.
create table claims.information_request (
  id             text primary key,
  claim_id       text not null references claims.claim,
  recipient      text not null check (recipient in ('customer', 'clinic')),
  items          text[] not null check (cardinality(items) >= 1 and items <@ array['itemised-invoice', 'medical-record', 'referral', 'other']),
  note           text not null check (char_length(note) between 1 and 4000),
  due_date       date not null,
  remind_on      date check (remind_on < due_date),
  rules_version  text not null check (rules_version <> ''),
  requested_by   text not null check (requested_by <> ''),
  requested_at   timestamptz not null,
  status         text not null check (status in ('open', 'answered', 'expired', 'cancelled')),
  reminded_at    timestamptz,
  received_at    timestamptz,
  closed_by      text,
  closed_at      timestamptz,
  closing_note   text check (char_length(closing_note) between 1 and 4000),
  constraint information_request_closed_together check ((status = 'open') = (closed_at is null) and (closed_at is null) = (closed_by is null)),
  constraint information_request_answer_received check ((status = 'answered') = (received_at is not null))
);

-- At most one open request per claim and recipient.
create unique index information_request_one_open on claims.information_request (claim_id, recipient) where status = 'open';
-- The daily run looks for open requests.
create index information_request_open on claims.information_request (due_date, remind_on) where status = 'open';

-- A request is made open on a claim that is not closed (PVC01, as for decisions).
-- Afterwards only the state moves: open to answered, expired or cancelled, a
-- reminder while open, and a late answer to an expired request. What was
-- requested never changes.
create function claims.check_information_request() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.reminded_at is not null then
      raise exception 'A request for information is stored open';
    end if;
    if exists (select 1 from claims.claim_closure where claim_id = new.claim_id) then
      raise exception 'Claim % is closed', new.claim_id using errcode = 'PVC01';
    end if;
    return new;
  end if;
  if (new.id, new.claim_id, new.recipient, new.items, new.note, new.due_date, new.remind_on, new.rules_version, new.requested_by, new.requested_at)
     is distinct from (old.id, old.claim_id, old.recipient, old.items, old.note, old.due_date, old.remind_on, old.rules_version, old.requested_by, old.requested_at) then
    raise exception 'Request % cannot be changed, only answered, reminded, expired or cancelled', old.id;
  end if;
  if old.reminded_at is not null and new.reminded_at is distinct from old.reminded_at then
    raise exception 'Request % is already reminded', old.id;
  end if;
  if not (old.status = 'open' or (old.status = 'expired' and new.status = 'answered')) then
    raise exception 'Request % is %', old.id, old.status;
  end if;
  return new;
end $$;

create trigger information_request_checked
  before insert or update on claims.information_request
  for each row execute function claims.check_information_request();

revoke update, delete on claims.information_request from public;
grant select, insert on claims.information_request to claims_service;
grant update (status, reminded_at, received_at, closed_by, closed_at, closing_note) on claims.information_request to claims_service;

-- migrate:down

revoke select, insert, update on claims.information_request from claims_service;
drop trigger information_request_checked on claims.information_request;
drop function claims.check_information_request();
drop table claims.information_request;
