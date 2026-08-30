-- Fortlaufende, menschenlesbare Use-Case-Nummern im Format UC-INC000001 (bei Erstellung
-- vergeben, analog zur Ticket-Nummer INC000001). App liest nextval('use_case_number_seq')
-- und formatiert mit Prefix UC-INC + Padding. Die Nummer selbst reist im payload-JSONB mit
-- (kein eigener Spalten-Migrationsbedarf).
CREATE SEQUENCE IF NOT EXISTS use_case_number_seq START 1;
