-- migrate:up

-- Parties (ADR 0026): persons and organizations. Details are append-only
-- revisions; identifiers are unique per country and never removed.
create schema parties;

create table parties.party_revision (
  party_id     text not null check (party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  revision     int  not null check (revision >= 1),
  kind         text not null check (kind in ('person', 'organization')),
  market       text not null check (market ~ '^[A-Z]{2}$'),
  given_name   text,
  family_name  text,
  birth_date   date,
  name         text,
  email        text,
  phone        text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  address      jsonb,
  language     text check (language ~ '^[a-z]{2}$'),
  changed_by   text not null,
  changed_at   timestamptz not null,
  reason       text,
  primary key (party_id, revision),
  constraint party_revision_reason check (revision = 1 or reason is not null),
  constraint party_revision_names check (
    (kind = 'person' and given_name is not null and family_name is not null and name is null)
    or (kind = 'organization' and name is not null and given_name is null and family_name is null and birth_date is null)
  )
);

create function parties.check_party_revision() returns trigger language plpgsql as $$
declare
  prev parties.party_revision;
begin
  if new.revision > 1 then
    select * into prev from parties.party_revision where party_id = new.party_id and revision = new.revision - 1;
    if not found then
      raise exception 'Revision % of party % has no previous revision', new.revision, new.party_id;
    end if;
    if (new.kind, new.market) is distinct from (prev.kind, prev.market) then
      raise exception 'The kind and market of party % never change', new.party_id;
    end if;
  end if;
  return new;
end $$;

create trigger party_revision_checked
  before insert on parties.party_revision
  for each row execute function parties.check_party_revision();

create table parties.party_identifier (
  type       text not null check (type in ('personal-number', 'organization-number')),
  country    text not null check (country ~ '^[A-Z]{2}$'),
  value      text not null check (value ~ '^[A-Z0-9]{4,30}$'),
  party_id   text not null,
  added_by   text not null,
  added_at   timestamptz not null,
  primary key (type, country, value)
);
create index party_identifier_party on parties.party_identifier (party_id);

revoke all on parties.party_revision, parties.party_identifier from public;
grant usage on schema parties to parties_service;
grant select, insert on parties.party_revision, parties.party_identifier to parties_service;

-- migrate:down

revoke all on parties.party_revision, parties.party_identifier from parties_service;
revoke usage on schema parties from parties_service;
drop table parties.party_identifier;
drop table parties.party_revision;
drop function parties.check_party_revision();
drop schema parties;
