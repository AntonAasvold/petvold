-- migrate:up

-- What became of a referred application (ADR 0031): a person accepts or
-- declines it, the channel withdraws it, or it expires. One decision per
-- application, never changed, and only for one that was referred.
alter table policies.application add column deadline date;
update policies.application set deadline = (received_at at time zone 'UTC')::date + 30 where status = 'referred';
alter table policies.application add constraint application_deadline check ((status = 'referred') = (deadline is not null));

create table policies.application_decision (
  application_id  text not null primary key references policies.application (application_id),
  outcome         text not null check (outcome in ('accepted', 'declined', 'withdrawn', 'expired')),
  riders          jsonb,
  reason          text check (reason ~ '^[a-z][a-z0-9-]{1,63}$'),
  note            text,
  policy_id       text references policies.policy (policy_id),
  decided_by      text not null,
  decided_at      timestamptz not null,
  check ((outcome = 'accepted') = (policy_id is not null)),
  check ((outcome = 'declined') = (reason is not null)),
  check (outcome not in ('accepted', 'declined') or note is not null)
);

create function policies.check_application_decision() returns trigger language plpgsql as $$
begin
  if (select status from policies.application where application_id = new.application_id) is distinct from 'referred' then
    raise exception 'Only a referred application can be decided';
  end if;
  return new;
end $$;

create trigger application_decision_checked
  before insert on policies.application_decision
  for each row execute function policies.check_application_decision();

revoke all on policies.application_decision from public;
grant select, insert on policies.application_decision to policies_service;

-- migrate:down

revoke all on policies.application_decision from policies_service;
drop table policies.application_decision;
drop function policies.check_application_decision();
alter table policies.application drop constraint application_deadline, drop column deadline;
