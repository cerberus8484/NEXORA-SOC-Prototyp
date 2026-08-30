#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Audit-Log-Retention (DSGVO Art. 5(1)(e) Speicherbegrenzung).
# Löscht audit_log-Einträge, die älter als AUDIT_RETENTION_DAYS (Default 90) sind.
#
#  - psql LÄUFT IM Container (DB-Creds verlassen den Container nie).
#  - Reines DELETE; autovacuum gibt den Platz zur Wiederverwendung frei
#    (kein VACUUM FULL → kein exklusiver Lock im Cron-Betrieb).
#  - Idempotent, cron-fähig, set -euo pipefail.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER="${SOC_PG_CONTAINER:-soc_postgres_prod}"
DAYS="${AUDIT_RETENTION_DAYS:-90}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[audit-retention] FEHLER: Container '$CONTAINER' läuft nicht" >&2
  exit 1
fi

SQL="WITH del AS (DELETE FROM audit_log WHERE created_at < now() - interval '${DAYS} days' RETURNING 1) SELECT count(*) FROM del;"

# SQL via stdin → Creds (POSTGRES_USER/DB) expandieren IM Container.
DELETED="$(printf '%s' "$SQL" | docker exec -i "$CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -f -' | tr -d '[:space:]')"

echo "[audit-retention] $(date '+%F %T') — Aufbewahrung ${DAYS} Tage, gelöscht: ${DELETED:-0} Einträge"
