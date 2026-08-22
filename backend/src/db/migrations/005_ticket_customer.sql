-- ANALYSIS-DATA-1: Kunde/Mandant am Ticket
--
-- Eigenes Top-Level-Feld (nicht JSONB), damit die Analysis-Seite danach
-- filtern und gruppieren kann. Freitext — wird im Editor gesetzt; aus
-- Integrationen (z.B. Wazuh-Agent) kann es spaeter abgeleitet werden.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer);

COMMENT ON COLUMN tickets.customer IS 'Kunde/Mandant des Cases (Freitext, fuer Analysis-Filter)';
