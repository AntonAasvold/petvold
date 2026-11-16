-- migrate:up

-- Webhooks to the insurer's systems (ADR 0033). A subscription is
-- configuration and changes by revision; its secrets are sealed by the
-- application with the installation's key. A delivery is one event for one
-- subscription, with the outcome of its latest attempt.
create schema webhooks;

create table webhooks.subscription (
  subscription_id         text not null primary key check (subscription_id ~ '^whs_[A-Za-z0-9]+$'),
  url                     text not null check (url ~ '^https?://'),
  event_types             jsonb not null check (jsonb_typeof(event_types) = 'array'),
  markets                 jsonb not null check (jsonb_typeof(markets) in ('array', 'string')),
  description             text,
  status                  text not null check (status in ('active', 'disabled')),
  disabled_reason         text,
  secret                  text not null check (secret like 'v1:%'),
  previous_secret         text,
  previous_secret_until   timestamptz,
  revision                int not null check (revision >= 1),
  created_by              text not null,
  created_at              timestamptz not null,
  changed_by              text not null,
  changed_at              timestamptz not null
);

create table webhooks.delivery (
  delivery_id       text not null primary key check (delivery_id ~ '^whd_[A-Za-z0-9]+$'),
  subscription_id   text not null references webhooks.subscription (subscription_id),
  event_id          text not null,
  event_type        text not null,
  event             jsonb not null,
  status            text not null check (status in ('pending', 'delivered', 'dead')),
  attempts          int not null check (attempts >= 0),
  next_attempt_at   timestamptz not null,
  last_attempt_at   timestamptz,
  last_status       int,
  last_error        text,
  delivered_at      timestamptz,
  created_at        timestamptz not null,
  -- The relay delivers at least once: one delivery per subscription and event.
  unique (subscription_id, event_id),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index delivery_due on webhooks.delivery (next_attempt_at) where status = 'pending';
create index delivery_subscription on webhooks.delivery (subscription_id, created_at);

grant usage on schema webhooks to webhooks_service;
grant select, insert, update on webhooks.subscription, webhooks.delivery to webhooks_service;

-- migrate:down

revoke all on webhooks.subscription, webhooks.delivery from webhooks_service;
revoke usage on schema webhooks from webhooks_service;
drop schema webhooks cascade;
