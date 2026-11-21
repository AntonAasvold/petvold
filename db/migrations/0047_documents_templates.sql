-- migrate:up

-- A generated document (ADR 0038 point 3) keeps the template that made it: its
-- name, market, language, version and checksum, and the hash of the data.
alter table documents.document
  add column template_name     text,
  add column template_market   text check (template_market ~ '^[A-Z]{2}$'),
  add column template_language text check (template_language ~ '^[a-z]{2}$'),
  add column template_version  int check (template_version >= 1),
  add column template_checksum text check (template_checksum ~ '^[0-9a-f]{64}$'),
  add column data_hash         text check (data_hash ~ '^[0-9a-f]{64}$'),
  add constraint document_generated_has_template check ((kind = 'generated') = (template_name is not null and template_version is not null and template_checksum is not null and data_hash is not null));

create index document_notice on documents.document (owner_notice_id) where owner_notice_id is not null;

-- migrate:down

drop index documents.document_notice;
alter table documents.document
  drop constraint document_generated_has_template,
  drop column data_hash,
  drop column template_checksum,
  drop column template_version,
  drop column template_language,
  drop column template_market,
  drop column template_name;
