-- Migration 046: Dataplane-Live-Status (Hub↔Backend-Status-Brücke)
--
-- Persistenter „last known"-Status je Dataplane-Knoten: Collector-Hub-Zustand,
-- Intake- und Outbox-Zähler. Der Dataplane-Push-Job meldet periodisch (HMAC).
-- Das Backend hält nur den letzten Snapshot je node_id (upsert) und liefert ihn
-- read-only an die UI. Macht collectors/activity `liveProcessStatus.available`
-- ehrlich =true, sobald ein frischer Snapshot vorliegt — sonst bleibt es false.
--
-- Additiv + idempotent. KEINE Secrets/PII (nur Betriebszähler + Collector-Namen).

CREATE TABLE IF NOT EXISTS dataplane_status (
  node_id      TEXT        PRIMARY KEY,
  reported_at  TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  collectors   JSONB       NOT NULL DEFAULT '[]',
  intake       JSONB       NOT NULL DEFAULT '{}',
  outbox       JSONB       NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
