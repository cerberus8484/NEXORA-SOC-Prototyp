-- Migration 024: Erstklassiges verdict-Feld für HuntFinding (Block B2)
-- Analyst kann Verdict (benign / suspicious / malicious / inconclusive) direkt am Finding setzen.
-- NOT NULL DEFAULT '' — kein Nullable, kein JSON-Merge mit context nötig.
-- IF NOT EXISTS schützt bei wiederholtem Ausführen (idempotent).

ALTER TABLE hunt_findings
  ADD COLUMN IF NOT EXISTS verdict TEXT NOT NULL DEFAULT '';

-- Index für spätere Filterabfragen (Findings nach Verdict, z.B. Dashboard)
CREATE INDEX IF NOT EXISTS idx_hunt_findings_verdict ON hunt_findings (verdict)
  WHERE verdict <> '';
