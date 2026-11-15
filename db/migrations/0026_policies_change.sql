-- migrate:up

-- A change of the choices during a term (ADR 0029). The term never changes; a
-- change is its own row from a day, and the versions from that day point at it.
create table policies.term_change (
  policy_id          text not null,
  term_no            int  not null,
  change_no          int  not null check (change_no >= 1),
  from_date          date not null,
  vet_care           jsonb not null,
  deductible_option  text not null,
  premium            bigint not null check (premium >= 0),
  transaction_id     text not null references policies.policy_transaction (transaction_id),
  primary key (policy_id, term_no, change_no),
  foreign key (policy_id, term_no) references policies.term (policy_id, term_no)
);

alter table policies.policy_version
  add column change_no int,
  add foreign key (policy_id, term_no, change_no) references policies.term_change (policy_id, term_no, change_no);

-- The trigger that guards versions must also keep change_no.
create or replace function policies.check_version_update() returns trigger language plpgsql as $$
begin
  if old.sys_to is not null
     or (new.version_id, new.policy_id, new.animal_id, new.valid_from, new.valid_to, new.sys_from,
         new.policyholder_party_id, new.status, new.term_no, new.change_no, new.transaction_id)
        is distinct from
        (old.version_id, old.policy_id, old.animal_id, old.valid_from, old.valid_to, old.sys_from,
         old.policyholder_party_id, old.status, old.term_no, old.change_no, old.transaction_id) then
    raise exception 'Only the end of a version in system time can be set, once';
  end if;
  return new;
end $$;

alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate', 'renew', 'transfer', 'change'));
alter table policies.policy_transaction
  add column change jsonb,
  add constraint policy_transaction_change check ((type = 'change') = (change is not null));

revoke all on policies.term_change from public;
grant select, insert on policies.term_change to policies_service;

-- migrate:down

-- A rollback cannot keep changes: drop their versions and make the ones they superseded current again.
alter table policies.policy_version disable trigger policy_version_checked;
delete from policies.policy_version where transaction_id in (select transaction_id from policies.policy_transaction where type = 'change');
delete from policies.policy_version where change_no is not null;
update policies.policy_version v set sys_to = null
 where sys_to is not null
   and not exists (select 1 from policies.policy_version n where n.policy_id = v.policy_id and n.sys_to is null
                   and daterange(n.valid_from, n.valid_to) && daterange(v.valid_from, v.valid_to));
alter table policies.policy_version enable trigger policy_version_checked;
alter table policies.policy_version drop column change_no;
create or replace function policies.check_version_update() returns trigger language plpgsql as $$
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
revoke all on policies.term_change from policies_service;
drop table policies.term_change;
delete from policies.policy_transaction where type = 'change';
alter table policies.policy_transaction drop constraint policy_transaction_change, drop column change;
alter table policies.policy_transaction drop constraint policy_transaction_type_check;
alter table policies.policy_transaction add constraint policy_transaction_type_check check (type in ('issue', 'cancel', 'reinstate', 'renew', 'transfer'));
