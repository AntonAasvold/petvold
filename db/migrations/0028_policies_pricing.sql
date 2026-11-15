-- migrate:up

-- How the premium was priced (ADR 0030): the tariff's result and its inputs,
-- with the zone instead of the postal code, and a manual price's reason.
alter table policies.term add column pricing jsonb;
alter table policies.term_change add column pricing jsonb;

-- migrate:down

alter table policies.term_change drop column pricing;
alter table policies.term drop column pricing;
