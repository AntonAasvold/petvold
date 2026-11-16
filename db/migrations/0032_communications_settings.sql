-- migrate:up

-- The insurer's notice settings per market as versions (ADR 0032): the days
-- "promptly" gives, types the law does not require that are turned off, and
-- texts such as how a decision is reviewed. Append-only.
create table communications.notice_settings (
  version     int primary key check (version >= 1),
  markets     jsonb not null check (jsonb_typeof(markets) = 'object'),
  changed_by  text not null check (changed_by <> ''),
  changed_at  timestamptz not null,
  reason      text not null check (btrim(reason) <> '')
);
grant select, insert on communications.notice_settings to communications_service;

-- The settings version a notice was made with. Notices made before have none.
alter table communications.notice add column settings_version int;

-- The offer to the new owner of a sold animal (ADR 0029).
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer'));

-- migrate:down

delete from communications.delivery where notice_id in (select notice_id from communications.notice where type = 'transfer-offer');
delete from communications.notice where type = 'transfer-offer';
alter table communications.notice drop constraint notice_type_check;
alter table communications.notice add constraint notice_type_check
  check (type in ('policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined'));
alter table communications.notice drop column settings_version;
revoke all on communications.notice_settings from communications_service;
drop table communications.notice_settings;
