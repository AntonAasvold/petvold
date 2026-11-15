-- migrate:up

-- Retention per market as versioned settings (ADR 0028). Append-only.
create table parties.retention_settings (
  version     int primary key check (version >= 1),
  markets     jsonb not null check (jsonb_typeof(markets) = 'object'),
  changed_by  text not null check (changed_by <> ''),
  changed_at  timestamptz not null,
  reason      text not null check (btrim(reason) <> '')
);

revoke all on parties.retention_settings from public;
grant select, insert on parties.retention_settings to parties_service;

-- migrate:down

revoke all on parties.retention_settings from parties_service;
drop table parties.retention_settings;
