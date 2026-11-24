-- migrate:up

-- payment.matched (ADR 0040 steg 6a): a payment now belongs to a payer, so
-- accounting moves it from unmatched payments. Its event names the payment.
alter table billing.outbox add column payment_id text references billing.payment_receipt (payment_id);
alter table billing.outbox drop constraint outbox_subject;
alter table billing.outbox add constraint outbox_subject check (num_nonnulls(invoice_id, refund_id, payment_id) = 1);
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue', 'refund.ordered', 'payment.matched'));

-- migrate:down

delete from billing.outbox where type = 'payment.matched';
alter table billing.outbox drop constraint outbox_type_check;
alter table billing.outbox add constraint outbox_type_check check (type in ('invoice.issued', 'invoice.credited', 'invoice.paid', 'invoice.overdue', 'refund.ordered'));
alter table billing.outbox drop constraint outbox_subject;
alter table billing.outbox add constraint outbox_subject check ((invoice_id is null) <> (refund_id is null));
alter table billing.outbox drop column payment_id;
