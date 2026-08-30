#!/usr/bin/env bash
# ── Ollama-Anbindung prüfen (externe LXC) ────────────────────────────
# Ollama läuft als eigene LXC: 192.168.240.78:11434 (OLLAMA_HOST=0.0.0.0 bzw.
# gebunden an .78). Modell wird DORT geladen, nicht hier:
#   ssh root@192.168.240.78 'ollama pull llama3.2:3b'
#
# Dieses Script verifiziert nur, dass der SOC-Server Ollama erreicht und
# das gewünschte Modell vorhanden ist. Danach in deploy/.env.production:
#   AGENT_LLM_PROVIDER=ollama
#   OLLAMA_BASE_URL=http://192.168.240.78:11434
#   OLLAMA_MODEL=llama3.2:3b
# und die API neu starten.
set -euo pipefail

# Werte aus deploy/.env.production übernehmen (falls vorhanden), sonst Defaults.
ENV_FILE="$(dirname "$0")/.env.production"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

OLLAMA_URL="${OLLAMA_BASE_URL:-http://192.168.240.78:11434}"
MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

echo "→ Erreichbarkeit: $OLLAMA_URL"
curl -fsS "$OLLAMA_URL/api/tags" >/tmp/ollama_tags.json \
  || { echo "✗ Ollama nicht erreichbar ($OLLAMA_URL). Firewall/OLLAMA_HOST prüfen."; exit 1; }
echo "✓ erreichbar"

echo "→ Geladene Modelle:"
grep -o '"name":"[^"]*"' /tmp/ollama_tags.json | sed 's/"name":"/  - /; s/"$//' || true

if grep -q "\"name\":\"${MODEL}\"" /tmp/ollama_tags.json; then
  echo "✓ Modell '$MODEL' vorhanden."
else
  echo "⚠ Modell '$MODEL' NICHT gefunden. Auf der Ollama-LXC laden:"
  echo "    ssh root@192.168.240.78 'ollama pull $MODEL'"
fi

echo
echo "→ Smoke-Test (/api/generate) ..."
curl -fsS "$OLLAMA_URL/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"ping\",\"stream\":false}" >/dev/null \
  && echo "✓ Ollama OK — Modell $MODEL antwortet." \
  || echo "⚠ Smoke-Test fehlgeschlagen (Modell evtl. noch nicht geladen)."
