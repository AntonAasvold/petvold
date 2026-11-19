-- migrate:up

-- Runs (ADR 0037): leases so that one server at a time runs a job in a market,
-- and the history of every run. Results hold counts and ids, never personal
-- data. History older than 400 days is pruned by the scheduler.
create schema scheduling;

create table scheduling.lease (
  key         text primary key,
  holder      text not null,
  expires_at  timestamptz not null
);

create table scheduling.run (
  id             text primary key,
  job            text not null,
  market         text not null check (market ~ '^[A-Z]{2}$'),
  trigger        text not null check (trigger in ('schedule', 'manual', 'api')),
  started_by     text not null,
  started_at     timestamptz not null,
  scheduled_for  date,
  dry_run        boolean not null,
  status         text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  finished_at    timestamptz,
  result         jsonb,
  error          text,
  constraint run_finished check ((status = 'running') = (finished_at is null)),
  constraint run_scheduled_day check ((trigger = 'schedule') = (scheduled_for is not null))
);

-- The latest scheduled run of a job in a market, and the history newest first.
create index run_job_market on scheduling.run (job, market, started_at desc);
create index run_started on scheduling.run (started_at desc);

grant usage on schema scheduling to scheduling_service;
grant select, insert, update, delete on scheduling.lease to scheduling_service;
grant select, insert, delete on scheduling.run to scheduling_service;
grant update (status, finished_at, result, error) on scheduling.run to scheduling_service;

-- migrate:down

drop schema scheduling cascade;
