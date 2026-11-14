-- migrate:up

-- The access module (ADR 0020): role settings as versions that never change.
-- The latest version is in force. The service role may only read and insert.
create schema access;

create table access.role_config (
  version     int primary key check (version >= 1),
  roles       jsonb not null check (jsonb_typeof(roles) = 'object'),
  changed_by  text not null check (changed_by <> ''),
  changed_at  timestamptz not null,
  reason      text not null check (btrim(reason) <> ''),
  created_at  timestamptz not null default now()
);

revoke all on access.role_config from public;
grant usage on schema access to access_service;
grant select, insert on access.role_config to access_service;

-- migrate:down

revoke select, insert on access.role_config from access_service;
revoke usage on schema access from access_service;
drop table access.role_config;
drop schema access;
