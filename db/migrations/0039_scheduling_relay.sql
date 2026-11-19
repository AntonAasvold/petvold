-- migrate:up

-- The relay's dead letters (ADR 0037): events set aside after too many
-- attempts. They were kept in memory and lost at a restart; now they stay until
-- an operator sends the event again. Ids and the error only, never the event.
create table scheduling.relay_dead_letter (
  source      text not null,
  event_id    text not null,
  attempts    integer not null check (attempts >= 1),
  last_error  text not null,
  dead_at     timestamptz not null,
  primary key (source, event_id)
);

grant select, insert, delete on scheduling.relay_dead_letter to scheduling_service;
grant update (attempts, last_error, dead_at) on scheduling.relay_dead_letter to scheduling_service;

-- migrate:down

drop table scheduling.relay_dead_letter;
