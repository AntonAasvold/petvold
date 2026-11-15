-- migrate:up

-- Events from the animal register (ADR 0008, 0029): a change of owner and a
-- death, written in the same transaction as the change.
create table animals.outbox (
  seq           bigint generated always as identity primary key,
  event_id      text not null unique,
  animal_id     text not null,
  type          text not null check (type in ('animal.ownership_changed', 'animal.died')),
  occurred_at   timestamptz not null,
  data          jsonb not null,
  published_at  timestamptz
);
create index outbox_pending on animals.outbox (seq) where published_at is null;

revoke all on animals.outbox from public;
grant select, insert on animals.outbox to animals_service;
grant update (published_at) on animals.outbox to animals_service;

-- migrate:down

revoke all on animals.outbox from animals_service;
drop table animals.outbox;
