-- migrate:up

-- Renewal (ADR 0029): a transaction that adds the next term and its version.
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate', 'renew'));
alter table policies.policy_transaction
  add column renewal jsonb,
  add constraint policy_transaction_renewal check ((type = 'renew') = (renewal is not null));

-- migrate:down

-- A rollback cannot keep renewals: drop their versions, terms and transactions.
delete from policies.policy_version where transaction_id in (select transaction_id from policies.policy_transaction where type = 'renew');
delete from policies.term where transaction_id in (select transaction_id from policies.policy_transaction where type = 'renew');
delete from policies.policy_transaction where type = 'renew';
alter table policies.policy_transaction drop constraint policy_transaction_renewal, drop column renewal;
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate'));
