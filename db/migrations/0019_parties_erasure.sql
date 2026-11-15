-- migrate:up

-- Erasure (ADR 0028): anonymization with four eyes. The function
-- parties.anonymize is the only way to overwrite history; the service role
-- may run it but still cannot update or delete rows itself.
alter table parties.party_revision add column anonymized boolean not null default false;

alter table parties.party_revision drop constraint party_revision_names;
alter table parties.party_revision add constraint party_revision_names check (
  anonymized
  or (kind = 'person' and given_name is not null and family_name is not null and name is null)
  or (kind = 'organization' and name is not null and given_name is null and family_name is null and birth_date is null)
);
alter table parties.party_revision drop constraint party_revision_reason;
alter table parties.party_revision add constraint party_revision_reason check (revision = 1 or reason is not null or anonymized);
alter table parties.party_revision add constraint party_revision_anonymized check (
  not anonymized
  or (given_name is null and family_name is null and birth_date is null and name is null and email is null
      and phone is null and address is null and language is null and reason is null)
);

create table parties.erasure_request (
  request_id    text not null primary key check (request_id ~ '^era_[A-Za-z0-9]+$'),
  party_id      text not null,
  market        text not null check (market ~ '^[A-Z]{2}$'),
  basis         text not null check (basis in ('subject-request', 'retention-expired')),
  reason        text not null check (reason <> ''),
  requested_by  text not null,
  requested_at  timestamptz not null
);
create index erasure_request_party on parties.erasure_request (party_id);

create table parties.erasure_decision (
  request_id      text not null primary key references parties.erasure_request (request_id),
  outcome         text not null check (outcome in ('approved', 'rejected')),
  reason          text,
  restrict_until  date,
  decided_by      text not null,
  decided_at      timestamptz not null,
  check (outcome = 'rejected' or restrict_until is null)
);

-- Four eyes: the one who asked cannot approve.
create function parties.check_erasure_decision() returns trigger language plpgsql as $$
begin
  if new.outcome = 'approved'
     and new.decided_by = (select requested_by from parties.erasure_request where request_id = new.request_id) then
    raise exception 'Four eyes: the requester of erasure % cannot approve it', new.request_id;
  end if;
  return new;
end $$;

create trigger erasure_decision_checked
  before insert on parties.erasure_decision
  for each row execute function parties.check_erasure_decision();

-- Removes the party's personal data from every revision and its identifiers.
-- Only with an approved request, so a bug or a stolen service password cannot
-- erase anyone without a recorded decision.
create function parties.anonymize(p_party_id text) returns void
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

revoke all on parties.erasure_request, parties.erasure_decision from public;
grant select, insert on parties.erasure_request, parties.erasure_decision to parties_service;
revoke all on function parties.anonymize(text) from public;
grant execute on function parties.anonymize(text) to parties_service;

-- migrate:down

revoke all on function parties.anonymize(text) from parties_service;
drop function parties.anonymize(text);
revoke all on parties.erasure_request, parties.erasure_decision from parties_service;
drop table parties.erasure_decision;
drop table parties.erasure_request;
drop function parties.check_erasure_decision();
alter table parties.party_revision drop constraint party_revision_anonymized;
-- Anonymized revisions cannot exist without the erasure tables; a rollback drops them too.
delete from parties.party_identifier i
 where exists (select 1 from parties.party_revision r where r.party_id = i.party_id and r.anonymized);
delete from parties.party_revision where anonymized;
alter table parties.party_revision drop constraint party_revision_reason;
alter table parties.party_revision add constraint party_revision_reason check (revision = 1 or reason is not null);
alter table parties.party_revision drop constraint party_revision_names;
alter table parties.party_revision add constraint party_revision_names check (
  (kind = 'person' and given_name is not null and family_name is not null and name is null)
  or (kind = 'organization' and name is not null and given_name is null and family_name is null and birth_date is null)
);
alter table parties.party_revision drop column anonymized;
