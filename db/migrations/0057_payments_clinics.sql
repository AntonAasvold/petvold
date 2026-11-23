-- migrate:up

-- Direct settlement (ADR 0040 steg 3c-2): a clinic with an agreement is paid
-- the payouts that name it. A payee is a party or a clinic, never both.
alter table payments.payee_account alter column party_id drop not null;
alter table payments.payee_account add column clinic_id text check (length(clinic_id) between 1 and 100);
alter table payments.payee_account add constraint payee_account_payee check ((party_id is null) <> (clinic_id is null));
create index payee_account_clinic on payments.payee_account (clinic_id, created_at) where clinic_id is not null;

alter table payments.payout alter column party_id drop not null;
alter table payments.payout add column clinic_id text;
alter table payments.payout add constraint payout_payee check ((party_id is null) <> (clinic_id is null));
create index payout_clinic on payments.payout (clinic_id) where clinic_id is not null;

create table payments.clinic_agreement (
  agreement_id  text not null primary key check (agreement_id ~ '^cag_[A-Za-z0-9]+$'),
  clinic_id     text not null check (length(clinic_id) between 1 and 100),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  valid_from    date not null,
  valid_to      date check (valid_to > valid_from),
  created_by    text not null,
  created_at    timestamptz not null
);
create index clinic_agreement_clinic on payments.clinic_agreement (clinic_id, market);

-- An ending is added beside the agreement, once.
create table payments.clinic_agreement_ending (
  agreement_id  text not null primary key references payments.clinic_agreement (agreement_id),
  valid_to      date not null,
  ended_by      text not null,
  ended_at      timestamptz not null,
  reason        text not null check (length(reason) between 1 and 2000)
);

grant select, insert on payments.clinic_agreement, payments.clinic_agreement_ending to payments_service;

-- migrate:down

revoke all on payments.clinic_agreement, payments.clinic_agreement_ending from payments_service;
drop table payments.clinic_agreement_ending;
drop table payments.clinic_agreement;
delete from payments.outbox where payout_id in (select payout_id from payments.payout where clinic_id is not null);
delete from payments.payout_step where payout_id in (select payout_id from payments.payout where clinic_id is not null);
delete from payments.payout where clinic_id is not null;
drop index payments.payout_clinic;
alter table payments.payout drop constraint payout_payee;
alter table payments.payout drop column clinic_id;
alter table payments.payout alter column party_id set not null;
delete from payments.payout_step where payee_account_id in (select payee_account_id from payments.payee_account where clinic_id is not null);
delete from payments.payee_account where clinic_id is not null;
drop index payments.payee_account_clinic;
alter table payments.payee_account drop constraint payee_account_payee;
alter table payments.payee_account drop column clinic_id;
alter table payments.payee_account alter column party_id set not null;
