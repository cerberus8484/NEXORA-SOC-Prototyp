#!/usr/bin/env bash
# Regression tests for production-safety gates in deploy/install.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$SCRIPT_DIR/../install.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

expect_failure() {
  local expected="$1"
  shift
  local output status
  set +e
  output="$(bash "$INSTALL" "$@" 2>&1)"
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "expected failure: $*"
  printf '%s' "$output" | grep -Fq "$expected" || fail "missing '$expected': $*"
}

expect_failure "ungültig" --profile core --domain 'bad domain' --admin-email admin@example.com --dry-run
expect_failure "ungültig" --profile core --domain soc.example --admin-email 'not-an-email' --dry-run
expect_failure "positive ganze Zahl" --profile core --domain soc.example --admin-email admin@example.com --min-disk-gb nope --dry-run
expect_failure "Collector/Intake-Stack fehlt" --profile all-in-one --domain soc.example --admin-email admin@example.com --dry-run

grep -Fq 'if ! "$SCRIPT_DIR/smoke-test.sh"; then' "$SCRIPT_DIR/../install-prod-fresh.sh" \
  || fail 'smoke-test failure is not propagated'
grep -Fq 'if ! "$SCRIPT_DIR/smoke-csp.sh"; then' "$SCRIPT_DIR/../install-prod-fresh.sh" \
  || fail 'smoke-csp failure is not propagated'
grep -Fq 'repl WAZUH_API_URL           ""' "$SCRIPT_DIR/../gen-env-production.sh" \
  || fail 'fresh install does not disable the example Wazuh endpoint'
grep -Fq 'repl OLLAMA_BASE_URL         ""' "$SCRIPT_DIR/../gen-env-production.sh" \
  || fail 'fresh install does not disable the example Ollama endpoint'
grep -Fq 'repl TLS_CERT_PATH          "$TLS_CERT_PATH"' "$SCRIPT_DIR/../gen-env-production.sh" \
  || fail 'environment generator does not support an explicit certificate path'
grep -Fq -- '--quiet-initial-login' "$SCRIPT_DIR/../gen-env-production.sh" \
  || fail 'environment generator cannot suppress duplicate initial-login output'
grep -Fq 'ADMIN-ERSTANMELDUNG — JETZT SICHER NOTIEREN' "$INSTALL" \
  || fail 'all-in-one installer does not show first-install login details at completion'
grep -Fq 'UI (IP):  https://${host_ip}:443/' "$SCRIPT_DIR/../install-prod-fresh.sh" \
  || fail 'fresh installer does not show the direct host IP and HTTPS port'

printf 'OK: production installer safety gates\n'
