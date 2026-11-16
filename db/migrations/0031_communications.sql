-- migrate:up

-- Notices to the customer (ADR 0032). A notice is what Petvold decided must be
-- sent; the insurer's document system makes and sends the document and reports
-- each attempt as a delivery. Neither ever changes.
create schema communications;

create table communications.notice (
  notice_id           text not null primary key check (notice_id ~ '^ntc_[A-Za-z0-9]+$'),
  type                text not null check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined')),
  schema              text not null,
  market              text not null check (market ~ '^[A-Z]{2}$'),
  recipient_party_id  text not null check (recipient_party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  language            text not null check (language ~ '^[a-z]{2}$'),
  policy_id           text,
  application_id      text,
  source_event_id     text not null,
  source_event_type   text not null,
  source_occurred_at  timestamptz not null,
  legal_basis         jsonb not null check (jsonb_typeof(legal_basis) = 'array'),
  due_by              date not null,
  content             jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at          timestamptz not null,
  check (policy_id is not null or application_id is not null),
  -- The relay delivers at least once: one notice of a type per event.
  unique (source_event_id, type)
);
create index notice_policy on communications.notice (policy_id);
create index notice_application on communications.notice (application_id);
create index notice_party on communications.notice (recipient_party_id);
create index notice_due on communications.notice (due_by);

create table communications.delivery (
  delivery_id   text not null primary key check (delivery_id ~ '^ndl_[A-Za-z0-9]+$'),
  notice_id     text not null references communications.notice (notice_id),
  outcome       text not null check (outcome in ('sent', 'failed')),
  channel       text check (channel in ('letter', 'email', 'digital-mailbox', 'customer-portal')),
  sent_at       timestamptz,
  document_id   text,
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  reason        text,
  reported_by   text not null,
  reported_at   timestamptz not null,
  check (
    (outcome = 'sent' and channel is not null and sent_at is not null and document_id is not null and sha256 is not null and reason is null)
    or (outcome = 'failed' and reason is not null and sent_at is null and document_id is null and sha256 is null)
  )
);
create index delivery_notice on communications.delivery (notice_id, reported_at);

grant usage on schema communications to communications_service;
grant select, insert on communications.notice, communications.delivery to communications_service;

-- migrate:down

revoke all on communications.notice, communications.delivery from communications_service;
revoke usage on schema communications from communications_service;
drop schema communications cascade;
