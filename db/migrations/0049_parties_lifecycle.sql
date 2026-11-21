-- migrate:up

-- The party's life cycle (ADR 0039): identifiers removed with a reason,
-- restriction set and lifted directly, and parties ended and reopened.

-- Identifiers get an id, since a personal number is shown masked and never put
-- in an address. A removed identifier stays as history and no longer counts.
alter table parties.party_identifier add column identifier_id text;
update parties.party_identifier set identifier_id = 'pid_' || replace(gen_random_uuid()::text, '-', '') where identifier_id is null;
alter table parties.party_identifier alter column identifier_id set not null;
alter table parties.party_identifier add constraint party_identifier_id_format check (identifier_id ~ '^pid_[A-Za-z0-9]+$');
alter table parties.party_identifier add column removed_by text;
alter table parties.party_identifier add column removed_at timestamptz;
alter table parties.party_identifier add column removal_reason text;
alter table parties.party_identifier add constraint party_identifier_removal check (
  (removed_at is null and removed_by is null and removal_reason is null) or (removed_at is not null and removed_by is not null and removal_reason is not null)
);
alter table parties.party_identifier drop constraint party_identifier_pkey;
alter table parties.party_identifier add primary key (identifier_id);
create unique index party_identifier_active on parties.party_identifier (type, country, value) where removed_at is null;

-- The only change to an identifier: removing it, once.
create function parties.check_identifier_update() returns trigger language plpgsql as $$
begin
  if old.removed_at is not null then
    raise exception 'Identifier % is removed already', old.identifier_id;
  end if;
  if (new.identifier_id, new.type, new.country, new.value, new.party_id, new.added_by, new.added_at)
     is distinct from (old.identifier_id, old.type, old.country, old.value, old.party_id, old.added_by, old.added_at) then
    raise exception 'Only the removal of identifier % may be recorded', old.identifier_id;
  end if;
  return new;
end $$;
create trigger party_identifier_update_checked before update on parties.party_identifier for each row execute function parties.check_identifier_update();
grant update (removed_by, removed_at, removal_reason) on parties.party_identifier to parties_service;

-- Restriction (GDPR article 18) set or lifted directly. The latest event, here
-- or a rejected erasure request, is in force.
create table parties.restriction (
  restriction_id  text not null primary key check (restriction_id ~ '^prs_[A-Za-z0-9]+$'),
  party_id        text not null,
  action          text not null check (action in ('restrict', 'lift')),
  until           date,
  reason          text,
  decided_by      text not null,
  decided_at      timestamptz not null,
  check ((action = 'restrict') = (until is not null))
);
create index restriction_party on parties.restriction (party_id, decided_at);

-- A party ended (deceased, dissolved) or reopened. The latest event is in force.
create table parties.party_status (
  status_id   text not null primary key check (status_id ~ '^pst_[A-Za-z0-9]+$'),
  party_id    text not null,
  action      text not null check (action in ('end', 'reopen')),
  cause       text check (cause in ('deceased', 'dissolved', 'other')),
  ended_on    date,
  reason      text,
  decided_by  text not null,
  decided_at  timestamptz not null,
  check ((action = 'end') = (cause is not null and ended_on is not null))
);
create index party_status_party on parties.party_status (party_id, decided_at);

revoke all on parties.restriction, parties.party_status from public;
grant select, insert on parties.restriction, parties.party_status to parties_service;

-- Anonymization also removes the reasons, which may hold personal data.
create or replace function parties.anonymize(p_party_id text) returns void
  language plpgsql security definer set search_path = pg_catalog, parties as $$
begin
  if not exists (
    select 1 from parties.erasure_request r join parties.erasure_decision d using (request_id)
    where r.party_id = p_party_id and d.outcome = 'approved'
  ) then
    raise exception 'Party % has no approved erasure request', p_party_id;
  end if;
  update parties.party_revision
     set given_name = null, family_name = null, birth_date = null, name = null, email = null,
         phone = null, address = null, language = null, reason = null, anonymized = true
   where party_id = p_party_id;
  delete from parties.party_identifier where party_id = p_party_id;
  update parties.restriction set reason = null where party_id = p_party_id;
  update parties.party_status set reason = null where party_id = p_party_id;
end $$;

-- migrate:down

create or replace function parties.anonymize(p_party_id text) returns void
  language plpgsql security definer set search_path = pg_catalog, parties as $$
begin
  if not exists (
    select 1 from parties.erasure_request r join parties.erasure_decision d using (request_id)
    where r.party_id = p_party_id and d.outcome = 'approved'
  ) then
    raise exception 'Party % has no approved erasure request', p_party_id;
  end if;
  update parties.party_revision
     set given_name = null, family_name = null, birth_date = null, name = null, email = null,
         phone = null, address = null, language = null, reason = null, anonymized = true
   where party_id = p_party_id;
  delete from parties.party_identifier where party_id = p_party_id;
end $$;
revoke all on parties.restriction, parties.party_status from parties_service;
drop table parties.party_status;
drop table parties.restriction;
revoke update (removed_by, removed_at, removal_reason) on parties.party_identifier from parties_service;
drop trigger party_identifier_update_checked on parties.party_identifier;
drop function parties.check_identifier_update();
delete from parties.party_identifier where removed_at is not null;
drop index parties.party_identifier_active;
alter table parties.party_identifier drop constraint party_identifier_pkey;
alter table parties.party_identifier add primary key (type, country, value);
alter table parties.party_identifier drop constraint party_identifier_removal;
alter table parties.party_identifier drop column removal_reason;
alter table parties.party_identifier drop column removed_at;
alter table parties.party_identifier drop column removed_by;
alter table parties.party_identifier drop constraint party_identifier_id_format;
alter table parties.party_identifier drop column identifier_id;
