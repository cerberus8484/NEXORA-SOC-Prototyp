-- Analyst-Workflow-Zustand pro Ticket — Checkliste + Playbook-Status.
-- JSONB-Feld analystState: { checklist: [{id, label, done}], playbook: {id, step, status} | {} }
-- Default '{}' — additiv, kein Backfill nötig.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS analyst_state JSONB NOT NULL DEFAULT '{}'::jsonb;
