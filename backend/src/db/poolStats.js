'use strict';

// Beobachtungs-Helfer für den pg-Pool — rein bis auf das optionale Warn-Log.
// Macht Pool-Sättigung SICHTBAR, bevor die nächste Query blockiert (kein stiller Ausfall).

// Momentaufnahme der Auslastung — alle Werte stammen aus dem pg-Pool selbst.
function poolSnapshot(pool) {
  return {
    total:   pool.totalCount   ?? 0,
    idle:    pool.idleCount    ?? 0,
    waiting: pool.waitingCount ?? 0,
    max:     pool.options?.max ?? null,
  };
}

// Gesättigt, wenn Anforderer auf eine Verbindung warten ODER alle Verbindungen belegt
// sind (kein idle, total am Maximum). Beides heißt: die nächste Query blockiert.
function isSaturated(snap) {
  if (!snap) return false;
  if (snap.waiting > 0) return true;
  if (snap.max != null && snap.total >= snap.max && snap.idle === 0) return true;
  return false;
}

// Strukturierte Warnung bei Sättigung — NUR Zähler, niemals Verbindungs-Secrets.
// Gibt zurück, ob geloggt wurde (für Tests + Aufrufer).
function logPoolSaturation(pool, logger) {
  const snap = poolSnapshot(pool);
  if (!isSaturated(snap)) return false;
  logger.warn('pg_pool_saturated', { total: snap.total, idle: snap.idle, waiting: snap.waiting, max: snap.max });
  return true;
}

module.exports = { poolSnapshot, isSaturated, logPoolSaturation };
