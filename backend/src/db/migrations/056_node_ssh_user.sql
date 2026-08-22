-- ADR-042 Slice 3c: SSH-Login-User eines verwalteten Nodes für Containment/Deploy.
-- Erlaubt Nicht-Standard-Admin-Konten (z.B. dediziertes IR-Konto, DOMAIN\svc-ir) statt
-- des hartkodierten OS-Defaults (root/Administrator). NULL = OS-Default verwenden.
ALTER TABLE installed_nodes ADD COLUMN IF NOT EXISTS ssh_user TEXT;
