-- migrate:up

-- The animal register (ADR 0024). Details are append-only revisions,
-- identifiers are unique and never removed, and ownerships have a validity
-- period where only the end of the open one can be set.
create schema animals;

create table animals.animal_revision (
  animal_id    text not null check (animal_id ~ '^ani_[A-Za-z0-9]+$'),
  revision     int  not null check (revision >= 1),
  market       text not null check (market ~ '^[A-Z]{2}$'),
  species      text not null,
  breed        text,
  sex          text not null,
  neutered     boolean not null,
  name         text not null check (length(name) between 1 and 100),
  birth_date   date not null,
  deceased_on  date check (deceased_on >= birth_date),
  changed_by   text not null,
  changed_at   timestamptz not null,
  reason       text,
  primary key (animal_id, revision),
  constraint animal_revision_reason check (revision = 1 or reason is not null)
);

create function animals.check_animal_revision() returns trigger language plpgsql as $$
declare
  prev animals.animal_revision;
begin
  if new.revision > 1 then
    select * into prev from animals.animal_revision where animal_id = new.animal_id and revision = new.revision - 1;
    if not found then
      raise exception 'Revision % of animal % has no previous revision', new.revision, new.animal_id;
    end if;
    if (new.market, new.species) is distinct from (prev.market, prev.species) then
      raise exception 'The market and species of animal % never change', new.animal_id;
    end if;
  end if;
  return new;
end $$;

create trigger animal_revision_checked
  before insert on animals.animal_revision
  for each row execute function animals.check_animal_revision();

create table animals.animal_identifier (
  type       text not null check (type in ('microchip', 'registration', 'passport')),
  value      text not null check (value <> ''),
  animal_id  text not null,
  added_by   text not null,
  added_at   timestamptz not null,
  primary key (type, value),
  constraint microchip_digits check (type <> 'microchip' or value ~ '^\d{15}$')
);
create index animal_identifier_animal on animals.animal_identifier (animal_id);

create table animals.ownership (
  animal_id    text not null,
  seq          int  not null check (seq >= 1),
  party_id     text not null check (party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  valid_from   date not null,
  valid_to     date check (valid_to > valid_from),
  recorded_by  text not null,
  recorded_at  timestamptz not null,
  reason       text,
  primary key (animal_id, seq)
);
create index ownership_party on animals.ownership (party_id);
-- At most one open ownership per animal.
create unique index ownership_one_open on animals.ownership (animal_id) where valid_to is null;

-- A new ownership is the next in sequence and starts the day the previous one ended.
-- Only the open ownership's end can be set, once.
create function animals.check_ownership() returns trigger language plpgsql as $$
declare
  prev animals.ownership;
begin
  if tg_op = 'INSERT' then
    if new.seq > 1 then
      select * into prev from animals.ownership where animal_id = new.animal_id and seq = new.seq - 1;
      if not found or prev.valid_to is distinct from new.valid_from then
        raise exception 'Ownership % of animal % must start the day ownership % ended', new.seq, new.animal_id, new.seq - 1;
      end if;
    end if;
    return new;
  end if;
  if old.valid_to is not null
     or (new.animal_id, new.seq, new.party_id, new.valid_from, new.recorded_by, new.recorded_at, new.reason)
        is distinct from (old.animal_id, old.seq, old.party_id, old.valid_from, old.recorded_by, old.recorded_at, old.reason) then
    raise exception 'Only the end of the open ownership can be set';
  end if;
  return new;
end $$;

create trigger ownership_checked
  before insert or update on animals.ownership
  for each row execute function animals.check_ownership();

revoke all on animals.animal_revision, animals.animal_identifier, animals.ownership from public;
grant usage on schema animals to animals_service;
grant select, insert on animals.animal_revision, animals.animal_identifier to animals_service;
grant select, insert on animals.ownership to animals_service;
grant update (valid_to) on animals.ownership to animals_service;

-- migrate:down

revoke all on animals.animal_revision, animals.animal_identifier, animals.ownership from animals_service;
revoke usage on schema animals from animals_service;
drop table animals.ownership;
drop table animals.animal_identifier;
drop table animals.animal_revision;
drop function animals.check_ownership();
drop function animals.check_animal_revision();
drop schema animals;
