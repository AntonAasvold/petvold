-- migrate:up

-- The reminder of an overdue invoice as a notice (ADR 0040 steg 4).
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired', 'invoice', 'payment-reminder'));

-- migrate:down

delete from communications.outbox where notice_id in (select notice_id from communications.notice where type = 'payment-reminder');
delete from communications.delivery where notice_id in (select notice_id from communications.notice where type = 'payment-reminder');
delete from communications.notice_document where notice_id in (select notice_id from communications.notice where type = 'payment-reminder');
delete from communications.notice where type = 'payment-reminder';
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired', 'invoice'));
