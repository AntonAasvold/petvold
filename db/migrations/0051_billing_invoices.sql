-- migrate:up

-- Invoices (ADR 0040, steg 2b): the invoicing run puts the installments due
-- within the lead time on one invoice per payer account. An invoice never
-- changes; a correction is a credit note (a later step).

-- The plan keeps the product's lead time from when it was made. Null: 20 days.
alter table billing.premium_plan add column invoice_lead_days integer check (invoice_lead_days between 1 and 60);

-- One unbroken series per market and year (the Swedish Accounting Act, chapter 5 section 7). The
-- number is taken in the same transaction as the invoice, so a rollback leaves
-- no gap.
create table billing.invoice_number_series (
  market   text not null check (market ~ '^[A-Z]{2}$'),
  year     integer not null check (year between 2000 and 9999),
  last_no  integer not null check (last_no >= 0),
  primary key (market, year)
);

create table billing.invoice (
  invoice_id       text not null primary key check (invoice_id ~ '^inv_[A-Za-z0-9]+$'),
  invoice_no       text not null unique,
  account_id       text not null references billing.payer_account (account_id),
  party_id         text not null,
  market           text not null check (market ~ '^[A-Z]{2}$'),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  issue_date       date not null,
  due_date         date not null,
  reference_type   text not null check (reference_type in ('ocr', 'rf')),
  reference        text not null unique,
  total            bigint not null check (total >= 0),
  created_by       text not null,
  created_at       timestamptz not null
);
create index invoice_account on billing.invoice (account_id, created_at);
create index invoice_market on billing.invoice (market, created_at);

create table billing.invoice_line (
  invoice_id    text not null references billing.invoice (invoice_id),
  line_no       integer not null check (line_no >= 1),
  plan_id       text not null references billing.premium_plan (plan_id),
  policy_id     text not null,
  term_no       integer not null,
  seq           integer not null check (seq >= 1),
  period_start  date not null,
  period_end    date not null check (period_end > period_start),
  premium       bigint not null check (premium >= 0),
  tax           bigint not null check (tax >= 0),
  fee           bigint not null check (fee >= 0),
  amount        bigint not null check (amount = premium + tax + fee),
  primary key (invoice_id, line_no),
  -- An installment is invoiced at most once.
  unique (plan_id, seq)
);
create index invoice_line_policy on billing.invoice_line (policy_id);

-- The module's events (ADR 0008, 0033), written in the same transaction as the change.
create table billing.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  type          text not null check (type in ('invoice.issued')),
  invoice_id    text not null references billing.invoice (invoice_id),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  occurred_at   timestamptz not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  published_at  timestamptz
);
create index outbox_pending on billing.outbox (seq) where published_at is null;

grant select, insert on billing.invoice_number_series, billing.invoice, billing.invoice_line, billing.outbox to billing_service;
grant update (last_no) on billing.invoice_number_series to billing_service;
grant update (published_at) on billing.outbox to billing_service;

-- migrate:down

revoke all on billing.invoice_number_series, billing.invoice, billing.invoice_line, billing.outbox from billing_service;
drop table billing.outbox;
drop table billing.invoice_line;
drop table billing.invoice;
drop table billing.invoice_number_series;
alter table billing.premium_plan drop column invoice_lead_days;
