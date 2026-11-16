-- migrate:up

-- The communications module's events (ADR 0008, 0033): a notice made, sent or
-- failed, written in the same transaction as the change.
create table communications.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  type          text not null check (type in ('notice.created', 'notice.delivered', 'notice.failed')),
  notice_id     text not null references communications.notice (notice_id),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  occurred_at   timestamptz not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  published_at  timestamptz
);
create index outbox_pending on communications.outbox (seq) where published_at is null;

grant select, insert on communications.outbox to communications_service;
grant update (published_at) on communications.outbox to communications_service;

-- migrate:down

revoke all on communications.outbox from communications_service;
drop table communications.outbox;
