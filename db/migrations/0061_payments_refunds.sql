-- migrate:up

-- Refunds of a payer's credit (ADR 0040 steg 5a) are paid out like a claim's
-- payout order: a payout has a purpose, and only a claim's has a claim.
alter table payments.payout add column purpose text not null default 'claim' check (purpose in ('claim', 'premium-refund'));
alter table payments.payout alter column purpose drop default;
alter table payments.payout alter column claim_id drop not null;
alter table payments.payout alter column decision_id drop not null;
alter table payments.payout alter column policy_id drop not null;
alter table payments.payout add constraint payout_claim check ((purpose = 'claim') = (claim_id is not null and decision_id is not null and policy_id is not null));

-- migrate:down

delete from payments.outbox where payout_id in (select payout_id from payments.payout where purpose <> 'claim');
delete from payments.payout_step where payout_id in (select payout_id from payments.payout where purpose <> 'claim');
delete from payments.payout where purpose <> 'claim';
alter table payments.payout drop constraint payout_claim;
alter table payments.payout alter column policy_id set not null;
alter table payments.payout alter column decision_id set not null;
alter table payments.payout alter column claim_id set not null;
alter table payments.payout drop column purpose;
