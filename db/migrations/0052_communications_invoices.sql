-- migrate:up

-- The invoice as a notice (ADR 0040): it may hold several policies, so it
-- names the invoice instead of a policy.
alter table communications.notice add column invoice_id text check (invoice_id ~ '^inv_[A-Za-z0-9]+$');
alter table communications.notice drop constraint notice_check;
alter table communications.notice add constraint notice_check check (policy_id is not null or application_id is not null or invoice_id is not null);
create index notice_invoice on communications.notice (invoice_id);
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired', 'invoice'));

-- migrate:down

delete from communications.outbox where notice_id in (select notice_id from communications.notice where type = 'invoice');
delete from communications.delivery where notice_id in (select notice_id from communications.notice where type = 'invoice');
delete from communications.notice_document where notice_id in (select notice_id from communications.notice where type = 'invoice');
delete from communications.notice where type = 'invoice';
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer',
                  'claim-decision', 'claim-information-request', 'claim-information-reminder', 'claim-information-expired'));
drop index communications.notice_invoice;
alter table communications.notice drop constraint notice_check;
alter table communications.notice add constraint notice_check check (policy_id is not null or application_id is not null);
alter table communications.notice drop column invoice_id;
