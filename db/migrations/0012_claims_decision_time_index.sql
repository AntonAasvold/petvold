-- migrate:up

-- Simulation reads decisions by when they were made (ADR 0018).
create index decision_decided_at on claims.decision (decided_at);

-- migrate:down

drop index claims.decision_decided_at;
