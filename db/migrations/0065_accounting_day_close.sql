-- migrate:up

-- The day close and the chart of accounts (ADR 0040 steg 6b). A closed day
-- never changes: a verification for it that comes later is booked on the first
-- open day, with its event's own day kept.
alter table accounting.verification add column event_date date;

create table accounting.day_close (
  market              text not null check (market ~ '^[A-Z]{2}$'),
  day                 date not null,
  closed_at           timestamptz not null,
  closed_by           text not null,
  verification_count  integer not null check (verification_count >= 0),
  totals              jsonb not null check (jsonb_typeof(totals) = 'array'),
  chart_version       integer not null check (chart_version >= 0),
  unmapped            jsonb not null check (jsonb_typeof(unmapped) = 'array'),
  csv_sha256          text not null check (csv_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (market, day)
);

-- A version of the chart of accounts (ADR 0020): never changed, the newest in force.
create table accounting.chart_version (
  version     integer not null primary key check (version >= 1),
  markets     jsonb not null check (jsonb_typeof(markets) = 'object'),
  changed_by  text not null,
  changed_at  timestamptz not null,
  reason      text not null check (length(reason) between 1 and 2000)
);

create table accounting.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  type          text not null check (type in ('accounting.day_closed')),
  market        text not null check (market ~ '^[A-Z]{2}$'),
  day           date not null,
  occurred_at   timestamptz not null,
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  published_at  timestamptz
);
create index outbox_pending on accounting.outbox (seq) where published_at is null;

grant select, insert on accounting.day_close, accounting.chart_version, accounting.outbox to accounting_service;
grant update (published_at) on accounting.outbox to accounting_service;

-- migrate:down

revoke all on accounting.day_close, accounting.chart_version, accounting.outbox from accounting_service;
drop table accounting.outbox;
drop table accounting.chart_version;
drop table accounting.day_close;
alter table accounting.verification drop column event_date;
