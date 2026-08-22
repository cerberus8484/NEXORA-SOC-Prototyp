-- KI-Agent: Strukturiertes analysis-Objekt (Entities/IOCs/Bewertung) für UI-Karten-Rendering.
ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS analysis JSONB;
