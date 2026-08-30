#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Gemeinsame Helfer fuer alle Lab-Scripts: Logging, Guards, Idempotenz.
# Wird von deploy-lab.sh und jeder Phase per `source` geladen.
# ─────────────────────────────────────────────────────────────────────────────

# Farben (nur wenn TTY)
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_INFO=$'\e[36m'; C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_STEP=$'\e[35m'
else
  C_RESET=""; C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_STEP=""
fi

log()   { echo "${C_INFO}ℹ️  $*${C_RESET}"; }
ok()    { echo "${C_OK}✔️  $*${C_RESET}"; }
warn()  { echo "${C_WARN}⚠️  $*${C_RESET}" >&2; }
step()  { echo; echo "${C_STEP}━━━ $* ━━━${C_RESET}"; }
die()   { echo "${C_ERR}🔴 FEHLER: $*${C_RESET}" >&2; exit 1; }

# Bestaetigung an manuellen Toren (z.B. OPNsense-GUI). Respektiert --yes.
confirm() {
  local prompt="$1"
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  read -r -p "${C_WARN}⏸  ${prompt} [Enter=weiter / Strg-C=abbrechen] ${C_RESET}" _
}

# Pflicht-Tool vorhanden?
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Befehl '$1' nicht gefunden — bitte installieren."; }

# Pflicht-Env-Var gesetzt (Secrets)?
need_env() {
  local var="$1"
  [[ -n "${!var:-}" ]] || die "Umgebungsvariable \$$var ist leer. secrets.env laden (siehe secrets.env.example)."
}

# Laeuft auf einem Proxmox-Host?
assert_proxmox() {
  command -v qm  >/dev/null 2>&1 || die "Dieses Script gehoert auf den PROXMOX-Host (qm fehlt)."
  command -v pvesm >/dev/null 2>&1 || die "pvesm fehlt — kein Proxmox-Host?"
}

# Existiert eine VM mit dieser ID? (Idempotenz-Check)
vm_exists()  { qm status "$1" >/dev/null 2>&1; }
vm_running() { qm status "$1" 2>/dev/null | grep -q "status: running"; }

# Wartet bis der QEMU-Guest-Agent in der VM antwortet (oder Timeout).
wait_for_agent() {
  local vmid="$1" timeout="${2:-$GUEST_EXEC_TIMEOUT}" waited=0
  log "Warte auf Guest-Agent in VM ${vmid} (max ${timeout}s) …"
  while (( waited < timeout )); do
    if qm guest exec "$vmid" -- cmd /c "echo ok" >/dev/null 2>&1 \
       || qm guest exec "$vmid" -- hostname >/dev/null 2>&1; then
      ok "Guest-Agent in VM ${vmid} bereit."
      return 0
    fi
    sleep 10; waited=$((waited+10))
  done
  die "Guest-Agent in VM ${vmid} nach ${timeout}s nicht erreichbar."
}

# Fuehrt PowerShell remote in einer Windows-VM aus, bricht bei Fehler ab.
win_ps() {
  local vmid="$1"; shift
  qm guest exec "$vmid" -- powershell -NoProfile -NonInteractive -Command "$*" \
    || die "PowerShell-Befehl in VM ${vmid} fehlgeschlagen."
}

# Fuehrt PowerShell remote aus und gibt NUR die Ausgabe (out-data) zurueck.
# Bricht NICHT ab (fuer Doku-Sammlung) — liefert leeren String bei Fehler.
win_capture() {
  local vmid="$1"; shift
  qm guest exec "$vmid" --timeout 120 -- powershell -NoProfile -NonInteractive -Command "$*" 2>/dev/null \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); sys.stdout.write(d.get("out-data","") or "")
except Exception:
    pass' 2>/dev/null
}

# Verzeichnis dieses Script-Bundles (robust gegen Aufrufort)
lab_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }
