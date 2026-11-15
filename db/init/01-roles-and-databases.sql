-- Runs once when the local database is created (docker-entrypoint-initdb.d).
-- For development and CI only. In production, roles are created by
-- CloudNativePG (spec.managed.roles) and passwords come from secrets.

-- One role per module (ADR 0001). Migrations run as the owner; the service logs
-- in with its own role and gets only the grants the migrations give it.
create role claims_service login password 'claims_service';
create role access_service login password 'access_service';
create role decisioning_service login password 'decisioning_service';
create role catalog_service login password 'catalog_service';

-- Separate database for tests, so tests never touch development data.
create database petvold_test owner petvold;
