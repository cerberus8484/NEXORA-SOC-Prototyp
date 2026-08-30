#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Automatisches, VERSCHLÜSSELTES Postgres-Backup der SOC-Datenbank.
#
#  - pg_dump LÄUFT IM CONTAINER → DB-Creds verlassen den Container nie.
#  - Pipeline pg_dump | gzip | openssl enc (AES-256, pbkdf2): es liegt NIE
#    Klartext auf der Platte (DSGVO Art. 32 — Backups enthalten PII).
#  - Passphrase aus einer 0600-Datei; wird beim ersten Lauf erzeugt.
#    ⚠️ GEHT DIE PASSPHRASE VERLOREN, SIND ALLE BACKUPS UNWIEDERHERSTELLBAR.
#       → Passphrase getrennt sichern (Passwortmanager / Tresor).
#  - Integritätscheck (entschlüsseln → gunzip -t) — Korruptes wird verworfen.
#  - Rotation: nur die letzten N Backups behalten.
#
# Restore (manuell, bewusst):
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$HOME/.soc_backup_pass \
#     -in <datei.sql.gz.enc> | gunzip | docker exec -i soc_postgres_prod \
#     sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER="${SOC_PG_CONTAINER:-soc_postgres_prod}"
BACKUP_DIR="${SOC_BACKUP_DIR:-$HOME/backups/soc}"
KEEP="${SOC_BACKUP_KEEP:-14}"
PASS_FILE="${SOC_BACKUP_PASS_FILE:-$HOME/.soc_backup_pass}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/soc-$TS.sql.gz.enc"

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[backup] FEHLER: Container '$CONTAINER' läuft nicht" >&2
  exit 1
fi

# Passphrase beim ersten Lauf erzeugen (0600).
if [ ! -s "$PASS_FILE" ]; then
  umask 077
  openssl rand -base64 48 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  echo "[backup] Neue Backup-Passphrase erzeugt: $PASS_FILE — UNBEDINGT separat sichern!"
fi

ENC=(openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE")

# Dump (read-only) → gzip → AES-256. Kein Klartext auf der Platte.
if ! docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip | "${ENC[@]}" > "$OUT"; then
  echo "[backup] FEHLGESCHLAGEN — '$OUT' wird entfernt" >&2
  rm -f "$OUT"
  exit 1
fi

# Integritätscheck — entschlüsseln + gunzip -t (beweist Wiederherstellbarkeit).
if ! "${ENC[@]}" -d -in "$OUT" 2>/dev/null | gzip -t 2>/dev/null; then
  echo "[backup] KORRUPT/NICHT ENTSCHLÜSSELBAR — '$OUT' wird entfernt" >&2
  rm -f "$OUT"
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] OK  $OUT  ($SIZE, verschlüsselt)"

# Rotation — älteste über $KEEP hinaus löschen.
ls -1t "$BACKUP_DIR"/soc-*.sql.gz.enc 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
COUNT="$(ls -1 "$BACKUP_DIR"/soc-*.sql.gz.enc 2>/dev/null | wc -l)"
echo "[backup] Aufbewahrung: $COUNT verschlüsselte Backups (max $KEEP) in $BACKUP_DIR"
