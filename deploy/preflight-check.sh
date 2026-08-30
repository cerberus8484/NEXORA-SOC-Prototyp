#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Preflight-Check VOR install-prod-fresh.sh (Fresh-Install ODER Umzug mit Daten).
#
# Fängt die vermeidbaren Stolpersteine, BEVOR der echte Install läuft —
# damit die Generalprobe nicht an einer Dummheit scheitert. READ-ONLY:
# startet keine Container, schreibt nichts Persistentes, gibt KEINE Secrets aus
# (nur "gesetzt / nicht gesetzt / Platzhalter").
#
# Prüft:
#   1. Tools       — docker, git, openssl, curl + docker compose V2 + Daemon erreichbar
#   2. .env        — vorhanden? Pflicht-Variablen gesetzt? keine CHANGE_ME-/Default-Reste?
#                    CORS nicht offen? (gleiche Logik wie backend validateEnv.js)
#   3. Restore     — (nur bei --restore-file) Passphrase lesbar + Probe-Decrypt des Archivs
#   4. Ports       — die vom Prod-Compose veröffentlichten Host-Ports frei?
#   5. Platte/FS   — genug freier Platz + Schreibrechte im Zielverzeichnis?
#
# Exit 0 = alles grün (Install kann laufen); sonst non-zero + klare FAIL-Zeilen.
#
# Nutzung:
#   ./deploy/preflight-check.sh
#   ./deploy/preflight-check.sh --restore-file ~/backups/soc/soc-<TS>.sql.gz.enc
#   ./deploy/preflight-check.sh --min-disk-gb 15
# ─────────────────────────────────────────────────────────────────────────────
# Bewusst KEIN -e: wir wollen ALLE Checks sehen, nicht beim ersten Fehler abbrechen.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"
COMPOSE="$SCRIPT_DIR/docker-compose.prod.yml"
PASS_FILE="${SOC_BACKUP_PASS_FILE:-$HOME/.soc_backup_pass}"

RESTORE_FILE=""
MIN_DISK_GB=10   # Default-Mindestmaß; Postgres-Daten + Images + Build-Layer
while [ $# -gt 0 ]; do
  case "$1" in
    --restore-file) RESTORE_FILE="$2"; shift 2;;
    --min-disk-gb)  MIN_DISK_GB="$2"; shift 2;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 1;;
  esac
done

pass=0; fail=0
ok()   { echo "  [OK]   $1"; pass=$((pass+1)); }
bad()  { echo "  [FAIL] $1"; fail=$((fail+1)); }
warn() { echo "  [WARN] $1"; }

# ── 1. Tools ─────────────────────────────────────────────────────────────────
echo "==> 1. Tools (docker, git, openssl, curl, docker compose V2)"
for bin in docker git openssl curl; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin vorhanden"
  else bad "$bin fehlt — installieren (z.B. apt-get install $bin)"; fi
done
if docker compose version >/dev/null 2>&1; then ok "docker compose (V2) vorhanden"
else bad "'docker compose' (V2) fehlt — Paket docker-compose-plugin installieren"; fi
# Daemon wirklich erreichbar (nicht nur Binary vorhanden)?
if docker info >/dev/null 2>&1; then ok "Docker-Daemon erreichbar"
else bad "Docker-Daemon NICHT erreichbar — 'systemctl enable --now docker', oder fehlt die docker-Gruppe? (neu einloggen)"; fi

# ── 2. .env.production ───────────────────────────────────────────────────────
echo "==> 2. .env.production (Pflicht-Variablen, Platzhalter, CORS)"
if [ ! -f "$ENV_FILE" ]; then
  warn "$ENV_FILE fehlt — bei Fresh-Install erzeugt install-prod-fresh.sh sie automatisch (gen-env-production.sh)."
  warn "Beim UMZUG mit Daten muss die ALTE .env.production zuerst hierher kopiert werden (Secret-Kontinuität)."
  warn "Env-Variablen-Checks werden übersprungen (keine Datei vorhanden)."
else
  # Wert einer KEY=...-Zeile lesen (letzte Zuweisung gewinnt), ohne ihn auszugeben.
  envval() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }

  # Pflicht-Variablen müssen gesetzt (nicht leer) sein — spiegelt validateEnv.js.
  for key in JWT_SECRET DB_HOST DB_NAME DB_USER DB_PASSWORD AUDIT_IP_SALT; do
    if [ -n "$(envval "$key")" ]; then ok "$key gesetzt"
    else bad "$key fehlt oder leer in .env.production"; fi
  done

  # Mindestlängen für die kryptografischen Secrets (validateEnv: JWT/Salt ≥32).
  for key in JWT_SECRET AUDIT_IP_SALT; do
    v="$(envval "$key")"
    if [ -n "$v" ] && [ "${#v}" -lt 32 ]; then
      bad "$key zu kurz (${#v} Zeichen, min. 32) — neu generieren: openssl rand -hex 32"
    fi
  done

  # Platzhalter-Reste fangen — exakt die Keys, die validateEnv.js auf CHANGE_ME prüft.
  for key in JWT_SECRET DB_PASSWORD AUDIT_IP_SALT \
             WEBHOOK_SECRET_GENERIC WEBHOOK_SECRET_WAZUH WEBHOOK_SECRET_DATAPLANE ADMIN_PASSWORD; do
    v="$(envval "$key")"
    if printf '%s' "$v" | grep -qi 'CHANGE_ME'; then
      bad "$key enthält noch einen CHANGE_ME-Platzhalter — Secrets generieren (gen-env-production.sh)"
    fi
  done

  # Bekannte Entwicklungs-Defaults (würden den Fail-fast im Backend auslösen).
  [ "$(envval DB_PASSWORD)" = "devpassword" ] && bad "DB_PASSWORD ist der Dev-Default 'devpassword'"
  [ "$(envval AUDIT_IP_SALT)" = "dev-audit-ip-salt-change-in-production" ] && bad "AUDIT_IP_SALT ist der bekannte Dev-Default"
  [ "$(envval JWT_SECRET)" = "dev-secret-change-in-production-min-32-chars" ] && bad "JWT_SECRET ist der bekannte Dev-Default"

  # CORS darf in Prod kein * / localhost enthalten (validateEnv lehnt das ab).
  cors="$(envval CORS_ORIGINS)"
  if printf '%s' "$cors" | grep -Eq '\*|localhost'; then
    bad "CORS_ORIGINS enthält * oder localhost — in Prod nicht erlaubt (auf https://<domain> setzen)"
  elif [ -n "$cors" ]; then ok "CORS_ORIGINS gesetzt (kein * / localhost)"
  else warn "CORS_ORIGINS leer — install-prod-fresh.sh setzt es bei Fresh-Install aus --domain"; fi

  # Dateirechte: Secrets-Datei sollte 600 sein (kein Welt-/Gruppen-Lesen).
  perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '')"
  if [ "$perm" = "600" ]; then ok ".env.production hat Rechte 600"
  elif [ -n "$perm" ]; then warn ".env.production hat Rechte $perm (empfohlen: chmod 600)"; fi
fi

# ── 3. Restore-Voraussetzungen (nur wenn ein Backup eingespielt werden soll) ──
echo "==> 3. Restore (Backup-Passphrase + Probe-Decrypt)"
if [ -z "$RESTORE_FILE" ]; then
  warn "Kein --restore-file angegeben → Restore-Checks übersprungen (Fresh-Install ohne Altdaten)."
  warn "Beim UMZUG mit Daten: --restore-file <soc-*.sql.gz.enc> mitgeben, damit dies geprüft wird."
else
  if [ -s "$PASS_FILE" ]; then ok "Backup-Passphrase lesbar: $PASS_FILE"
  else bad "Passphrase-Datei fehlt/leer: $PASS_FILE (vom ALTEN Host mitbringen — sonst Backup unwiederherstellbar!)"; fi

  if [ -f "$RESTORE_FILE" ]; then
    ok "Backup-Archiv vorhanden: $RESTORE_FILE"
    if command -v openssl >/dev/null 2>&1 && [ -s "$PASS_FILE" ]; then
      # Probe-Decrypt: exakt dieselbe Pipeline wie restore-db.sh (AES-256-CBC, pbkdf2),
      # aber nur gzip -t (Integritätsprüfung) — KEINE echte Wiederherstellung, kein psql.
      if openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE" \
           -d -in "$RESTORE_FILE" 2>/dev/null | gzip -t 2>/dev/null; then
        ok "Probe-Decrypt + gzip-Integrität OK (richtige Passphrase, Archiv lesbar)"
      else
        bad "Backup NICHT entschlüsselbar/korrupt (falsche Passphrase?) — Restore würde fehlschlagen"
      fi
    else
      warn "Probe-Decrypt übersprungen (openssl oder Passphrase fehlt)"
    fi
  else
    bad "Backup-Archiv nicht gefunden: $RESTORE_FILE"
  fi
fi

# ── 4. Ports frei (aus dem Prod-Compose abgeleitet, nicht hartkodiert) ───────
echo "==> 4. Host-Ports frei (vom Prod-Compose veröffentlicht)"
PORTS=""
if [ -f "$COMPOSE" ]; then
  # Nur veröffentlichte Host-Ports: Zeilen wie  - "80:80"  /  - "443:443".
  # Linker Teil (Host) vor dem ersten ':' extrahieren.
  PORTS="$(grep -Eo '"[0-9]+:[0-9]+"' "$COMPOSE" | tr -d '"' | cut -d: -f1 | sort -u)"
fi
if [ -z "$PORTS" ]; then
  warn "Konnte keine veröffentlichten Ports aus $COMPOSE ableiten — Port-Check übersprungen."
else
  # Belegung prüfen — bevorzugt ss, sonst netstat; ohne beides: nicht prüfbar.
  port_in_use() {
    local p="$1"
    if command -v ss >/dev/null 2>&1; then
      ss -ltn 2>/dev/null | grep -Eq "[:.]$p[[:space:]]"
    elif command -v netstat >/dev/null 2>&1; then
      netstat -ltn 2>/dev/null | grep -Eq "[:.]$p[[:space:]]"
    else
      return 2   # kein Tool → unbekannt
    fi
  }
  for p in $PORTS; do
    port_in_use "$p"; rc=$?
    case "$rc" in
      0) bad "Port $p ist bereits belegt — Konflikt mit nginx (web). Belegenden Dienst stoppen.";;
      1) ok "Port $p frei";;
      *) warn "Port $p nicht prüfbar (weder ss noch netstat vorhanden)";;
    esac
  done
fi

# ── 5. Plattenplatz + Schreibrechte ──────────────────────────────────────────
echo "==> 5. Plattenplatz (≥ ${MIN_DISK_GB} GB) + Schreibrechte im Zielverzeichnis"
# Freien Platz in GB für das Repo-/Deploy-Verzeichnis ermitteln (-BG = GiB-Blöcke).
FREE_GB="$(df -BG "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}')"
if [ -n "$FREE_GB" ]; then
  if [ "$FREE_GB" -ge "$MIN_DISK_GB" ]; then ok "Freier Platz: ${FREE_GB} GB (min. ${MIN_DISK_GB} GB)"
  else bad "Nur ${FREE_GB} GB frei (min. ${MIN_DISK_GB} GB) — Images/DB könnten nicht passen"; fi
else
  warn "Freien Platz konnte nicht ermittelt werden (df) — manuell prüfen."
fi
# Schreibrechte: temporäre Datei anlegen + sofort entfernen (read-only-Garantie:
# das einzige hier Geschriebene wird umgehend gelöscht; nichts bleibt persistent).
PROBE="$SCRIPT_DIR/.preflight-write-probe.$$"
if ( : > "$PROBE" ) 2>/dev/null; then
  rm -f "$PROBE"
  ok "Schreibrechte im Zielverzeichnis ($SCRIPT_DIR)"
else
  bad "Keine Schreibrechte in $SCRIPT_DIR — als passender Benutzer ausführen"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
if [ "$fail" -eq 0 ]; then
  echo "  ✅ PREFLIGHT GRÜN — $pass Checks bestanden."
  echo "     Weiter mit: ./deploy/install-prod-fresh.sh --domain <…> --admin-email <…>"
  echo "============================================================"
  exit 0
else
  echo "  ❌ PREFLIGHT FEHLGESCHLAGEN — $fail von $((pass+fail)) Checks rot."
  echo "     Erst die FAIL-Zeilen oben beheben, DANN install-prod-fresh.sh starten."
  echo "============================================================"
  exit 1
fi
