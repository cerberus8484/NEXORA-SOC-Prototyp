-- Integritäts-Hash (tamper-evidence) für Evidence-Items. Idempotent.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS sha256 TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN evidence.sha256 IS 'SHA-256 über den unveränderlichen Inhalt — Manipulationserkennung (Chain of Custody)';
