-- migrate:up

-- Webhooks, step 3 (ADR 0033): a person can send a dead delivery again, a
-- subscription that has failed for five days is disabled, and the data of
-- delivered and dead events is removed after 30 days.
alter table webhooks.delivery
  add column retried_at timestamptz,
  add column pruned_at timestamptz,
  add constraint delivery_pruned check (pruned_at is null or status in ('delivered', 'dead'));
alter table webhooks.subscription add column failing_since timestamptz;

-- migrate:down

alter table webhooks.subscription drop column failing_since;
alter table webhooks.delivery drop constraint delivery_pruned, drop column pruned_at, drop column retried_at;
