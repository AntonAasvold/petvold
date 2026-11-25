-- migrate:up

-- Payout files for the bank, pain.001 (ADR 0040, punkt 12): the payouts in
-- each, its checksum, and the file to fetch again. The file holds names and
-- account numbers, so its content is emptied when a payee in it is erased
-- (ADR 0040, punkt 11); the rest never changes.
create table payments.payout_file (
  payout_file_id  text not null primary key check (payout_file_id ~ '^pof_[A-Za-z0-9]+$'),
  provider        text not null,
  market          text not null check (market ~ '^[A-Z]{2}$'),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  execution_date  date not null,
  payout_ids      text[] not null check (cardinality(payout_ids) > 0),
  total           bigint not null check (total > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by      text not null,
  created_at      timestamptz not null,
  content         text
);
create index payout_file_created on payments.payout_file (created_at desc);
create index payout_file_payouts on payments.payout_file using gin (payout_ids);

-- Only emptied, once.
create function payments.payout_file_erase_only() returns trigger language plpgsql as $$
begin
  if old.content is null or new.content is not null then
    raise exception 'A payout file never changes, except to have its content erased once' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payout_file_erase_only before update on payments.payout_file
  for each row execute function payments.payout_file_erase_only();

revoke update, delete on payments.payout_file from public;
grant select, insert on payments.payout_file to payments_service;
grant update (content) on payments.payout_file to payments_service;

-- migrate:down

revoke all on payments.payout_file from payments_service;
drop trigger if exists payout_file_erase_only on payments.payout_file;
drop function if exists payments.payout_file_erase_only();
drop table payments.payout_file;
