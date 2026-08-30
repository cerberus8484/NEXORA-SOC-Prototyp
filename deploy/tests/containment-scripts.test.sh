#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ADR-042 Slice 3a — Script-Level-Test der Isolations-Skripte (Arming-Blocker H-4).
#
# Testet die generierte nftables-Ruleset-STRUKTUR + die Kern-Invariante MGMT-PRESERVATION
# ohne echten Kernel: `nft` wird durch ein ZUSTANDSBEHAFTETES Fake ersetzt, das das
# angewandte Ruleset speichert und `list table/chain` daraus bedient. Damit laufen die
# Self-Verify-Pfade der Skripte real durch — inkl. der grep-Prüfungen.
#
# ABGRENZUNG: Dies ist ein STRUKTUR-/Contract-Test (welche Regeln, in welcher Reihenfolge).
# Die SEMANTISCHE Preservation (überlebt eine echte SSH-Session?) braucht einen Linux-Host
# mit netns + echtem sshd — das bleibt der dokumentierte Lab-Smoke-Arming-Blocker.
#
# Läuft überall mit bash (inkl. Git-Bash/MSYS auf dem Dev-Rechner). Exit 0 = alle grün.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$HERE/.." && pwd)"
ISOLATE="$DEPLOY_DIR/isolate-host.sh"
RELEASE="$DEPLOY_DIR/release-isolation.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export NFT_STATE="$WORK/ruleset.applied"

# ── Fake `nft` (zustandsbehaftet) ────────────────────────────────────────────
FAKEBIN="$WORK/bin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/nft" <<'FAKE'
#!/usr/bin/env bash
# Minimaler nft-Ersatz: -f - speichert stdin; list liest den Zustand; delete löscht ihn.
case "${1:-}" in
  -f)      cat > "$NFT_STATE" ;;
  list)    if [ -f "$NFT_STATE" ]; then cat "$NFT_STATE"; else exit 1; fi ;;
  delete)  rm -f "$NFT_STATE" ;;
  *)       exit 0 ;;
esac
FAKE
chmod +x "$FAKEBIN/nft"
export PATH="$FAKEBIN:$PATH"

# ── Mini-Assert-Framework ────────────────────────────────────────────────────
PASS=0; FAIL=0
ok(){ echo "  ok   — $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL — $1"; FAIL=$((FAIL+1)); }
assert_eq(){ [ "$1" = "$2" ] && ok "$3" || bad "$3 (erwartet '$2', war '$1')"; }
assert_has(){ grep -qF -- "$2" "$1" && ok "$3" || bad "$3 (fehlt: $2)"; }
assert_no_re(){ grep -qE -- "$2" "$1" && bad "$3 (gefunden: $2)" || ok "$3"; }
reset_state(){ rm -f "$NFT_STATE"; }

run_isolate(){ # $1=MGMT_CIDR $2=MGMT_PORT $3=SSH_CONNECTION  → setzt $RC, Ruleset in $NFT_STATE
  reset_state
  RC=0
  env NEXORA_MGMT_CIDR="$1" NEXORA_MGMT_SSH_PORT="$2" SSH_CONNECTION="$3" \
    bash "$ISOLATE" >/dev/null 2>&1 || RC=$?
}

echo "== isolate-host.sh — Struktur + Mgmt-Preservation =="

# 1) Happy Path: gültige Mgmt-CIDR + Live-SSH-Peer (Server-Port 22).
run_isolate "10.0.10.0/24" "22" "10.0.10.75 51000 10.0.10.80 22"
assert_eq "$RC" "0" "Exit 0 bei gültiger Isolation"
assert_has "$NFT_STATE" "add table inet nexora_containment"                              "Tabelle wird angelegt"
assert_has "$NFT_STATE" "delete table inet nexora_containment"                            "add→delete→add (idempotenter Reset)"
assert_has "$NFT_STATE" "policy drop"                                                     "policy drop gesetzt"
assert_has "$NFT_STATE" "ct state established,related accept"                             "established,related erhalten (Session überlebt)"
assert_has "$NFT_STATE" "input  ip saddr 10.0.10.0/24 tcp dport 22 accept"               "Mgmt-CIDR-Preservation-Regel (input, port-scoped)"
assert_has "$NFT_STATE" "input  ip saddr 10.0.10.75/32 tcp dport 22 accept"              "Live-Control-Channel aus \$SSH_CONNECTION erhalten"
# H-1: KEIN breiter Output-daddr-Accept (Isolation muss eng sein).
assert_no_re "$NFT_STATE" "output.*ip daddr.*accept"                                      "Output-Chain hat KEINEN breiten daddr-Accept (H-1)"

# 2) M-2: Nicht-Standard-SSH-Port wird aus \$SSH_CONNECTION übernommen (kein Lockout).
run_isolate "10.0.10.0/24" "22" "10.0.10.75 51000 10.0.10.80 2222"
assert_eq "$RC" "0" "Exit 0 bei Nicht-Standard-Port"
assert_has "$NFT_STATE" "input  ip saddr 10.0.10.75/32 tcp dport 2222 accept"            "Control-Channel-Port = echter Verbindungsport 2222 (M-2)"

# 3) Fail-closed: ohne Mgmt-CIDR wird NICHT isoliert (Selbst-Aussperr-Schutz).
run_isolate "" "22" "10.0.10.75 51000 10.0.10.80 22"
[ "$RC" -ne 0 ] && ok "Exit != 0 ohne NEXORA_MGMT_CIDR" || bad "Exit != 0 ohne NEXORA_MGMT_CIDR (war $RC)"
[ ! -f "$NFT_STATE" ] && ok "kein Ruleset angewandt ohne Mgmt-CIDR (fail-closed vor nft)" || bad "Ruleset trotz fehlender Mgmt-CIDR angewandt"

# 4) Fail-closed: unplausible Mgmt-CIDR wird abgewiesen.
run_isolate "not-a-cidr" "22" "10.0.10.75 51000 10.0.10.80 22"
[ "$RC" -ne 0 ] && ok "Exit != 0 bei ungültiger Mgmt-CIDR" || bad "ungültige Mgmt-CIDR nicht abgewiesen (war $RC)"

echo "== release-isolation.sh — idempotente Freigabe =="

# 5) Aktive Isolation → Freigabe entfernt die Tabelle, Exit 0.
printf 'add table inet nexora_containment\n' > "$NFT_STATE"
RC=0; bash "$RELEASE" >/dev/null 2>&1 || RC=$?
assert_eq "$RC" "0" "Exit 0 bei aktiver Isolation"
[ ! -f "$NFT_STATE" ] && ok "Tabelle nach Freigabe entfernt" || bad "Tabelle nach Freigabe noch vorhanden"

# 6) Keine aktive Isolation → Freigabe ist idempotent (Exit 0, nichts zu tun).
reset_state
RC=0; bash "$RELEASE" >/dev/null 2>&1 || RC=$?
assert_eq "$RC" "0" "Exit 0 ohne aktive Isolation (idempotent)"

echo ""
echo "Ergebnis: $PASS ok, $FAIL fehlgeschlagen"
[ "$FAIL" -eq 0 ]
