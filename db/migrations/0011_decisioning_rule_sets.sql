-- migrate:up

-- The decisioning module (ADR 0018, 0021): rule series with numbered versions.
-- draft -> in_review -> published -> retired. A published version never
-- changes, apart from being retired.
create schema decisioning;

create table decisioning.rule_set_version (
  series             text not null check (series ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
  version            int  not null check (version >= 1),
  status             text not null check (status in ('draft', 'in_review', 'published', 'retired')),
  content            jsonb not null check (jsonb_typeof(content) = 'object'),
  calculation_model  text not null check (calculation_model <> ''),
  effective_from     date not null,
  checksum           text,
  revision           int  not null check (revision >= 1),
  created_by         text not null,
  created_at         timestamptz not null,
  submitted_by       text,
  submitted_at       timestamptz,
  published_by       text,
  published_at       timestamptz,
  retired_by         text,
  retired_at         timestamptz,
  note               text,
  primary key (series, version),
  constraint rule_set_reviewed check (status = 'draft' or (checksum is not null and submitted_by is not null and submitted_at is not null)),
  constraint rule_set_published check (status not in ('published', 'retired') or (published_by is not null and published_at is not null)),
  constraint rule_set_four_eyes check (published_by is null or published_by <> submitted_by),
  constraint rule_set_retired check ((status = 'retired') = (retired_by is not null and retired_at is not null))
);

-- One published version per series and date, so the version in force is unambiguous.
create unique index rule_set_one_published_per_date on decisioning.rule_set_version (series, effective_from) where status = 'published';

-- Published and retired versions keep their content. Only published -> retired is allowed.
create function decisioning.check_rule_set_change() returns trigger language plpgsql as $$
begin
  if old.status in ('published', 'retired') then
    if old.status = 'retired' or new.status <> 'retired'
       or (new.content, new.calculation_model, new.effective_from, new.checksum, new.submitted_by, new.published_by)
          is distinct from (old.content, old.calculation_model, old.effective_from, old.checksum, old.submitted_by, old.published_by) then
      raise exception 'Rule set %@% is % and can only be retired', old.series, old.version, old.status;
    end if;
  end if;
  if old.status = 'in_review' and new.status in ('in_review', 'published')
     and (new.content, new.calculation_model, new.effective_from) is distinct from (old.content, old.calculation_model, old.effective_from) then
    raise exception 'Rule set %@% is locked for review', old.series, old.version;
  end if;
  return new;
end $$;

create trigger rule_set_change_checked
  before update on decisioning.rule_set_version
  for each row execute function decisioning.check_rule_set_change();

revoke all on decisioning.rule_set_version from public;
grant usage on schema decisioning to decisioning_service;
grant select, insert, update on decisioning.rule_set_version to decisioning_service;

-- migrate:down

revoke select, insert, update on decisioning.rule_set_version from decisioning_service;
revoke usage on schema decisioning from decisioning_service;
drop table decisioning.rule_set_version;
drop function decisioning.check_rule_set_change();
drop schema decisioning;
