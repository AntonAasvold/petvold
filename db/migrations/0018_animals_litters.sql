-- migrate:up

-- Litters (ADR 0027): animals born together. A litter and its members never change.
create table animals.litter (
  litter_id         text not null primary key check (litter_id ~ '^lit_[A-Za-z0-9]+$'),
  market            text not null check (market ~ '^[A-Z]{2}$'),
  species           text not null,
  birth_date        date not null,
  dam_id            text,
  sire_id           text,
  breeder_party_id  text not null check (breeder_party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  registered_by     text not null,
  registered_at     timestamptz not null,
  check (dam_id is null or sire_id is null or dam_id <> sire_id)
);

-- An animal is born in at most one litter.
create table animals.litter_member (
  animal_id  text not null primary key,
  litter_id  text not null references animals.litter (litter_id),
  position   int  not null check (position >= 1),
  unique (litter_id, position)
);

revoke all on animals.litter, animals.litter_member from public;
grant select, insert on animals.litter, animals.litter_member to animals_service;

-- migrate:down

revoke all on animals.litter, animals.litter_member from animals_service;
drop table animals.litter_member;
drop table animals.litter;
