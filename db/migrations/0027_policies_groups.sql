-- migrate:up

-- Policy groups for a litter or a household (ADR 0007). A group never changes;
-- a membership can only be ended, once.
create table policies.policy_group (
  group_id          text not null primary key check (group_id ~ '^pgr_[A-Za-z0-9]+$'),
  market            text not null check (market ~ '^[A-Z]{2}$'),
  kind              text not null check (kind in ('litter', 'household')),
  holder_party_id   text not null check (holder_party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  litter_id         text,
  created_by        text not null,
  created_at        timestamptz not null,
  check ((kind = 'litter') = (litter_id is not null))
);
create index policy_group_holder on policies.policy_group (holder_party_id);

create table policies.group_membership (
  group_id    text not null references policies.policy_group (group_id),
  policy_id   text not null references policies.policy (policy_id),
  from_date   date not null,
  to_date     date check (to_date >= from_date),
  added_by    text not null,
  added_at    timestamptz not null,
  ended_by    text,
  ended_at    timestamptz,
  end_reason  text,
  primary key (group_id, policy_id, from_date),
  check ((to_date is null) = (ended_by is null) and (to_date is null) = (ended_at is null))
);
-- A policy is in one group at a time.
create unique index group_membership_one_open on policies.group_membership (policy_id) where to_date is null;

create function policies.check_membership_update() returns trigger language plpgsql as $$
begin
  if old.to_date is not null
     or (new.group_id, new.policy_id, new.from_date, new.added_by, new.added_at)
        is distinct from (old.group_id, old.policy_id, old.from_date, old.added_by, old.added_at) then
    raise exception 'Only the end of an open membership can be set, once';
  end if;
  return new;
end $$;

create trigger group_membership_checked
  before update on policies.group_membership
  for each row execute function policies.check_membership_update();

revoke all on policies.policy_group, policies.group_membership from public;
grant select, insert on policies.policy_group, policies.group_membership to policies_service;
grant update (to_date, ended_by, ended_at, end_reason) on policies.group_membership to policies_service;

-- migrate:down

revoke all on policies.policy_group, policies.group_membership from policies_service;
drop table policies.group_membership;
drop function policies.check_membership_update();
drop table policies.policy_group;
