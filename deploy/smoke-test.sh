#!/usr/bin/env bash
# Post-Install/Deploy-Smoke-Test für Nexora SOC.
#
# Prüft in ~10s, ob ein frischer Install/Umzug gesund ist — OHNE Zugangsdaten:
#   1. Container laufen + sind healthy
#   2. /health → status ok, db ok
#   3. Auth ist verdrahtet: geschützte Route ohne Token → 401 (nicht 200/404)
#   4. Kern-Routen sind gemountet (401 statt 404) — inkl. der neuen /collectors/pipeline
#   5. Login-Endpunkt lebt: falsche Credentials → 401 (nicht 500/404)
#   6. Migrationen: schema_migrations-Anzahl == Anzahl .sql-Dateien
#
# Exit 0 = alles grün; sonst non-zero + klare FAIL-Zeilen. Read-only, ändert nichts.
#
# Nutzung (auf dem Host):  ./deploy/smoke-test.sh
set -uo pipefail   # bewusst KEIN -e: wir wollen alle Checks sehen, nicht beim ersten abbrechen

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${SOC_SMOKE_BASE_URL:-https://localhost}"
PG_CONTAINER="${SOC_PG_CONTAINER:-soc_postgres_prod}"
API_CONTAINER="${SOC_API_CONTAINER:-soc_api_prod}"
WEB_CONTAINER="${SOC_WEB_CONTAINER:-soc_web_prod}"
MIG_DIR="$SCRIPT_DIR/../backend/src/db/migrations"

pass=0; fail=0
ok()   { echo "  [OK]   $1"; pass=$((pass+1)); }
bad()  { echo "  [FAIL] $1"; fail=$((fail+1)); }

# HTTP-Statuscode einer Route holen (-k: self-signed TLS erlaubt).
code() { curl -k -s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }

echo "==> 1. Container"
for c in "$PG_CONTAINER" "$API_CONTAINER" "$WEB_CONTAINER"; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then ok "$c läuft"; else bad "$c läuft NICHT"; fi
done

echo "==> 2. /health"
HEALTH="$(curl -k -s "$BASE/api/v1/health" 2>/dev/null)"
echo "$HEALTH" | grep -q '"status":"ok"' && ok "status ok" || bad "status nicht ok ($HEALTH)"
echo "$HEALTH" | grep -q '"db":"ok"'     && ok "db ok"     || bad "db nicht ok"

echo "==> 3./4. Auth verdrahtet + Kern-Routen gemountet (erwarte 401)"
# Hinweis: der hosts-Router hat bewusst keine bare 'GET /' (Host-Liste kommt aus dem
# SIEM); auth-gated ist z.B. 'GET /hosts/manual' → daher den prüfen, nicht '/hosts'.
for path in /api/v1/tickets /api/v1/collectors/pipeline /api/v1/collectors/activity /api/v1/audit /api/v1/hosts/manual; do
  c="$(code "$BASE$path")"
  if [ "$c" = "401" ]; then ok "$path → 401 (gemountet, auth-gated)"
  else bad "$path → $c (erwartet 401)"; fi
done

echo "==> 5. Login-Endpunkt lebt (falsche Credentials → 401)"
c="$(code -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' -d '{"email":"smoke@invalid","password":"nope"}')"
[ "$c" = "401" ] && ok "/auth/login → 401 bei falschen Credentials" || bad "/auth/login → $c (erwartet 401)"

echo "==> 6. Migrationen vollständig (schema_migrations == Datei-Anzahl)"
if [ -d "$MIG_DIR" ]; then
  EXPECTED="$(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
  APPLIED="$(docker exec "$PG_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM schema_migrations"' 2>/dev/null | tr -d ' ')"
  if [ -n "$APPLIED" ] && [ "$APPLIED" = "$EXPECTED" ]; then ok "Migrationen: $APPLIED/$EXPECTED angewandt"
  else bad "Migrationen: $APPLIED angewandt, erwartet $EXPECTED"; fi
else
  bad "Migrations-Verzeichnis nicht gefunden: $MIG_DIR"
fi

echo ""
echo "============================================================"
if [ "$fail" -eq 0 ]; then
  echo "  ✅ SMOKE-TEST GRÜN — $pass Checks bestanden."
  echo "============================================================"
  exit 0
else
  echo "  ❌ SMOKE-TEST FEHLGESCHLAGEN — $fail von $((pass+fail)) Checks rot."
  echo "     Logs: ./deploy/soc.sh logs api"
  echo "============================================================"
  exit 1
fi
