-- Migration 048: Index auf correlation_result_evidence.ticket_id
--
-- correlation_result_evidence ist die einzige ticket-verwandte Tabelle ohne
-- eigenen ticket_id-Index. Bei Ticket-Löschung/Join (alle Evidence-Zeilen eines
-- Tickets) führt das zu einem Seq-Scan. Additiv + idempotent, kein PII/Secret.

CREATE INDEX IF NOT EXISTS idx_correlation_result_evidence_ticket_id
  ON correlation_result_evidence (ticket_id);
