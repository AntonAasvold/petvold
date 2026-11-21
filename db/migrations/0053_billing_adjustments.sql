-- migrate:up

-- Changes, cancellations and transfers (ADR 0040, punkt 4): a plan that
-- replaces another, and credit notes from the invoice series.

-- One event may now give several plans: one per term it touches, and for a
-- transfer one for each payer.
alter table billing.premium_plan drop constraint premium_plan_source_event_id_key;
alter table billing.premium_plan add constraint premium_plan_source_key unique (source_event_id, account_id, term_no);
alter table billing.premium_plan add column replaces_plan_id text references billing.premium_plan (plan_id);
alter table billing.premium_plan add column adjustment jsonb check (adjustment is null or jsonb_typeof(adjustment) = 'object');
-- A plan is replaced at most once.
create unique index premium_plan_replaces on billing.premium_plan (replaces_plan_id) where replaces_plan_id is not null;

create table billing.credit_note (
  credit_note_id     text not null primary key check (credit_note_id ~ '^crn_[A-Za-z0-9]+$'),
  credit_note_no     text not null unique,
  invoice_id         text not null references billing.invoice (invoice_id),
  account_id         text not null references billing.payer_account (account_id),
  party_id           text not null,
  market             text not null check (market ~ '^[A-Z]{2}$'),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  issue_date         date not null,
  total              bigint not null check (total > 0),
  source_event_id    text not null,
  source_event_type  text not null,
  created_at         timestamptz not null
);
create index credit_note_invoice on billing.credit_note (invoice_id);
create index credit_note_account on billing.credit_note (account_id, created_at);

create table billing.credit_note_line (
  credit_note_id  text not null references billing.credit_note (credit_note_id),
  line_no         integer not null check (line_no >= 1),
  plan_id         text not null references billing.premium_plan (plan_id),
  policy_id       text not null,
  seq             integer not null check (seq >= 1),
  amount          bigint not null check (amount > 0),
  primary key (credit_note_id, line_no)
);
create index credit_note_line_policy on billing.credit_note_line (policy_id);

alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited'));

grant select, insert on billing.credit_note, billing.credit_note_line to billing_service;

-- migrate:down

revoke all on billing.credit_note, billing.credit_note_line from billing_service;
delete from billing.outbox where type = 'invoice.credited';
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued'));
drop table billing.credit_note_line;
drop table billing.credit_note;
drop index billing.premium_plan_replaces;
delete from billing.premium_plan where replaces_plan_id is not null or adjustment is not null;
alter table billing.premium_plan drop column adjustment;
alter table billing.premium_plan drop column replaces_plan_id;
alter table billing.premium_plan drop constraint premium_plan_source_key;
alter table billing.premium_plan add constraint premium_plan_source_event_id_key unique (source_event_id);
