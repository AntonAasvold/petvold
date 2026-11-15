-- migrate:up

-- Policies (ADR 0006, 0029). Policies, terms and transactions never change.
-- Versions are bitemporal: only sys_to may be set, once, to supersede one.
create schema policies;

create table policies.policy (
  policy_id       text not null primary key check (policy_id ~ '^pol_[A-Za-z0-9]+$'),
  market          text not null check (market ~ '^[A-Z]{2}$'),
  animal_id       text not null,
  inception_date  date not null,
  created_by      text not null,
  created_at      timestamptz not null
);
create index policy_animal on policies.policy (animal_id);

create table policies.policy_transaction (
  transaction_id  text not null primary key check (transaction_id ~ '^ptx_[A-Za-z0-9]+$'),
  policy_id       text not null references policies.policy (policy_id),
  type            text not null check (type in ('issue')),
  steps           jsonb not null check (jsonb_typeof(steps) = 'array'),
  requested_by    text not null,
  requested_at    timestamptz not null
);

create table policies.term (
  policy_id          text not null references policies.policy (policy_id),
  term_no            int  not null check (term_no >= 1),
  start_date         date not null,
  end_date           date not null check (end_date > start_date),
  product_version    text not null,
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  vet_care           jsonb not null,
  deductible_option  text not null,
  premium            bigint not null check (premium >= 0),
  riders             jsonb not null default '[]',
  transaction_id     text not null references policies.policy_transaction (transaction_id),
  primary key (policy_id, term_no)
);

create table policies.policy_version (
  version_id         text not null primary key check (version_id ~ '^pv_[A-Za-z0-9]+$'),
  policy_id          text not null references policies.policy (policy_id),
  -- Copied from the policy so that the database can stop two policies for one animal.
  animal_id          text not null,
  valid_from         date not null,
  valid_to           date not null check (valid_to > valid_from),
  sys_from           timestamptz not null,
  sys_to             timestamptz check (sys_to > sys_from),
  policyholder_party_id text not null check (policyholder_party_id ~ '^pty_[A-Za-z0-9]{1,64}$'),
  status             text not null check (status in ('active', 'cancelled')),
  term_no            int  not null,
  transaction_id     text not null references policies.policy_transaction (transaction_id),
  foreign key (policy_id, term_no) references policies.term (policy_id, term_no),
  -- What is known now never has two versions of a policy for the same day …
  exclude using gist (policy_id with =, daterange(valid_from, valid_to) with &&) where (sys_to is null),
  -- … and an animal is never insured twice for the same day.
  exclude using gist (animal_id with =, daterange(valid_from, valid_to) with &&) where (sys_to is null and status = 'active')
);
create index policy_version_policyholder on policies.policy_version (policyholder_party_id) where sys_to is null;

-- Only sys_to may be set, once.
create function policies.check_version_update() returns trigger language plpgsql as $$
begin
  if old.sys_to is not null
     or (new.version_id, new.policy_id, new.animal_id, new.valid_from, new.valid_to, new.sys_from,
         new.policyholder_party_id, new.status, new.term_no, new.transaction_id)
        is distinct from
        (old.version_id, old.policy_id, old.animal_id, old.valid_from, old.valid_to, old.sys_from,
         old.policyholder_party_id, old.status, old.term_no, old.transaction_id) then
    raise exception 'Only the end of a version in system time can be set, once';
  end if;
  return new;
end $$;

create trigger policy_version_checked
  before update on policies.policy_version
  for each row execute function policies.check_version_update();

revoke all on all tables in schema policies from public;
grant usage on schema policies to policies_service;
grant select, insert on policies.policy, policies.policy_transaction, policies.term, policies.policy_version to policies_service;
grant update (sys_to) on policies.policy_version to policies_service;

-- migrate:down

revoke all on all tables in schema policies from policies_service;
revoke usage on schema policies from policies_service;
drop table policies.policy_version;
drop function policies.check_version_update();
drop table policies.term;
drop table policies.policy_transaction;
drop table policies.policy;
drop schema policies;
