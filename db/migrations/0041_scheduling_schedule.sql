-- migrate:up

-- An installation's own schedule for a job (ADR 0037), changed with four eyes:
-- one person proposes a time or that the job is off, another approves. The
-- database keeps the rule itself: the approver is never the proposer, and a
-- job has at most one change waiting.
create table scheduling.job_setting (
  job          text primary key,
  at           text not null check (at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled      boolean not null,
  version      integer not null check (version >= 1),
  reason       text not null,
  proposed_by  text not null,
  approved_by  text not null,
  changed_at   timestamptz not null,
  constraint setting_four_eyes check (approved_by <> proposed_by)
);

create table scheduling.job_schedule_change (
  id               text primary key check (id ~ '^jsc_[A-Za-z0-9]+$'),
  job              text not null,
  at               text not null check (at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled          boolean not null,
  reason           text not null check (length(reason) between 1 and 2000),
  proposed_by      text not null,
  proposed_at      timestamptz not null,
  status           text not null check (status in ('pending', 'approved', 'rejected')),
  decided_by       text,
  decided_at       timestamptz,
  decision_reason  text,
  constraint change_decided check ((status = 'pending') = (decided_by is null and decided_at is null)),
  constraint change_four_eyes check (status <> 'approved' or decided_by <> proposed_by),
  constraint change_rejection_reason check (status <> 'rejected' or decision_reason is not null)
);

create unique index job_schedule_change_one_pending on scheduling.job_schedule_change (job) where status = 'pending';
create index job_schedule_change_job on scheduling.job_schedule_change (job, proposed_at desc);

grant select, insert, update on scheduling.job_setting to scheduling_service;
grant select, insert on scheduling.job_schedule_change to scheduling_service;
grant update (status, decided_by, decided_at, decision_reason) on scheduling.job_schedule_change to scheduling_service;

-- migrate:down

drop table scheduling.job_schedule_change;
drop table scheduling.job_setting;
