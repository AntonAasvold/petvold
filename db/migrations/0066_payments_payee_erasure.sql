-- migrate:up

-- Payee details are erased when the party is anonymized (ADR 0040, punkt 11,
-- ADR 0028). The row stays, so the payouts' history holds together; the
-- account number goes. The only change ever made to a payee account.
alter table payments.payee_account add column erased_at timestamptz;
alter table payments.payee_account add constraint payee_account_erased
  check (erased_at is null or details = '{}'::jsonb);

-- The grant below lets the service change two columns; this lets it do only
-- one thing with them: erase, once.
create function payments.payee_account_erase_only() returns trigger language plpgsql as $$
begin
  if old.erased_at is not null or new.erased_at is null or new.details <> '{}'::jsonb then
    raise exception 'A payee account never changes, except to be erased once' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payee_account_erase_only before update on payments.payee_account
  for each row execute function payments.payee_account_erase_only();

grant update (details, erased_at) on payments.payee_account to payments_service;

-- migrate:down

revoke update (details, erased_at) on payments.payee_account from payments_service;
drop trigger if exists payee_account_erase_only on payments.payee_account;
drop function if exists payments.payee_account_erase_only();
alter table payments.payee_account drop constraint payee_account_erased;
alter table payments.payee_account drop column erased_at;
