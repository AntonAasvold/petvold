-- migrate:up

-- Credit balances (ADR 0040 steg 5a): the payer's credit used on an invoice,
-- and credit paid back. Neither changes. A payer's credit is what was received
-- and not used by an invoice or paid back.
create table billing.credit_application (
  application_id  text not null primary key check (application_id ~ '^cap_[A-Za-z0-9]+$'),
  account_id      text not null references billing.payer_account (account_id),
  invoice_id      text not null references billing.invoice (invoice_id),
  amount          bigint not null check (amount > 0),
  at              timestamptz not null,
  by_whom         text not null
);
create index credit_application_account on billing.credit_application (account_id);
create index credit_application_invoice on billing.credit_application (invoice_id);

create table billing.refund (
  refund_id   text not null primary key check (refund_id ~ '^ref_[A-Za-z0-9]+$'),
  account_id  text not null references billing.payer_account (account_id),
  party_id    text not null,
  market      text not null check (market ~ '^[A-Z]{2}$'),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  amount      bigint not null check (amount > 0),
  reason      text not null check (reason in ('requested', 'nothing-more-to-bill')),
  note        text check (length(note) <= 2000),
  at          timestamptz not null,
  by_whom     text not null
);
create index refund_account on billing.refund (account_id, at);

-- A refund's event has no invoice.
alter table billing.outbox alter column invoice_id drop not null;
alter table billing.outbox add column refund_id text references billing.refund (refund_id);
alter table billing.outbox add constraint outbox_subject check ((invoice_id is null) <> (refund_id is null));
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue', 'refund.ordered'));

grant select, insert on billing.credit_application, billing.refund to billing_service;

-- migrate:down

revoke all on billing.credit_application, billing.refund from billing_service;
delete from billing.outbox where refund_id is not null;
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue'));
alter table billing.outbox drop constraint outbox_subject;
alter table billing.outbox drop column refund_id;
alter table billing.outbox alter column invoice_id set not null;
drop table billing.refund;
drop table billing.credit_application;
