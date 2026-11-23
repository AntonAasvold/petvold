-- migrate:up

-- Payouts (ADR 0040 steg 3c): the payees' account details and the payouts of
-- the claims' payout orders. Nothing changes: new details replace the old from
-- a time, and a payout moves by adding steps.
create table payments.payee_account (
  payee_account_id  text not null primary key check (payee_account_id ~ '^pya_[A-Za-z0-9]+$'),
  party_id          text not null check (party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  market            text not null check (market ~ '^[A-Z]{2}$'),
  method            text not null check (method in ('se-bank', 'iban')),
  -- Personal data: the account number.
  details           jsonb not null check (jsonb_typeof(details) = 'object'),
  created_at        timestamptz not null,
  created_by        text not null
);
create index payee_account_party on payments.payee_account (party_id, created_at);

create table payments.payout (
  payout_id        text not null primary key check (payout_id ~ '^pyo_[A-Za-z0-9]+$'),
  -- One payout per order: an order is never paid twice.
  order_id         text not null unique,
  claim_id         text not null,
  decision_id      text not null,
  policy_id        text not null,
  market           text not null check (market ~ '^[A-Z]{2}$'),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  amount           bigint not null check (amount > 0),
  party_id         text not null,
  provider         text not null,
  source_event_id  text not null,
  created_at       timestamptz not null
);
create index payout_claim on payments.payout (claim_id);
create index payout_party on payments.payout (party_id);

create table payments.payout_step (
  payout_id         text not null references payments.payout (payout_id),
  seq               integer not null check (seq >= 1),
  status            text not null check (status in ('awaiting-details', 'held', 'pending', 'paid', 'failed')),
  at                timestamptz not null,
  by_whom           text not null,
  payee_account_id  text references payments.payee_account (payee_account_id),
  provider_ref      text,
  note              text check (length(note) <= 2000),
  -- Two who move a payout at once: one of them gets the step.
  primary key (payout_id, seq)
);

-- Payout events in the outbox beside the payments'.
alter table payments.outbox alter column payment_id drop not null;
alter table payments.outbox add column payout_id text references payments.payout (payout_id);
alter table payments.outbox drop constraint outbox_type_check;
alter table payments.outbox add constraint outbox_type_check check (type in ('payment.succeeded', 'payout.paid', 'payout.failed'));
alter table payments.outbox add constraint outbox_subject check ((payment_id is null) <> (payout_id is null));

grant select, insert on payments.payee_account, payments.payout, payments.payout_step to payments_service;

-- migrate:down

revoke all on payments.payee_account, payments.payout, payments.payout_step from payments_service;
delete from payments.outbox where payout_id is not null;
alter table payments.outbox drop constraint outbox_subject;
alter table payments.outbox drop constraint outbox_type_check;
alter table payments.outbox add constraint outbox_type_check check (type in ('payment.succeeded'));
alter table payments.outbox drop column payout_id;
alter table payments.outbox alter column payment_id set not null;
drop table payments.payout_step;
drop table payments.payout;
drop table payments.payee_account;
