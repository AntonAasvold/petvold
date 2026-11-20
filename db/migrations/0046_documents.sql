-- migrate:up

-- Documents (ADR 0038): the records of files kept in the archive (object
-- storage) with their checksum, and the links that open them. Its own schema
-- and role (ADR 0001). The file itself is never in the database.
create schema documents;
grant usage on schema documents to documents_service;

create table documents.document (
  id               text primary key check (id ~ '^doc_[A-Za-z0-9_]+$'),
  kind             text not null check (kind in ('uploaded', 'generated')),
  media_type       text not null check (media_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  size_bytes       bigint not null check (size_bytes >= 1),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  filename         text check (char_length(filename) between 1 and 200),
  owner_claim_id   text,
  owner_policy_id  text,
  owner_notice_id  text,
  -- The parties it concerns, set when it is made: a customer's list of documents.
  party_ids        text[] not null,
  market           text not null check (market ~ '^[A-Z]{2}$'),
  created_by       text not null check (created_by <> ''),
  created_at       timestamptz not null,
  erased_at        timestamptz,
  check (owner_claim_id is not null or owner_policy_id is not null or owner_notice_id is not null)
);

create index document_parties on documents.document using gin (party_ids);
create index document_claim on documents.document (owner_claim_id) where owner_claim_id is not null;
create index document_policy on documents.document (owner_policy_id) where owner_policy_id is not null;

-- A link that expires and can be revoked. Its id is random; the address adds a signature.
create table documents.link (
  id           text primary key check (id ~ '^lnk_[A-Za-z0-9_-]{24}$'),
  document_id  text not null references documents.document,
  audience     text not null check (audience in ('internal', 'customer')),
  created_by   text not null check (created_by <> ''),
  created_at   timestamptz not null,
  expires_at   timestamptz not null check (expires_at > created_at),
  revoked_by   text,
  revoked_at   timestamptz,
  check ((revoked_by is null) = (revoked_at is null))
);

create index link_document on documents.link (document_id, created_at desc);

-- Every time a link was opened: who has seen the document (GDPR art. 15).
create table documents.link_access (
  seq        bigint generated always as identity primary key,
  link_id    text not null references documents.link,
  opened_at  timestamptz not null
);

create index link_access_link on documents.link_access (link_id, seq);

revoke update, delete on documents.document, documents.link, documents.link_access from public;
grant select, insert on documents.document, documents.link, documents.link_access to documents_service;
-- A link is revoked once; a file is erased by retention (ADR 0038 point 9).
grant update (revoked_by, revoked_at) on documents.link to documents_service;
grant update (erased_at) on documents.document to documents_service;

-- migrate:down

drop table documents.link_access;
drop table documents.link;
drop table documents.document;
revoke usage on schema documents from documents_service;
drop schema documents;
