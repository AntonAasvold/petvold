-- migrate:up

-- Reserve journals (roadmap M1): when a claim goes to a handler, its expected
-- payout is booked as a reserve; the decision releases it. A reserve journal
-- refers to the claim when the reserve is set and to the decision when it is
-- released, so source_id is no longer always a decision.
alter table claims.journal drop constraint journal_source_type_check;
alter table claims.journal drop constraint journal_source_id_fkey;
alter table claims.journal add constraint journal_source_type_check
  check (source_type in ('claim_decision', 'claim_reserve'));

create function claims.check_journal_source() returns trigger language plpgsql as $$
begin
  if new.source_type = 'claim_decision' or new.source_id <> new.claim_id then
    if not exists (select 1 from claims.decision where id = new.source_id and claim_id = new.claim_id) then
      raise exception 'Journal % refers to %, which is not a decision on claim %', new.id, new.source_id, new.claim_id;
    end if;
  end if;
  return new;
end $$;

create trigger journal_source_checked
  before insert on claims.journal
  for each row execute function claims.check_journal_source();

-- migrate:down

drop trigger journal_source_checked on claims.journal;
drop function claims.check_journal_source();
-- Reserve journals cannot be expressed in the earlier schema.
delete from claims.journal_line where journal_id in (select id from claims.journal where source_type = 'claim_reserve');
delete from claims.journal where source_type = 'claim_reserve';
alter table claims.journal drop constraint journal_source_type_check;
alter table claims.journal add constraint journal_source_type_check check (source_type = 'claim_decision');
alter table claims.journal add constraint journal_source_id_fkey foreign key (source_id) references claims.decision;
