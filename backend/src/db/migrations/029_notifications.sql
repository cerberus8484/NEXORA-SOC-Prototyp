-- Migration 029: In-App-Notifications
-- Append-mostly: Einträge werden angelegt und als gelesen markiert, nie gelöscht.
-- idx_notifications_user optimiert die häufigste Abfrage (eigene ungelesene Notifications).

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  severity   TEXT        NOT NULL DEFAULT 'info',
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL DEFAULT '',
  source     TEXT        NOT NULL DEFAULT 'system',
  link       TEXT        NOT NULL DEFAULT '',
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, read, created_at DESC);
