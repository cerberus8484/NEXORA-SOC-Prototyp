-- KI-Agent: Verdict der Triage-Analyse (false_positive | suspicious |
-- confirmed_incident | needs_more_info). Steuert u.a. die FP-Regel-Generierung.
ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS verdict TEXT NOT NULL DEFAULT '';
