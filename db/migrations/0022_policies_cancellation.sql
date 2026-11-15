-- migrate:up

-- Cancellation and reinstatement (ADR 0029), and an outbox for the policy
-- module's events (ADR 0008), written in the same transaction as the change.
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate'));
alter table policies.policy_transaction
  add column supersedes   text[],
  add column cancellation jsonb,
  add column reverses     text references policies.policy_transaction (transaction_id),
  add column note         text,
  add constraint policy_transaction_cancellation check ((type = 'cancel') = (cancellation is not null)),
  add constraint policy_transaction_reverses check ((type = 'reinstate') = (reverses is not null));

create table policies.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  policy_id     text not null,
  type          text not null,
  occurred_at   timestamptz not null,
  data          jsonb not null,
  published_at  timestamptz
);
create index outbox_pending on policies.outbox (seq) where published_at is null;

revoke all on policies.outbox from public;
grant select, insert on policies.outbox to policies_service;
grant update (published_at) on policies.outbox to policies_service;

-- migrate:down

revoke all on policies.outbox from policies_service;
drop table policies.outbox;
-- A rollback cannot keep cancellations: drop them and make the issued versions current again.
alter table policies.policy_version disable trigger policy_version_checked;
delete from policies.policy_version where transaction_id in (select transaction_id from policies.policy_transaction where type <> 'issue');
update policies.policy_version set sys_to = null where sys_to is not null;
alter table policies.policy_version enable trigger policy_version_checked;
delete from policies.policy_transaction where type <> 'issue';
alter table policies.policy_transaction
  drop constraint policy_transaction_reverses,
  drop constraint policy_transaction_cancellation,
  drop column note,
  drop column reverses,
  drop column cancellation,
  drop column supersedes;
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue'));
