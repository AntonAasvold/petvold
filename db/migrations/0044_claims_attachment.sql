-- migrate:up

-- A document on a claim as a reference to the insurer's archive (ADR 0036).
-- Petvold keeps the address and the checksum, never the file. An attachment is
-- never changed or removed; a new one may replace it, once.
create table claims.claim_attachment (
  id                      text primary key,
  claim_id                text not null references claims.claim,
  kind                    text not null check (kind in ('invoice', 'medical-record', 'referral', 'photo', 'other')),
  media_type              text not null check (media_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  size_bytes              bigint not null check (size_bytes >= 1),
  sha256                  text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  url                     text not null check (url ~* '^(https://\S+|urn:[a-z0-9][a-z0-9-]{0,31}:\S+)$'),
  information_request_id  text references claims.information_request,
  replaces                text unique references claims.claim_attachment,
  added_by                text not null check (added_by <> ''),
  added_at                timestamptz not null
);

create index claim_attachment_claim on claims.claim_attachment (claim_id, added_at);

-- An attachment replaces one on the same claim, a request belongs to the same
-- claim, and a closed claim gets no attachments (PVC01).
create function claims.check_claim_attachment() returns trigger language plpgsql as $$
begin
  if new.replaces is not null and not exists (select 1 from claims.claim_attachment where id = new.replaces and claim_id = new.claim_id) then
    raise exception 'Attachment % is not on claim %', new.replaces, new.claim_id;
  end if;
  if new.information_request_id is not null
     and not exists (select 1 from claims.information_request where id = new.information_request_id and claim_id = new.claim_id) then
    raise exception 'Request % is not on claim %', new.information_request_id, new.claim_id;
  end if;
  if exists (select 1 from claims.claim_closure where claim_id = new.claim_id) then
    raise exception 'Claim % is closed', new.claim_id using errcode = 'PVC01';
  end if;
  return new;
end $$;

create trigger claim_attachment_checked before insert on claims.claim_attachment
  for each row execute function claims.check_claim_attachment();

-- The attachments in force when a decision was made: [{ id, sha256 }].
alter table claims.decision_evidence add column attachments jsonb check (attachments is null or jsonb_typeof(attachments) = 'array');

revoke update, delete on claims.claim_attachment from public;
grant select, insert on claims.claim_attachment to claims_service;

-- migrate:down

alter table claims.decision_evidence drop column attachments;
revoke select, insert on claims.claim_attachment from claims_service;
drop trigger claim_attachment_checked on claims.claim_attachment;
drop function claims.check_claim_attachment();
drop table claims.claim_attachment;
