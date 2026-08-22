#!/usr/bin/env bash
# Nexora + Wazuh, schlanke lokale Ein-Knoten-Installation.
#
# Lädt die offizielle, gepinnte Wazuh-Docker-Konfiguration erst zur Laufzeit in
# deploy/.runtime (nie ins öffentliche Repository), rotiert die benutzten
# Standardzugänge vor der produktiven Nexora-Anbindung und erstellt einen
# einmaligen Bootstrap-Report. Wazuh erhält keinen SSH-Daemon.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEXORA_ENV="$SCRIPT_DIR/.env.production"
NEXORA_SOC="$SCRIPT_DIR/soc.sh"
RUNTIME_DIR="$SCRIPT_DIR/.runtime/wazuh-docker-single-node-final"
WAZUH_VERSION="4.14.7"
DASHBOARD_PORT="8443"
SHARED_NETWORK="nexora_wazuh"

die() { echo "FEHLER: $*" >&2; exit 1; }
info() { echo "==> $*"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --nexora-env) NEXORA_ENV="${2:?fehlender Wert}"; shift 2;;
    --dashboard-port) DASHBOARD_PORT="${2:?fehlender Wert}"; shift 2;;
    --wazuh-version) WAZUH_VERSION="${2:?fehlender Wert}"; shift 2;;
    --help) sed -n '1,20p' "$0"; exit 0;;
    *) die "Unbekanntes Argument: $1";;
  esac
done

[[ "$DASHBOARD_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$DASHBOARD_PORT" -le 65535 ] || die "Ungültiger Dashboard-Port."
[ -f "$NEXORA_ENV" ] || die "Nexora-ENV fehlt: $NEXORA_ENV"
[ -x "$NEXORA_SOC" ] || die "Nexora-Wrapper fehlt oder ist nicht ausführbar: $NEXORA_SOC"
for bin in docker git openssl ssh-keygen awk sed grep; do command -v "$bin" >/dev/null || die "'$bin' fehlt"; done
docker compose version >/dev/null 2>&1 || die "docker compose V2 fehlt"
docker info >/dev/null 2>&1 || die "Docker-Daemon ist nicht erreichbar"

set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$NEXORA_ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$NEXORA_ENV"
  else
    printf '%s=%s\n' "$key" "$value" >> "$NEXORA_ENV"
  fi
}
env_value() { grep -m1 -E "^$1=" "$NEXORA_ENV" | cut -d= -f2-; }
password() {
  local p
  p="Nxr$(openssl rand -hex 18).A1"
  printf '%s' "$p"
}
replace_user_hash() {
  local user="$1" hash="$2" file="$3" tmp="${3}.tmp"
  awk -v user="$user" -v hash="$hash" '
    $0 == user ":" { active=1 }
    active && /^  hash:/ { print "  hash: \"" hash "\""; active=0; next }
    { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}
hash_password() {
  local pw="$1" out hash tmp tmp_docker
  # Das ist das offizielle Wazuh-Indexer-Hashwerkzeug. Das Passwort gelangt nur
  # über stdin in den kurzlebigen Container, nicht in Argumente oder Logs.
  tmp="$SCRIPT_DIR/.runtime/.wazuh-hash-env.$$"
  umask 077
  printf 'WAZUH_HASH_PASSWORD=%s\n' "$pw" > "$tmp"
  tmp_docker="$tmp"
  command -v cygpath >/dev/null 2>&1 && tmp_docker="$(cygpath -w "$tmp")"
  out="$(MSYS_NO_PATHCONV=1 docker run --rm --env-file "$tmp_docker" "wazuh/wazuh-indexer:${WAZUH_VERSION}" \
    bash /usr/share/wazuh-indexer/plugins/opensearch-security/tools/hash.sh -env WAZUH_HASH_PASSWORD 2>&1)" || { rm -f "$tmp"; die "Indexer-Hash konnte nicht erzeugt werden"; }
  rm -f "$tmp"
  hash="$(printf '%s\n' "$out" | grep -Eo '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' | tail -1 || true)"
  [ -n "$hash" ] || die "Indexer-Hashwerkzeug lieferte keinen bcrypt-Hash"
  printf '%s' "$hash"
}

# Docker Desktop mit WSL2 braucht diesen Kernelwert für den Wazuh-Indexer.
if command -v wsl.exe >/dev/null 2>&1; then
  info "WSL2 Kernel-Limit vm.max_map_count setzen"
  wsl.exe -d docker-desktop -u root -- sysctl -w vm.max_map_count=262144 >/dev/null 2>&1 \
    || die "WSL2-Limit konnte nicht gesetzt werden. In einer administrativen WSL-Shell ausführen: sysctl -w vm.max_map_count=262144"
fi

mkdir -p "$SCRIPT_DIR/.runtime"
chmod 700 "$SCRIPT_DIR/.runtime"
MARKER="$RUNTIME_DIR/.nexora-bootstrap-complete"
if [ -f "$MARKER" ]; then
  echo "Wazuh ist bereits bootstrapped. Zugangsdaten werden absichtlich nicht erneut angezeigt."
  exit 0
fi

if [ ! -d "$RUNTIME_DIR/.git" ]; then
  info "Offizielle Wazuh-Docker-Konfiguration v${WAZUH_VERSION} laden"
  git clone --depth 1 --branch "v${WAZUH_VERSION}" https://github.com/wazuh/wazuh-docker.git "$RUNTIME_DIR"
fi

STACK_DIR="$RUNTIME_DIR/single-node"
COMPOSE="$STACK_DIR/docker-compose.yml"
[ -f "$COMPOSE" ] || die "Offizielle Single-Node-Compose-Datei fehlt"

SECRETS_FILE="$RUNTIME_DIR/.nexora-bootstrap-secrets"
if [ -f "$SECRETS_FILE" ]; then
  # Nur vom Installer erzeugte, restriktiv geschützte Werte; erlaubt einen
  # sicheren Wiederanlauf nach Netzwerk-/Imagefehlern ohne Credential-Drift.
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
else
  ADMIN_PASSWORD="$(password)"
  KIBANA_PASSWORD="$(password)"
  WUI_PASSWORD="$(password)"
  umask 077
  printf 'ADMIN_PASSWORD=%s\nKIBANA_PASSWORD=%s\nWUI_PASSWORD=%s\n' "$ADMIN_PASSWORD" "$KIBANA_PASSWORD" "$WUI_PASSWORD" > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi
ADMIN_HASH="$(hash_password "$ADMIN_PASSWORD")"
KIBANA_HASH="$(hash_password "$KIBANA_PASSWORD")"

info "Wazuh-Standardzugänge rotieren und externe Admin-Ports minimieren"
replace_user_hash admin "$ADMIN_HASH" "$STACK_DIR/config/wazuh_indexer/internal_users.yml"
replace_user_hash kibanaserver "$KIBANA_HASH" "$STACK_DIR/config/wazuh_indexer/internal_users.yml"
# Version-gepinnte Vorlage: nur die bekannten Defaultwerte ersetzen, ohne $-Escaping.
sed -i "s/SecretPassword/${ADMIN_PASSWORD}/g; s/DASHBOARD_PASSWORD=kibanaserver/DASHBOARD_PASSWORD=${KIBANA_PASSWORD}/g; s/MyS3cr37P450r\.\*-/${WUI_PASSWORD}/g; /\"55000:55000\"/d; /\"9200:9200\"/d" "$COMPOSE"
# Kein Teilstring-Austausch: Ein erneuter Installer-Lauf darf aus 8443 nicht 88443 machen.
sed -E -i "s#^([[:space:]]*-[[:space:]]*)[0-9]+:5601#\\1${DASHBOARD_PORT}:5601#" "$COMPOSE"
# Nach Entfernen des einzigen Indexer-Port-Mappings darf kein leeres YAML-Feld
# zurückbleiben (Compose wertet `ports:` ohne Liste als ungültig).
sed -i '/^  wazuh\.indexer:/,/^  wazuh\.dashboard:/ { /^    ports:$/d }' "$COMPOSE"
sed -i "s/MyS3cr37P450r\.\*-/${WUI_PASSWORD}/g" "$STACK_DIR/config/wazuh_dashboard/wazuh.yml"

WAZUH_OVERRIDE="$STACK_DIR/docker-compose.nexora-bridge.yml"
cat > "$WAZUH_OVERRIDE" <<'SERVICES'
services:
  wazuh.manager:
    networks:
      default:
      nexora_wazuh:
        aliases: [wazuh.manager]
  wazuh.indexer:
    networks:
      default:
      nexora_wazuh:
        aliases: [wazuh.indexer]
networks:
  nexora_wazuh:
    external: true
    name: nexora_wazuh
SERVICES

docker network inspect "$SHARED_NETWORK" >/dev/null 2>&1 || docker network create "$SHARED_NETWORK" >/dev/null

if [ ! -f "$STACK_DIR/config/wazuh_indexer_ssl_certs/root-ca.pem" ]; then
  info "Indexer-Zertifikate erzeugen"
  ( cd "$STACK_DIR" && docker compose -f generate-indexer-certs.yml run --rm generator )
else
  info "Vorhandene Indexer-Zertifikate wiederverwenden"
fi
info "Wazuh Single Node starten (Manager, Indexer, Dashboard)"
( cd "$STACK_DIR" && docker compose -f "$COMPOSE" -f "$WAZUH_OVERRIDE" up -d )

info "Auf Wazuh-Indexer warten (maximal 5 Minuten)"
ready=0
for _ in $(seq 1 60); do
  if ( cd "$STACK_DIR" && docker compose -f "$COMPOSE" -f "$WAZUH_OVERRIDE" exec -T wazuh.indexer curl -ksfu "admin:${ADMIN_PASSWORD}" https://localhost:9200 >/dev/null 2>&1 ); then ready=1; break; fi
  sleep 5
done
[ "$ready" -eq 1 ] || die "Wazuh-Indexer wurde nicht bereit. Diagnose: cd '$STACK_DIR' && docker compose logs --tail=200"

# Der Manager erzeugt sein API-Zertifikat beim ersten Start. Pin statt unsicherer
# TLS-Deaktivierung: Jede spätere Zertifikatsänderung blockiert die Nexora-Verbindung.
API_CERT_HOST="$RUNTIME_DIR/wazuh-api-server.crt"
API_FP=""
for _ in $(seq 1 30); do
  (cd "$STACK_DIR" && MSYS_NO_PATHCONV=1 docker compose -f docker-compose.yml -f docker-compose.nexora-bridge.yml exec -T -u root wazuh.manager cat /var/ossec/api/configuration/ssl/server.crt) > "$API_CERT_HOST" 2>/dev/null || true
  API_FP="$(openssl x509 -in "$API_CERT_HOST" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || true)"
  [ -n "$API_FP" ] && break
  sleep 2
done
[ -n "$API_FP" ] || die "Wazuh-API-Zertifikat/Fingerprint konnte nicht gelesen werden"
CA_PATH="$STACK_DIR/config/wazuh_indexer_ssl_certs/root-ca.pem"
[ -f "$CA_PATH" ] || die "Wazuh-Indexer-CA fehlt"
# Eine CA ist öffentliches Trust-Material (kein privater Schlüssel). Der nicht als
# root laufende Nexora-API-Container muss sie für die Indexer-Chain prüfen können.
chmod 644 "$CA_PATH"
INDEXER_FP="$(openssl x509 -in "$STACK_DIR/config/wazuh_indexer_ssl_certs/wazuh.indexer.pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || true)"
[ -n "$INDEXER_FP" ] || die "Wazuh-Indexer-Zertifikat/Fingerprint konnte nicht gelesen werden"

KEY_DIR="$SCRIPT_DIR/.runtime/nexora-operator-ssh"
mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
SSH_KEY="$KEY_DIR/id_ed25519"
if [ ! -f "$SSH_KEY" ]; then
  info "Lokales ED25519-Operator-Keypair erzeugen (kein SSH-Daemon wird geöffnet)"
  ssh-keygen -q -t ed25519 -N '' -f "$SSH_KEY" -C 'nexora-wazuh-operator' </dev/null
  chmod 600 "$SSH_KEY"; chmod 644 "$SSH_KEY.pub"
fi

set_env NEXORA_WAZUH_ENABLED true
set_env WAZUH_SHARED_NETWORK "$SHARED_NETWORK"
set_env WAZUH_INDEXER_CA_PATH "$CA_PATH"
set_env WAZUH_API_URL https://wazuh.manager:55000
set_env WAZUH_API_USER wazuh-wui
set_env WAZUH_API_PASSWORD "$WUI_PASSWORD"
set_env WAZUH_API_TLS_FINGERPRINT "$API_FP"
set_env WAZUH_INDEXER_URL https://wazuh.indexer:9200
set_env WAZUH_INDEXER_USER admin
set_env WAZUH_INDEXER_PASSWORD "$ADMIN_PASSWORD"
set_env WAZUH_INDEXER_TLS_FINGERPRINT "$INDEXER_FP"
set_env WAZUH_TLS_REJECT_UNAUTHORIZED true
chmod 600 "$NEXORA_ENV"

info "Nexora mit geprüfter Wazuh-Anbindung neu starten"
"$NEXORA_SOC" up api web

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
# Git-Bash auf Windows liefert häufig keine LAN-Adresse über hostname -I. Für
# Agenten ist die Adresse der Schnittstelle mit Default-Gateway die richtige,
# nicht der WSL-/Docker-vEthernet-Adapter.
if [ -z "$HOST_IP" ] && command -v powershell.exe >/dev/null 2>&1; then
  HOST_IP="$(powershell.exe -NoProfile -Command '(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1 -ExpandProperty IPv4Address | Select-Object -ExpandProperty IPAddress)' 2>/dev/null | tr -d '\r' | head -1)"
fi
BOOTSTRAP="$SCRIPT_DIR/.runtime/wazuh-bootstrap-once.txt"
umask 077
cat > "$BOOTSTRAP" <<REPORT
NEXORA + WAZUH INITIAL ACCESS (displayed once)
Nexora URL: https://localhost/
Wazuh Dashboard: https://${HOST_IP:-localhost}:${DASHBOARD_PORT}/
Wazuh manager address for agents: ${HOST_IP:-<host-ip>}:1514 (enrollment TCP 1515, syslog UDP 514)

Wazuh Dashboard user: admin
Wazuh Dashboard password: ${ADMIN_PASSWORD}
Nexora integration API user: wazuh-wui
Nexora integration API password: ${WUI_PASSWORD}
Nexora Wazuh webhook secret: $(env_value WEBHOOK_SECRET_WAZUH)
Wazuh API certificate SHA-256 pin: ${API_FP}

Operator SSH private key: ${SSH_KEY}
Operator SSH public key: $(cat "${SSH_KEY}.pub")
No SSH daemon or port was enabled by this installation. Add this public key only to a host you explicitly administer.

IMPORTANT: This report is deleted in 10 minutes. Terminal scrollback cannot be securely erased by a script; close the terminal after storing the values in your password manager.
REPORT
chmod 600 "$BOOTSTRAP"
cat "$BOOTSTRAP"
( sleep 600; rm -f "$BOOTSTRAP" ) >/dev/null 2>&1 &
touch "$MARKER"
chmod 600 "$MARKER"
rm -f "$SECRETS_FILE"
echo "Hinweis: Der geschützte Bootstrap-Report wird in 10 Minuten gelöscht; Zugänge werden bei Wiederholung nicht erneut ausgegeben."
