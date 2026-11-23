-- migrate:up

-- Credit notes and write-offs a person makes (ADR 0040 steg 5b). Above the
-- person's limit it is a proposal that someone else approves or returns. A
-- write-off is a credit note of its own kind: an unpaid amount given up.
alter table billing.credit_note add column kind text not null default 'credit' check (kind in ('credit', 'write-off'));
alter table billing.credit_note alter column kind drop default;
alter table billing.credit_note add column reason text check (length(reason) <= 2000);

create table billing.credit_proposal (
  proposal_id   text not null primary key check (proposal_id ~ '^cpr_[A-Za-z0-9]+$'),
  invoice_id    text not null references billing.invoice (invoice_id),
  account_id    text not null references billing.payer_account (account_id),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  kind          text not null check (kind in ('credit', 'write-off')),
  amount        bigint not null check (amount > 0),
  reason        text not null check (length(reason) between 1 and 2000),
  proposed_by   text not null,
  proposed_at   timestamptz not null
);
create index credit_proposal_invoice on billing.credit_proposal (invoice_id);

-- The decision on a proposal, once: approved with its credit note, or returned with why.
create table billing.credit_proposal_decision (
  proposal_id     text not null primary key references billing.credit_proposal (proposal_id),
  outcome         text not null check (outcome in ('approved', 'returned')),
  decided_by      text not null,
  decided_at      timestamptz not null,
  credit_note_id  text references billing.credit_note (credit_note_id),
  return_reason   text check (length(return_reason) <= 2000),
  check ((outcome = 'approved') = (credit_note_id is not null))
);

grant select, insert on billing.credit_proposal, billing.credit_proposal_decision to billing_service;

-- migrate:down

revoke all on billing.credit_proposal, billing.credit_proposal_decision from billing_service;
drop table billing.credit_proposal_decision;
drop table billing.credit_proposal;
alter table billing.credit_note drop column reason;
alter table billing.credit_note drop column kind;
