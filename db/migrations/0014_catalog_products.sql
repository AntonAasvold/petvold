-- migrate:up

-- Product versions in the catalog module (ADR 0021, 0023).
-- draft -> in_review -> published. A published version never changes, except
-- that its sales can be brought forward (sales_to, sales_ended_*, note).
create table catalog.product_version (
  product           text not null check (product ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
  version           text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$'),
  status            text not null check (status in ('draft', 'in_review', 'published')),
  content           jsonb not null check (jsonb_typeof(content) = 'object'),
  sales_from        date not null,
  sales_to          date check (sales_to > sales_from),
  checksum          text,
  revision          int  not null check (revision >= 1),
  created_by        text not null,
  created_at        timestamptz not null,
  submitted_by      text,
  submitted_at      timestamptz,
  published_by      text,
  published_at      timestamptz,
  sales_ended_by    text,
  sales_ended_at    timestamptz,
  note              text,
  primary key (product, version),
  constraint product_reviewed check (status = 'draft' or (checksum is not null and submitted_by is not null and submitted_at is not null)),
  constraint product_published check (status <> 'published' or (published_by is not null and published_at is not null)),
  constraint product_four_eyes check (published_by is null or published_by <> submitted_by)
);

create function catalog.check_product_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'published' then
    if new.status <> 'published'
       or (new.content, new.sales_from, new.checksum, new.submitted_by, new.published_by)
          is distinct from (old.content, old.sales_from, old.checksum, old.submitted_by, old.published_by) then
      raise exception 'Product version %@% is published; only its sales can end', old.product, old.version;
    end if;
    if new.sales_to is distinct from old.sales_to and (new.sales_to is null or (old.sales_to is not null and new.sales_to >= old.sales_to)) then
      raise exception 'Sales of %@% can only be brought forward', old.product, old.version;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'in_review' and new.status in ('in_review', 'published')
     and (new.content, new.sales_from) is distinct from (old.content, old.sales_from) then
    raise exception 'Product version %@% is locked for review', old.product, old.version;
  end if;
  -- One published version of a product on sale per day.
  if new.status = 'published' and exists (
    select 1 from catalog.product_version o
    where o.product = new.product and o.version <> new.version and o.status = 'published'
      and daterange(o.sales_from, o.sales_to) && daterange(new.sales_from, new.sales_to)
  ) then
    raise exception 'Another version of % is on sale in the same period', new.product;
  end if;
  return new;
end $$;

create trigger product_version_checked
  before insert or update on catalog.product_version
  for each row execute function catalog.check_product_version();

revoke all on catalog.product_version from public;
grant select, insert, update on catalog.product_version to catalog_service;

-- migrate:down

revoke select, insert, update on catalog.product_version from catalog_service;
drop table catalog.product_version;
drop function catalog.check_product_version();
