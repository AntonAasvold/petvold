-- migrate:up

-- Pausing and resuming jobs (ADR 0037). A paused job is skipped by the
-- scheduler in every market until it is resumed; "Run now" still works. Every
-- pause and resume is kept with who, when and why, and is never changed.
create table scheduling.job_pause (
  job        text primary key,
  paused_by  text not null,
  paused_at  timestamptz not null,
  reason     text not null check (length(reason) between 1 and 2000)
);

create table scheduling.job_control (
  id       text primary key,
  job      text not null,
  action   text not null check (action in ('pause', 'resume')),
  by_whom  text not null,
  at       timestamptz not null,
  reason   text not null check (length(reason) between 1 and 2000)
);

create index job_control_job on scheduling.job_control (job, at desc);

grant select, insert, delete on scheduling.job_pause to scheduling_service;
grant select, insert on scheduling.job_control to scheduling_service;

-- migrate:down

drop table scheduling.job_control;
drop table scheduling.job_pause;
