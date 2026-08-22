-- Migration 053: manual_hosts — manuell gepflegte Assets (Nicht-Wazuh-Host-Quelle)
--
-- Für Geräte ohne Wazuh-Agent (Appliances, Netz-Hardware, Fremdsysteme), die im
-- Host-Inventar sichtbar sein sollen. Speist den Source-Filter der HostsPage
-- (source='manual'). Bewusst KEIN Heartbeat/Syscollector — die UI zeigt solche
-- Hosts ehrlich als „unmonitored". Additiv + idempotent. KEINE Secrets (nur
-- Asset-Stammdaten). Spalten spiegeln das ManualHost-Domänenobjekt.

CREATE TABLE IF NOT EXISTS manual_hosts (
  id           UUID        PRIMARY KEY,
  hostname     TEXT        NOT NULL,
  ip_addresses TEXT[]      NOT NULL DEFAULT '{}',
  os           TEXT        NOT NULL DEFAULT '',
  customer     TEXT        NOT NULL DEFAULT '',
  notes        TEXT        NOT NULL DEFAULT '',
  source       TEXT        NOT NULL DEFAULT 'manual',
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schneller Lookup/Sortierung der Host-Liste.
CREATE INDEX IF NOT EXISTS idx_manual_hosts_hostname ON manual_hosts (hostname);
CREATE INDEX IF NOT EXISTS idx_manual_hosts_created_at ON manual_hosts (created_at);
