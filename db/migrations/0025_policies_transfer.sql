-- migrate:up

-- Proposals from the animal register's events (ADR 0029): a transfer when the
-- animal is sold, a cancellation when it dies. A proposal and its decision
-- never change; the source event id makes handling an event twice harmless.
create table policies.proposal (
  proposal_id      text not null primary key check (proposal_id ~ '^ppr_[A-Za-z0-9]+$'),
  policy_id        text not null references policies.policy (policy_id),
  market           text not null check (market ~ '^[A-Z]{2}$'),
  kind             text not null check (kind in ('transfer', 'cancel-death')),
  source_event_id  text not null unique,
  details          jsonb not null,
  -- A transfer the new owner has not accepted by this day ends the policy.
  deadline         date,
  created_at       timestamptz not null,
  check ((kind = 'transfer') = (deadline is not null))
);
create index proposal_policy on policies.proposal (policy_id);

create table policies.proposal_decision (
  proposal_id     text not null primary key references policies.proposal (proposal_id),
  outcome         text not null check (outcome in ('accepted', 'rejected', 'expired')),
  acceptance      jsonb,
  reason          text,
  transaction_id  text references policies.policy_transaction (transaction_id),
  decided_by      text not null,
  decided_at      timestamptz not null
);

alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate', 'renew', 'transfer'));
alter table policies.policy_transaction
  add column transfer jsonb,
  add constraint policy_transaction_transfer check ((type = 'transfer') = (transfer is not null));

revoke all on policies.proposal, policies.proposal_decision from public;
grant select, insert on policies.proposal, policies.proposal_decision to policies_service;

-- migrate:down

revoke all on policies.proposal, policies.proposal_decision from policies_service;
drop table policies.proposal_decision;
drop table policies.proposal;
alter table policies.policy_version disable trigger policy_version_checked;
delete from policies.policy_version where transaction_id in (select transaction_id from policies.policy_transaction where type = 'transfer');
update policies.policy_version v set sys_to = null
 where sys_to is not null
   and not exists (select 1 from policies.policy_version n where n.policy_id = v.policy_id and n.sys_to is null
                   and daterange(n.valid_from, n.valid_to) && daterange(v.valid_from, v.valid_to));
alter table policies.policy_version enable trigger policy_version_checked;
delete from policies.policy_transaction where type = 'transfer';
alter table policies.policy_transaction drop constraint policy_transaction_transfer, drop column transfer;
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate', 'renew'));
