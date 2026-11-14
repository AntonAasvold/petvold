-- Körs en gång när den lokala databasen skapas (docker-entrypoint-initdb.d).
-- Bara för utveckling och CI. I drift skapas roller av CloudNativePG
-- (spec.managed.roles) och lösenord kommer från hemligheter.

-- En roll per modul (ADR 0001). Migreringar körs som ägare; tjänsten loggar in
-- med sin egen roll och får bara de rättigheter migreringarna ger den.
create role claims_service login password 'claims_service';

-- Separat databas för tester, så att testerna inte rör utvecklingsdata.
create database petvold_test owner petvold;
