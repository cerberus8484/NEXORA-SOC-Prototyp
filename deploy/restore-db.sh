#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore eines VERSCHLÜSSELTEN SOC-Backups (soc-*.sql.gz.enc) in die Prod-DB.
# Gegenstück zu backup-db.sh — spiegelt exakt die Verschlüsselung (AES-256-CBC, pbkdf2).
#
# Für den Umzug alt -> neu: altes Backup + Passphrase (~/.soc_backup_pass) auf den
# neuen Host bringen, dann dieses Script.
#
# ⚠️ DESTRUKTIV: ersetzt die Ziel-DB VOLLSTÄNDIG. Erfordert Bestätigung (oder --yes).
#    Die API wird vorher gestoppt, danach wieder gestartet (führt neuere Migrationen
#    idempotent aus). Schlägt der Restore fehl, bleibt die API GESTOPPT (bewusst).
#
# Nutzung:
#   ./deploy/restore-db.sh --file ~/backups/soc/soc-20260630-033001.sql.gz.enc
#   ./deploy/restore-db.sh --file <datei> --yes        (ohne Rückfrage, für Automation)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER="${SOC_PG_CONTAINER:-soc_postgres_prod}"
API_CONTAINER="${SOC_API_CONTAINER:-soc_api_prod}"
PASS_FILE="${SOC_BACKUP_PASS_FILE:-$HOME/.soc_backup_pass}"

BACKUP=""; ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) BACKUP="$2"; shift 2;;
    --yes)  ASSUME_YES=1; shift;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done

# ── Vorbedingungen ───────────────────────────────────────────────────────────
# Container-Namen härten: stammen aus ENV (SOC_PG_CONTAINER/SOC_API_CONTAINER) und
# fließen in `docker exec "$CONTAINER" …` — nur sichere Zeichen zulassen (kein
# Shell-Injection-Vektor bei CI/CD oder manipulierter .env).
for _n in "$CONTAINER" "$API_CONTAINER"; do
  [[ "$_n" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "FEHLER: Ungültiger Container-Name: '$_n'" >&2; exit 1; }
done
[ -n "$BACKUP" ]   || { echo "FEHLER: --file <soc-*.sql.gz.enc> erforderlich." >&2; exit 1; }
[ -f "$BACKUP" ]   || { echo "FEHLER: Datei nicht gefunden: $BACKUP" >&2; exit 1; }
[ -s "$PASS_FILE" ] || { echo "FEHLER: Passphrase-Datei fehlt: $PASS_FILE (vom alten Host mitbringen!)." >&2; exit 1; }
command -v openssl >/dev/null || { echo "FEHLER: openssl fehlt." >&2; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || { echo "FEHLER: DB-Container '$CONTAINER' läuft nicht." >&2; exit 1; }

ENC=(openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE")

# ── 1. Integrität prüfen (beweist: richtige Passphrase + lesbar) ─────────────
echo "==> Prüfe Backup (Entschlüsselung + gzip-Integrität)"
if ! "${ENC[@]}" -d -in "$BACKUP" 2>/dev/null | gzip -t 2>/dev/null; then
  echo "FEHLER: Backup nicht entschlüsselbar oder korrupt (falsche Passphrase?)." >&2
  exit 1
fi

# ── 2. Bestätigung ───────────────────────────────────────────────────────────
echo ""
echo "ACHTUNG: Dies ERSETZT die Datenbank in '$CONTAINER' VOLLSTÄNDIG durch:"
echo "  $BACKUP"
if [ "$ASSUME_YES" -ne 1 ]; then
  read -rp "Fortfahren? Tippe exakt 'RESTORE' zum Bestätigen: " ans
  [ "$ans" = "RESTORE" ] || { echo "Abgebrochen."; exit 1; }
fi

# ── 3. API stoppen (keine offenen Verbindungen während Drop/Restore) ─────────
if docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
  echo "==> Stoppe API ($API_CONTAINER)"
  docker stop "$API_CONTAINER" >/dev/null
fi

# ── 4. Ziel-DB sauber neu anlegen (dropdb --force kappt Restverbindungen) ────
echo "==> Ziel-DB neu anlegen (dropdb --force + createdb)"
docker exec "$CONTAINER" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"'
docker exec "$CONTAINER" sh -c 'createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"'

# ── 5. Restore: entschlüsseln -> gunzip -> psql ──────────────────────────────
echo "==> Spiele Backup ein"
if ! "${ENC[@]}" -d -in "$BACKUP" | gunzip | docker exec -i "$CONTAINER" \
     sh -c 'psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$POSTGRES_DB"' >/dev/null; then
  echo "FEHLER: Restore fehlgeschlagen. API bleibt GESTOPPT — DB-Zustand prüfen." >&2
  exit 1
fi

# ── 6. API wieder starten (führt ggf. neuere Migrationen idempotent aus) ─────
echo "==> Starte API ($API_CONTAINER)"
docker start "$API_CONTAINER" >/dev/null 2>&1 || true

echo ""
echo "============================================================"
echo "  RESTORE OK — Daten eingespielt."
echo "  Prüfen:  ./deploy/soc.sh health   + ein Login (alte Zugangsdaten!)"
echo "  Hinweis: Login nutzt die Konten aus dem Backup, nicht das"
echo "           Fresh-Install-Admin-Konto (wurde überschrieben)."
echo "============================================================"
