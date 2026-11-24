-- Runs once when the local database is created (docker-entrypoint-initdb.d).
-- For development and CI only. In production, roles are created by
-- CloudNativePG (spec.managed.roles) and passwords come from secrets.

-- One role per module (ADR 0001). Migrations run as the owner; the service logs
-- in with its own role and gets only the grants the migrations give it.
create role claims_service login password 'claims_service';
create role access_service login password 'access_service';
create role decisioning_service login password 'decisioning_service';
create role catalog_service login password 'catalog_service';
create role animals_service login password 'animals_service';
create role parties_service login password 'parties_service';
create role policies_service login password 'policies_service';
create role communications_service login password 'communications_service';
create role webhooks_service login password 'webhooks_service';
create role scheduling_service login password 'scheduling_service';
create role documents_service login password 'documents_service';
create role billing_service login password 'billing_service';
create role payments_service login password 'payments_service';
create role accounting_service login password 'accounting_service';

-- Separate database for tests, so tests never touch development data.
create database petvold_test owner petvold;
