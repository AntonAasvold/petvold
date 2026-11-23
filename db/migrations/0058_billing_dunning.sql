-- migrate:up

-- Unpaid premium (ADR 0040 steg 4): what the dunning run did to an invoice, in
-- order: the reminder, notice of cancellation, and the reversal when the premium
-- was paid in time. A step is never changed.
create table billing.invoice_dunning (
  invoice_id  text not null references billing.invoice (invoice_id),
  seq         integer not null check (seq >= 1),
  step        text not null check (step in ('reminded', 'cancellation-noticed', 'cancellation-voided', 'cancellation-void-failed')),
  on_date     date not null,
  at          timestamptz not null,
  by_whom     text not null,
  -- The step's own fields: the cancellations, the policy, the reason.
  details     jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  -- Two runs at once: one of them gets the step.
  primary key (invoice_id, seq)
);

alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue'));

grant select, insert on billing.invoice_dunning to billing_service;

-- migrate:down

revoke all on billing.invoice_dunning from billing_service;
delete from billing.outbox where type = 'invoice.overdue';
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid'));
drop table billing.invoice_dunning;
