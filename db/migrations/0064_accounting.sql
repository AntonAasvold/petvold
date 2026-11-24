-- migrate:up

-- Accounting (ADR 0040 steg 6): verifications in double entry, made from the
-- events that move money. A verification never changes; a correction is a new
-- one. Numbers come from an unbroken series per market and year.
create schema accounting;

create table accounting.verification_number_series (
  market   text not null check (market ~ '^[A-Z]{2}$'),
  year     integer not null check (year between 2000 and 2999),
  last_no  integer not null check (last_no >= 0),
  primary key (market, year)
);

create table accounting.verification (
  verification_id    text not null primary key check (verification_id ~ '^ver_[A-Za-z0-9]+$'),
  verification_no    text not null unique,
  market             text not null check (market ~ '^[A-Z]{2}$'),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  booking_date       date not null,
  text               text not null check (length(text) between 1 and 500),
  source_event_id    text not null unique,
  source_event_type  text not null,
  object_type        text not null check (object_type in ('invoice', 'credit-note', 'payment', 'payout', 'refund', 'claim')),
  object_id          text not null,
  created_at         timestamptz not null
);
create index verification_booking on accounting.verification (market, booking_date);
create index verification_object on accounting.verification (object_id);

create table accounting.verification_line (
  verification_id   text not null references accounting.verification (verification_id),
  line_no           integer not null check (line_no >= 1),
  account           text not null check (account in ('bank', 'premium-receivable', 'premium-income', 'premium-tax', 'installment-fees', 'unmatched-payments',
                                                     'customer-losses', 'claims-cost', 'claims-payable', 'refunds-payable')),
  debit             bigint not null check (debit >= 0),
  credit            bigint not null check (credit >= 0),
  payer_account_id  text,
  policy_id         text,
  claim_id          text,
  period_from       date,
  period_to         date,
  primary key (verification_id, line_no),
  -- One side only, never both or none.
  check ((debit > 0) <> (credit > 0)),
  check ((period_from is null) = (period_to is null) and (period_to is null or period_to > period_from))
);

grant usage on schema accounting to accounting_service;
grant select, insert on accounting.verification_number_series, accounting.verification, accounting.verification_line to accounting_service;
grant update (last_no) on accounting.verification_number_series to accounting_service;

-- migrate:down

revoke all on accounting.verification_number_series, accounting.verification, accounting.verification_line from accounting_service;
revoke usage on schema accounting from accounting_service;
drop schema accounting cascade;
