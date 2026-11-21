-- migrate:up

-- Billing (ADR 0040, steg 2): payer accounts and premium plans, made from the
-- policy module's events. A plan never changes: a change is a new plan.
create schema billing;

create table billing.payer_account (
  account_id      text not null primary key check (account_id ~ '^bac_[A-Za-z0-9]+$'),
  party_id        text not null check (party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  market          text not null check (market ~ '^[A-Z]{2}$'),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method  text not null check (payment_method in ('invoice')),
  created_at      timestamptz not null,
  -- One payer per party, market and currency (ADR 0040, punkt 2).
  unique (party_id, market, currency)
);

create table billing.premium_plan (
  plan_id             text not null primary key check (plan_id ~ '^ppl_[A-Za-z0-9]+$'),
  account_id          text not null references billing.payer_account (account_id),
  policy_id           text not null,
  term_no             integer not null check (term_no >= 1),
  market              text not null check (market ~ '^[A-Z]{2}$'),
  product_version     text not null,
  source_event_id     text not null,
  source_event_type   text not null,
  source_occurred_at  timestamptz not null,
  -- What it was computed from, and the result with its model and hash (ADR 0018).
  input               jsonb not null check (jsonb_typeof(input) = 'object'),
  plan                jsonb not null check (jsonb_typeof(plan) = 'object' and plan ? 'model' and plan ? 'inputHash'),
  created_at          timestamptz not null,
  -- The relay delivers at least once: one plan per event.
  unique (source_event_id)
);
create index premium_plan_policy on billing.premium_plan (policy_id, created_at);
create index premium_plan_account on billing.premium_plan (account_id, created_at);

grant usage on schema billing to billing_service;
grant select, insert on billing.payer_account, billing.premium_plan to billing_service;

-- migrate:down

revoke all on billing.payer_account, billing.premium_plan from billing_service;
revoke usage on schema billing from billing_service;
drop schema billing cascade;
