-- migrate:up

-- Skademotorns tjänstekonto får läsa och lägga till, aldrig ändra historik.
-- Rollen skapas utanför migreringarna (db/init lokalt, CloudNativePG i drift).
grant usage on schema claims to claims_service;
grant select, insert on all tables in schema claims to claims_service;

-- Självriskperioder ersätts vid omprövning.
grant delete on claims.deductible_period to claims_service;
-- Reläet markerar händelser som publicerade.
grant update (published_at) on claims.outbox to claims_service;

-- migrate:down

revoke update (published_at) on claims.outbox from claims_service;
revoke delete on claims.deductible_period from claims_service;
revoke select, insert on all tables in schema claims from claims_service;
revoke usage on schema claims from claims_service;
