-- migrate:up
-- Petvold Demo's own database (docs/teknik/demotjanst.md), never Petvold's.
-- Migrations run as the owner. The service logs in as demo_service where that
-- role exists (the demo on a server); locally it may log in as the owner.

-- One row per event, by the CloudEvent's id. The body is kept as received.
create table event (
  id text primary key,
  seq bigint generated always as identity unique,
  type text not null,
  source text not null,
  subject text not null,
  market text,
  occurred_at timestamptz not null,
  sequence text,
  body jsonb not null,
  received_at timestamptz not null
);
create index event_occurred on event (occurred_at desc, seq desc);
create index event_type on event (type);
create index event_subject on event (subject);

-- One row per accepted call. More than one per event is a duplicate delivery.
create table delivery (
  id bigint generated always as identity primary key,
  webhook_id text not null,
  event_id text not null references event (id) on delete cascade,
  received_at timestamptz not null,
  headers jsonb not null
);
create index delivery_event on delivery (event_id);

-- Calls with a wrong signature, an old timestamp or a body that is not a CloudEvent.
create table rejected (
  id bigint generated always as identity primary key,
  webhook_id text,
  received_at timestamptz not null,
  reason text not null,
  headers jsonb not null,
  body text not null
);

-- The subscription's id and secret, and settings.
create table setting (
  key text primary key,
  value jsonb not null,
  changed_at timestamptz not null
);

do $$
begin
  if exists (select from pg_roles where rolname = 'demo_service') then
    grant select, insert, delete on event, delivery, rejected to demo_service;
    grant select, insert, update, delete on setting to demo_service;
  end if;
end $$;

-- migrate:down
drop table setting;
drop table rejected;
drop table delivery;
drop table event;
