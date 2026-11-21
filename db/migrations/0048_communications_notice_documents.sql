-- migrate:up

-- Who makes a notice's document (ADR 0038 step 4): the insurer's document
-- system, as before, or Petvold from its templates. Set when the notice is made,
-- from the market's setting, and never changed.
alter table communications.notice add column document_maker text not null default 'insurer' check (document_maker in ('insurer', 'petvold'));

-- The PDF Petvold made for a notice: its id in the documents module and its
-- checksum. One per notice, and it never changes.
create table communications.notice_document (
  notice_id    text not null primary key references communications.notice (notice_id),
  document_id  text not null check (document_id ~ '^doc_[A-Za-z0-9_]+$'),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  made_by      text not null,
  made_at      timestamptz not null
);

alter table communications.outbox drop constraint outbox_type_check;
alter table communications.outbox add constraint outbox_type_check check (type in ('notice.created', 'notice.document_made', 'notice.delivered', 'notice.failed'));

grant select, insert on communications.notice_document to communications_service;

-- migrate:down

revoke all on communications.notice_document from communications_service;
delete from communications.outbox where type = 'notice.document_made';
alter table communications.outbox drop constraint outbox_type_check;
alter table communications.outbox add constraint outbox_type_check check (type in ('notice.created', 'notice.delivered', 'notice.failed'));
drop table communications.notice_document;
alter table communications.notice drop column document_maker;
