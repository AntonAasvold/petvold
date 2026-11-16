-- migrate:up

-- Applications for products with underwriting rules (ADR 0031). An application
-- never changes: it keeps what the rules were run on, what they gave and the
-- customer's acceptance. An accepted one points at the policy it issued, in the
-- same transaction; a referred one waits for a person (step 3 adds the decision).
create table policies.application (
  application_id         text not null primary key check (application_id ~ '^app_[A-Za-z0-9]+$'),
  market                 text not null check (market ~ '^[A-Z]{2}$'),
  animal_id              text not null,
  policyholder_party_id  text not null check (policyholder_party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  product_version        text not null,
  start_date             date not null,
  choices                jsonb not null,
  acceptance             jsonb not null,
  premium                bigint not null check (premium >= 0),
  currency               text not null check (currency ~ '^[A-Z]{3}$'),
  status                 text not null check (status in ('accepted', 'referred', 'declined')),
  underwriting           jsonb not null,
  policy_id              text references policies.policy (policy_id),
  received_by            text not null,
  received_at            timestamptz not null,
  check ((status = 'accepted') = (policy_id is not null))
);
create index application_status on policies.application (status, received_at);
create index application_party on policies.application (policyholder_party_id);
create index application_animal on policies.application (animal_id);

-- How the customer accepted at issue, and the application it came from.
alter table policies.policy_transaction add column issue jsonb;

-- Events about an application that has not led to a policy have no policy.
alter table policies.outbox
  alter column policy_id drop not null,
  add column application_id text,
  add constraint outbox_subject check (policy_id is not null or application_id is not null);

revoke all on policies.application from public;
grant select, insert on policies.application to policies_service;

-- migrate:down

revoke all on policies.application from policies_service;
delete from policies.outbox where policy_id is null;
alter table policies.outbox drop constraint outbox_subject, drop column application_id, alter column policy_id set not null;
alter table policies.policy_transaction drop column issue;
drop table policies.application;
