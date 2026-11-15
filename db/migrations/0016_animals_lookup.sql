-- migrate:up

-- Whether a lookup by identifier, e.g. by a clinic, finds the animal (ADR 0025).
-- Part of each revision, so who opened or closed it, when and why is kept.
-- Existing animals are closed; new revisions must state it.
alter table animals.animal_revision add column allow_lookup boolean not null default false;
alter table animals.animal_revision alter column allow_lookup drop default;

-- migrate:down

alter table animals.animal_revision drop column allow_lookup;
