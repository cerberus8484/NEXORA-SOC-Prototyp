-- Parent/Child-Korrelation: Host-Case bündelt die Offenses eines Hosts.
--
--   kind = 'case'   → Parent-Case (ein Host/Agent), offense_id = wazuh:host:<agentId>
--   kind = 'alert'  → einzelne Offense (rule+agent), parent_id zeigt auf den Case
--
-- Sekundäre Korrelationen (srcIp, user, mitre, customer …) bleiben als
-- vorhandene Ticket-Felder erhalten — NICHT als Parent-Schlüssel.
--
-- Idempotent.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kind      TEXT NOT NULL DEFAULT 'alert';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_kind_check;
ALTER TABLE tickets ADD  CONSTRAINT tickets_kind_check CHECK (kind IN ('alert', 'case'));

CREATE INDEX IF NOT EXISTS idx_tickets_parent_id ON tickets(parent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_kind      ON tickets(kind);

COMMENT ON COLUMN tickets.kind      IS 'alert = einzelne Offense | case = Host-Parent-Case';
COMMENT ON COLUMN tickets.parent_id IS 'Verweis auf den Host-Case (Parent), NULL bei Case/Standalone';
