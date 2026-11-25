-- migrate:up

-- Files read into payments, e.g. the bank's camt.054 (ADR 0040, punkt 12):
-- who read it in, when, its checksum and what it gave. Never changes.
create table payments.payment_file (
  payment_file_id  text not null primary key check (payment_file_id ~ '^pfl_[A-Za-z0-9]+$'),
  provider         text not null,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes       bigint not null check (size_bytes > 0),
  imported_by      text not null,
  imported_at      timestamptz not null,
  received         integer not null check (received >= 0),
  duplicates       integer not null check (duplicates >= 0),
  payment_ids      text[] not null
);
create index payment_file_imported on payments.payment_file (imported_at desc);

revoke update, delete on payments.payment_file from public;
grant select, insert on payments.payment_file to payments_service;

-- migrate:down

revoke all on payments.payment_file from payments_service;
drop table payments.payment_file;
