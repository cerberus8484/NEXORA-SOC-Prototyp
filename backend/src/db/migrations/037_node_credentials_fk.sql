-- Migration 037: Referenzintegrität node_credentials → installed_nodes (P_PROVISION_SECURITY_1)
-- Schließt den Lifecycle-Follow-up: ein Node-Credential muss zu einer existierenden
-- Node gehören (keine verwaisten Credentials). Nodes werden NIE gelöscht (nur retired),
-- daher ist ON DELETE CASCADE ungefährlich und nur ein Sicherheitsnetz.
--
-- Boot-Sicherheit: die FK wird als NOT VALID angelegt — sie gilt für ALLE NEUEN Rows,
-- validiert aber den Altbestand NICHT (kein Boot-Abbruch, falls je eine verwaiste Row
-- existierte). Optionales späteres `VALIDATE CONSTRAINT` kann das nachholen.
-- Idempotenz: Constraint nur anlegen, wenn sie noch nicht existiert (ADD CONSTRAINT
-- kennt kein IF NOT EXISTS → pg_constraint-Check im DO-Block).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_node_credentials_node'
  ) THEN
    ALTER TABLE node_credentials
      ADD CONSTRAINT fk_node_credentials_node
      FOREIGN KEY (node_id) REFERENCES installed_nodes (id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
