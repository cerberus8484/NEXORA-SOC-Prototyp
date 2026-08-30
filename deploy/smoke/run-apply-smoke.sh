#!/usr/bin/env bash
# P_CORR_ADMIN_2 — reproduzierbarer End-to-End Apply-Smoke-Runner.
#
# Fährt ein ISOLIERTES Postgres hoch (eigener Container/Port 5544, flüchtiges tmpfs),
# wartet auf Health, führt den echten Apply-Smoke (Node, echtes Postgres + echter Worker)
# aus und räumt am Ende ALLES wieder ab (down -v + orphans). CONFIG_APPLY_ENABLED wird
# NUR im Node-Prozess gesetzt — außerhalb unberührt.
#
# Usage:  bash deploy/smoke/run-apply-smoke.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE="$HERE/docker-compose.apply-smoke.yml"
PROJECT="apply-smoke"

cleanup() {
  echo "── Cleanup: Container + Volume entfernen ──"
  docker compose -p "$PROJECT" -f "$COMPOSE" down -v --remove-orphans || true
  echo "── verbleibende Smoke-Container (soll leer sein): ──"
  docker ps -a --filter "name=soc_postgres_apply_smoke" --format '{{.Names}} {{.Status}}' || true
}
trap cleanup EXIT

echo "── Isoliertes Postgres hochfahren (Port 5544) ──"
docker compose -p "$PROJECT" -f "$COMPOSE" up -d

echo "── Auf Postgres-Health warten ──"
for i in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' soc_postgres_apply_smoke 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || { echo "Postgres nicht healthy geworden"; exit 1; }
echo "Postgres healthy."

echo "── Apply-Smoke ausführen (echtes Postgres + echter Worker) ──"
cd "$ROOT/backend"
DB_ENABLED=true DB_HOST=localhost DB_PORT=5544 DB_NAME=soc_apply_smoke \
  DB_USER=soc_smoke DB_PASSWORD=smokepassword \
  node scripts/applyChannelSmoke.js
RESULT=$?

echo "── Smoke-Exitcode: $RESULT ──"
exit $RESULT
