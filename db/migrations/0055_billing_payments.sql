-- migrate:up

-- Payments on the payers' accounts (ADR 0040 steg 3b): what billing receives
-- from payment.succeeded, which account it belongs to, and what it paid of
-- each invoice. Nothing here changes; an invoice's paid and open amounts are
-- worked out from these rows and its credit notes.
create table billing.payment_receipt (
  payment_id       text not null primary key check (payment_id ~ '^pay_[A-Za-z0-9]+$'),
  market           text not null check (market ~ '^[A-Z]{2}$'),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  amount           bigint not null check (amount > 0),
  reference        text,
  booked_on        date not null,
  received_at      timestamptz not null,
  source_event_id  text not null unique
);
create index payment_receipt_received on billing.payment_receipt (received_at, payment_id);

-- One match per payment: by the invoice's reference, or by a person.
create table billing.payment_match (
  payment_id  text not null primary key references billing.payment_receipt (payment_id),
  account_id  text not null references billing.payer_account (account_id),
  invoice_id  text references billing.invoice (invoice_id),
  how         text not null check (how in ('reference', 'manual')),
  matched_by  text not null,
  matched_at  timestamptz not null,
  note        text check (length(note) <= 2000)
);
create index payment_match_account on billing.payment_match (account_id);

create table billing.allocation (
  payment_id  text not null references billing.payment_match (payment_id),
  invoice_id  text not null references billing.invoice (invoice_id),
  account_id  text not null references billing.payer_account (account_id),
  amount      bigint not null check (amount > 0),
  primary key (payment_id, invoice_id)
);
create index allocation_account on billing.allocation (account_id);
create index allocation_invoice on billing.allocation (invoice_id);

-- A payment finds its invoice by the reference.
create index invoice_reference on billing.invoice (market, reference);

alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid'));

grant select, insert on billing.payment_receipt, billing.payment_match, billing.allocation to billing_service;

-- migrate:down

revoke all on billing.payment_receipt, billing.payment_match, billing.allocation from billing_service;
delete from billing.outbox where type = 'invoice.paid';
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited'));
drop index billing.invoice_reference;
drop table billing.allocation;
drop table billing.payment_match;
drop table billing.payment_receipt;
