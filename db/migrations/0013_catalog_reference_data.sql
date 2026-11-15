-- migrate:up

-- The catalog module (ADR 0021, 0022): reference data such as species, breeds
-- and sexes, with labels per language. Append-only: every change is a new
-- revision, and a code is never deleted, only deactivated.
create schema catalog;

create table catalog.reference_item (
  kind        text not null check (kind in ('species', 'breed', 'sex')),
  code        text not null check (code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  revision    int  not null check (revision >= 1),
  parent      text,
  labels      jsonb not null check (jsonb_typeof(labels) = 'object' and labels <> '{}'::jsonb),
  active      boolean not null,
  changed_by  text not null,
  changed_at  timestamptz not null,
  reason      text,
  primary key (kind, code, revision),
  -- Breeds belong to a species; other kinds have no parent.
  constraint reference_item_parent check ((kind = 'breed') = (parent is not null)),
  -- A change to an existing code says why.
  constraint reference_item_reason check (revision = 1 or reason is not null)
);

-- A breed's species exists and never changes once set.
create function catalog.check_reference_item() returns trigger language plpgsql as $$
declare
  previous text;
begin
  if new.kind = 'breed' and not exists (
    select 1 from catalog.reference_item where kind = 'species' and code = new.parent
  ) then
    raise exception 'Species % does not exist', new.parent;
  end if;
  if new.revision > 1 then
    select parent into previous from catalog.reference_item
      where kind = new.kind and code = new.code and revision = new.revision - 1;
    if not found then
      raise exception 'Revision % of % % has no previous revision', new.revision, new.kind, new.code;
    end if;
    if previous is distinct from new.parent then
      raise exception 'The parent of % % cannot change', new.kind, new.code;
    end if;
  end if;
  return new;
end $$;

create trigger reference_item_checked
  before insert on catalog.reference_item
  for each row execute function catalog.check_reference_item();

revoke all on catalog.reference_item from public;
grant usage on schema catalog to catalog_service;
-- Read and insert only: the history cannot be changed or deleted.
grant select, insert on catalog.reference_item to catalog_service;

-- migrate:down

revoke select, insert on catalog.reference_item from catalog_service;
revoke usage on schema catalog from catalog_service;
drop table catalog.reference_item;
drop function catalog.check_reference_item();
drop schema catalog;
