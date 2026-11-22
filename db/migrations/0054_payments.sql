-- migrate:up

-- Payments (ADR 0017, ADR 0040 steg 3): payments into the insurer's account,
-- as the payment services report them. A payment never changes.
create schema payments;

create table payments.payment (
  payment_id    text not null primary key check (payment_id ~ '^pay_[A-Za-z0-9]+$'),
  direction     text not null check (direction in ('incoming')),
  status        text not null check (status in ('succeeded')),
  provider      text not null check (provider ~ '^[a-z][a-z0-9-]{0,31}$'),
  provider_ref  text not null check (length(provider_ref) between 1 and 200),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  amount        bigint not null check (amount > 0),
  reference     text check (reference ~ '^[A-Za-z0-9]{1,35}$'),
  booked_on     date not null,
  received_at   timestamptz not null,
  -- A notification may come more than once: one payment per id at the provider.
  unique (provider, provider_ref)
);
create index payment_received on payments.payment (received_at, payment_id);
create index payment_reference on payments.payment (reference) where reference is not null;

-- The module's events (ADR 0008, 0033), written in the same transaction as the payment.
create table payments.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  type          text not null check (type in ('payment.succeeded')),
  payment_id    text not null references payments.payment (payment_id),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  occurred_at   timestamptz not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  published_at  timestamptz
);
create index outbox_pending on payments.outbox (seq) where published_at is null;

grant usage on schema payments to payments_service;
grant select, insert on payments.payment, payments.outbox to payments_service;
grant update (published_at) on payments.outbox to payments_service;

-- migrate:down

revoke all on payments.payment, payments.outbox from payments_service;
revoke usage on schema payments from payments_service;
drop schema payments cascade;
