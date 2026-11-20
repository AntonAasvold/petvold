-- migrate:up

-- Notices on claims (ADR 0036): the claims decision, and a request for
-- information to the customer, its reminder and its expiry.
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired'));

-- migrate:down

delete from communications.outbox where notice_id in (select notice_id from communications.notice where type like 'claim-%');
delete from communications.delivery where notice_id in (select notice_id from communications.notice where type like 'claim-%');
delete from communications.notice where type like 'claim-%';
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer'));
