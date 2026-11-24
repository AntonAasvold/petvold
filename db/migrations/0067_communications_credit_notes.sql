-- migrate:up

-- A credit note on an invoice as a notice to the customer (ADR 0040, punkt 5).
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired', 'invoice', 'payment-reminder',
                  'credit-note'));

-- migrate:down

delete from communications.outbox where notice_id in (select notice_id from communications.notice where type = 'credit-note');
delete from communications.delivery where notice_id in (select notice_id from communications.notice where type = 'credit-note');
delete from communications.notice_document where notice_id in (select notice_id from communications.notice where type = 'credit-note');
delete from communications.notice where type = 'credit-note';
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired', 'invoice', 'payment-reminder'));
