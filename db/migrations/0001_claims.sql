-- migrate:up

-- Skademotorns eget schema. Exponeras inte via Supabases auto-API;
-- bara skademotorns tjänstekonto har skrivrätt.
-- Policydata ägs INTE här: den läses via PolicyPort från policykärnan.

create extension if not exists btree_gist;
create schema if not exists claims;

-- Ärenden ----------------------------------------------------------------

create table claims.claim (
  id              text primary key,
  claim_no        text not null unique,
  policy_id       text not null,             -- referens till policykärnan, ingen FK
  animal_id       text not null,
  market          char(2) not null check (market ~ '^[A-Z]{2}$'),
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  channel         text not null check (channel in ('clinic_direct', 'customer')),
  treatment_from  date not null,
  treatment_to    date not null check (treatment_to >= treatment_from),
  diagnosis_code  text not null,
  received_at     timestamptz not null default now()
);
create index on claims.claim (animal_id, treatment_from);
create index on claims.claim (market, received_at);

create table claims.claim_line (
  claim_id        text not null references claims.claim on delete restrict,
  line_id         text not null,
  description     text not null,
  category        text not null,
  diagnosis_code  text,
  amount_minor    bigint not null check (amount_minor >= 0),
  vat_minor       bigint check (vat_minor >= 0 and vat_minor <= amount_minor),
  primary key (claim_id, line_id)
);

-- Beslut: bara nya rader, aldrig uppdatering --------------------------------

create table claims.decision (
  id                 text primary key,
  claim_id           text not null references claims.claim,
  seq                int  not null check (seq >= 1),
  outcome            text not null check (outcome in ('approved', 'partial', 'rejected')),
  payout_minor       bigint not null check (payout_minor >= 0),
  currency           char(3) not null,
  assessment         jsonb not null,          -- hela bedömningen inkl. beräkning och regelutfall
  input_hash         text not null,
  rules_version      text not null,
  product_version    text,
  policy_version_id  text,
  decided_by         text not null,           -- 'auto' eller handläggarens id
  decided_at         timestamptz not null default now(),
  reason             text,
  unique (claim_id, seq)
);

-- Självriskperioder ---------------------------------------------------------

create table claims.deductible_period (
  id                 text primary key,
  animal_id          text not null,
  diagnosis_group    text not null,           -- '*' = hela försäkringsåret
  valid              daterange not null,
  opened_by_claim_id text not null references claims.claim,
  -- två perioder för samma djur och grupp får inte överlappa
  exclude using gist (animal_id with =, diagnosis_group with =, valid with &&)
);

-- Ledger: dubbel bokföring, append-only -------------------------------------

create table claims.journal (
  id           text primary key,
  source_type  text not null check (source_type = 'claim_decision'),
  source_id    text not null references claims.decision,
  claim_id     text not null references claims.claim,
  booked_at    timestamptz not null default now()
);

create table claims.journal_line (
  journal_id    text not null references claims.journal,
  line_no       int  not null,
  account       text not null,                -- t.ex. limit_consumed:<djur>:vet_care:<årsstart>
  amount_minor  bigint not null,              -- + debet, − kredit
  primary key (journal_id, line_no)
);
create index on claims.journal_line (account);

-- Varje journal måste summera till noll. Kontrolleras vid commit.
create function claims.assert_journal_balanced() returns trigger language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(amount_minor), 0) into s from claims.journal_line where journal_id = new.journal_id;
  if s <> 0 then
    raise exception 'Journal % balanserar inte (%)', new.journal_id, s;
  end if;
  return null;
end $$;

create constraint trigger journal_balanced
  after insert on claims.journal_line
  deferrable initially deferred
  for each row execute function claims.assert_journal_balanced();

-- Förbrukat belopp per konto, för ClaimsStore.getConsumed
create view claims.account_balance as
  select jl.account, j.claim_id, sum(jl.amount_minor) as amount_minor
  from claims.journal_line jl join claims.journal j on j.id = jl.journal_id
  group by jl.account, j.claim_id;

-- Utgående händelser, skrivs i samma transaktion som beslutet --------------

create table claims.outbox (
  id            bigint generated always as identity primary key,
  type          text not null,                -- claim.registered | claim.decided
  aggregate_id  text not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index on claims.outbox (created_at) where published_at is null;

-- Idempotens för API:et -----------------------------------------------------

create table claims.idempotency (
  scoped_key   text primary key,               -- subjekt:metod:sökväg:nyckel
  fingerprint  text not null,
  status       int  not null,
  body         jsonb,
  created_at   timestamptz not null default now()
);

-- Oföränderlighet: ingen roll får ändra eller radera historik ---------------

revoke update, delete on claims.decision, claims.journal, claims.journal_line from public;
-- Ge tjänstekontot bara insert/select, t.ex.:
-- grant usage on schema claims to claims_service;
-- grant select, insert on all tables in schema claims to claims_service;
-- grant delete on claims.deductible_period to claims_service;  -- ersätts vid omprövning

-- migrate:down

drop schema claims cascade;
