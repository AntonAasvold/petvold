-- migrate:up

-- Recovery of a claim's payout lowered after it was ordered (ADR 0040, punkt 8):
-- a proposal, and a person's decision once: recover, offset against the
-- payer's credit, or write off. Nothing is drawn back by itself.
create table billing.recovery (
  recovery_id      text not null primary key check (recovery_id ~ '^rcv_[A-Za-z0-9]+$'),
  claim_id         text not null,
  decision_id      text not null,
  policy_id        text not null,
  party_id         text not null,
  account_id       text references billing.payer_account (account_id),
  market           text not null check (market ~ '^[A-Z]{2}$'),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  amount           bigint not null check (amount > 0),
  -- One recovery per claim.payout_reduced, however many times it comes.
  source_event_id  text not null unique,
  proposed_at      timestamptz not null
);
create index recovery_claim on billing.recovery (claim_id);
create index recovery_account on billing.recovery (account_id);

create table billing.recovery_decision (
  recovery_id  text not null primary key references billing.recovery (recovery_id),
  outcome      text not null check (outcome in ('recover', 'offset', 'write-off')),
  decided_by   text not null,
  decided_at   timestamptz not null,
  note         text check (length(note) <= 2000)
);

alter table billing.outbox add column recovery_id text references billing.recovery (recovery_id);
alter table billing.outbox drop constraint outbox_subject;
alter table billing.outbox add constraint outbox_subject check (num_nonnulls(invoice_id, refund_id, payment_id, recovery_id) = 1);
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check
  check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue', 'refund.ordered', 'payment.matched', 'recovery.proposed', 'recovery.decided'));

grant select, insert on billing.recovery, billing.recovery_decision to billing_service;

-- Accounting books a recovery as a debt of the customer's.
alter table accounting.verification_line drop constraint verification_line_account_check;
alter table accounting.verification_line add constraint verification_line_account_check
  check (account in ('bank', 'premium-receivable', 'premium-income', 'premium-tax', 'installment-fees', 'unmatched-payments',
                     'customer-losses', 'claims-cost', 'claims-payable', 'refunds-payable', 'recoveries-receivable'));

-- migrate:down

delete from accounting.verification_line where account = 'recoveries-receivable';
alter table accounting.verification_line drop constraint verification_line_account_check;
alter table accounting.verification_line add constraint verification_line_account_check
  check (account in ('bank', 'premium-receivable', 'premium-income', 'premium-tax', 'installment-fees', 'unmatched-payments',
                     'customer-losses', 'claims-cost', 'claims-payable', 'refunds-payable'));

delete from billing.outbox where recovery_id is not null;
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue', 'refund.ordered', 'payment.matched'));
alter table billing.outbox drop constraint outbox_subject;
alter table billing.outbox add constraint outbox_subject check (num_nonnulls(invoice_id, refund_id, payment_id) = 1);
alter table billing.outbox drop column recovery_id;
revoke all on billing.recovery, billing.recovery_decision from billing_service;
drop table billing.recovery_decision;
drop table billing.recovery;
