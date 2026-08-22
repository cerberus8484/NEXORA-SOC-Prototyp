#!/usr/bin/env sh
# CSP/HSTS-Smoke-Test für das Web-Frontend hinter nginx.
#
# Prüft read-only:
#   1. SPA-Root (/) liefert HSTS + strenge SPA-CSP
#   2. nginx-Health liefert HSTS + Basis-Sicherheitsheader
#
# Nutzung:
#   sh deploy/smoke-csp.sh
#   SOC_SMOKE_BASE_URL=https://nexora.example sh deploy/smoke-csp.sh
#
# Exit 0 = alles grün, sonst non-zero + klare FAIL-Zeilen.
# POSIX-sh-kompatibel: die CI ruft `sh deploy/smoke-csp.sh`, und dash kennt `pipefail` nicht
# ("Illegal option -o pipefail"). Fehlererkennung läuft ohnehin über Leerwert-Checks je Header,
# nicht über den Pipe-Exit-Status. pipefail zusätzlich aktivieren, falls die Shell es kann (bash).
set -u
( set -o pipefail ) 2>/dev/null && set -o pipefail

BASE="${SOC_SMOKE_BASE_URL:-https://localhost}"

SPA_CSP_DEFAULT="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
HSTS_DEFAULT="max-age=31536000; includeSubDomains"

SPA_CSP_EXPECTED="${SOC_SMOKE_SPA_CSP:-$SPA_CSP_DEFAULT}"
HSTS_EXPECTED="${SOC_SMOKE_HSTS:-$HSTS_DEFAULT}"

pass=0; fail=0
ok()  { echo "  [OK]   $1"; pass=$((pass+1)); }
bad() { echo "  [FAIL] $1"; fail=$((fail+1)); }

fetch_headers() {
  curl -k -sS -D - -o /dev/null "$1" 2>/dev/null | tr -d '\r'
}

header_value() {
  awk -v key="$1" '
    BEGIN { IGNORECASE = 1 }
    tolower($0) ~ ("^" tolower(key) ":") {
      sub(/^[^:]+:[[:space:]]*/, "", $0)
      print
      exit
    }
  '
}

expect_header() {
  local url="$1" key="$2" expected="$3" label="$4"
  local headers value
  headers="$(fetch_headers "$url")"
  value="$(printf '%s\n' "$headers" | header_value "$key")"
  if [ -z "$value" ]; then
    bad "$label → Header '$key' fehlt"
  elif [ "$value" = "$expected" ]; then
    ok "$label → $key korrekt"
  else
    bad "$label → $key unerwartet: '$value'"
  fi
}

expect_present() {
  local url="$1" key="$2" label="$3"
  local headers value
  headers="$(fetch_headers "$url")"
  value="$(printf '%s\n' "$headers" | header_value "$key")"
  if [ -n "$value" ]; then
    ok "$label → $key vorhanden"
  else
    bad "$label → $key fehlt"
  fi
}

echo "==> 1. SPA-Root"
expect_header  "$BASE/" "Strict-Transport-Security" "$HSTS_EXPECTED" "SPA /"
expect_header  "$BASE/" "Content-Security-Policy"   "$SPA_CSP_EXPECTED" "SPA /"
expect_present "$BASE/" "X-Content-Type-Options" "SPA /"
expect_present "$BASE/" "X-Frame-Options"        "SPA /"
expect_present "$BASE/" "Referrer-Policy"        "SPA /"
expect_present "$BASE/" "Permissions-Policy"     "SPA /"

echo "==> 2. nginx-Health"
expect_header  "$BASE/nginx-health" "Strict-Transport-Security" "$HSTS_EXPECTED" "Health /nginx-health"
expect_present "$BASE/nginx-health" "X-Content-Type-Options" "Health /nginx-health"
expect_present "$BASE/nginx-health" "X-Frame-Options"        "Health /nginx-health"
expect_present "$BASE/nginx-health" "Referrer-Policy"        "Health /nginx-health"
expect_present "$BASE/nginx-health" "Permissions-Policy"     "Health /nginx-health"

echo ""
echo "============================================================"
if [ "$fail" -eq 0 ]; then
  echo "  ✅ CSP/HSTS-SMOKE GRÜN — $pass Checks bestanden."
  echo "============================================================"
  exit 0
else
  echo "  ❌ CSP/HSTS-SMOKE FEHLGESCHLAGEN — $fail von $((pass+fail)) Checks rot."
  echo "============================================================"
  exit 1
fi
