-- migrate:up

-- Claim numbers from the server (ADR 0036): one series per installation and
-- year, e.g. S-2026-000123. The prefix is a setting per market; the number
-- counts across markets, so two markets never get the same number.
create table claims.claim_number_series (
  year     integer primary key check (year between 2000 and 9999),
  last_no  integer not null check (last_no >= 0)
);

grant select, insert on claims.claim_number_series to claims_service;
grant update (last_no) on claims.claim_number_series to claims_service;

-- migrate:down

revoke update (last_no) on claims.claim_number_series from claims_service;
revoke select, insert on claims.claim_number_series from claims_service;
drop table claims.claim_number_series;
