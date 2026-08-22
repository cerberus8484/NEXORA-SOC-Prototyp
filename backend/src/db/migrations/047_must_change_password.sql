-- Migration 047: Erst-Login-Passwortzwang (Easy-Install / Fresh-Install)
--
-- Der per ADMIN_PASSWORD geseedete Bootstrap-Admin startet mit einem temporären
-- Passwort. Damit er es beim ERSTEN Login wechseln MUSS, gibt es ein eigenes Flag
-- `must_change_password` — bewusst getrennt vom Ablauf-Mechanismus
-- (`password_changed_at`): Erstanmeldung ≠ regulärer Passwort-Ablauf.
--
-- Wird beim Anlegen (ensureAdminUser) auf true gesetzt, beim erfolgreichen
-- changePassword auf false. Additiv + idempotent. KEINE PII.

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
