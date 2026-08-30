# Wazuh → SOC Ticket Tool — Setup

## Topologie

```
Wazuh LXC (CT 103)  192.168.240.76
        │  POST /api/v1/integrations/wazuh/webhook (HMAC)
        ▼
SOC Backend LXC     192.168.240.72:3000
```

---

## 1. Webhook-Secret generieren und in Backend .env eintragen

Secret generieren (auf der Nexora-VM):
```bash
openssl rand -hex 32
```

In `deploy/.env.production` eintragen:
```
WEBHOOK_SECRET_WAZUH=<generiertes-secret>
```

Backend neu starten nach Änderung.

---

## 2. Script auf den Wazuh-LXC kopieren

Von der Windows-Entwicklungsmaschine (PowerShell):

```powershell
# SCP — SSH-Key muss auf dem Wazuh-LXC eingerichtet sein
# Alternativ: über Proxmox-Console copy/paste

scp integrations/wazuh/custom-soc-webhook root@192.168.240.76:/var/ossec/integrations/
```

Oder via Proxmox-Console (CT 103 → Console):

```bash
# Dateiinhalt direkt in der Console anlegen:
cat > /var/ossec/integrations/custom-soc-webhook << 'PYEOF'
# ... Script-Inhalt einfügen ...
PYEOF
```

Danach Rechte setzen:

```bash
chown root:wazuh /var/ossec/integrations/custom-soc-webhook
chmod 750 /var/ossec/integrations/custom-soc-webhook
```

---

## 3. Env-Variablen für das Script setzen

Wazuh 4.x führt Integrations-Scripts als `wazuh`-User aus, ohne Shell-Env.
Variablen über `/var/ossec/etc/local_internal_options.conf` ODER systemd-Override.

**Methode A — wazuh-manager systemd-Override (empfohlen):**

```bash
mkdir -p /etc/systemd/system/wazuh-manager.service.d/
cat > /etc/systemd/system/wazuh-manager.service.d/soc-webhook.conf << 'EOF'
[Service]
Environment="SOC_WEBHOOK_SECRET=<generiertes-secret>"
Environment="SOC_WEBHOOK_URL=http://192.168.240.72:3000/api/v1/integrations/wazuh/webhook"
EOF

systemctl daemon-reload
systemctl restart wazuh-manager
```

**Methode B — direkt im Script hardcoden (nur Dev/Lab):**

In `/var/ossec/integrations/custom-soc-webhook`, Zeile `secret = os.environ.get(...)` ersetzen durch:
```python
secret = "<generiertes-secret-hier-eintragen>"
```

---

## 4. ossec.conf anpassen

In `/var/ossec/etc/ossec.conf` innerhalb von `<ossec_config>` einfügen:

```xml
<integration>
  <name>custom-soc-webhook</name>
  <hook_url>http://192.168.240.72:3000/api/v1/integrations/wazuh/webhook</hook_url>
  <api_key>unused</api_key>
  <alert_format>json</alert_format>
  <level>5</level>
</integration>
```

Wazuh neu starten:

```bash
systemctl restart wazuh-manager
```

---

## 5. Smoke-Test

### A — Direkt vom Wazuh-LXC testen (curl, hex-Signatur)

```bash
# Wichtig: Signatur muss hex sein (nicht base64) — passt zu backend/src/integrations/hmac.js
BODY='{
  "timestamp":"2026-06-06T00:00:00Z",
  "rule":{"id":"999999","level":5,"description":"Manual Wazuh smoke test"},
  "agent":{"id":"000","name":"wazuh-smoke"},
  "manager":{"name":"wazuh"},
  "location":"manual-smoke",
  "full_log":"Manual signed Wazuh webhook smoke test"
}'
TS="$(date +%s)"
SIG="$(printf '%s.%s' "$TS" "$BODY" \
  | openssl dgst -sha256 -hmac "$SOC_WEBHOOK_SECRET" \
  | awk '{print $2}')"

curl -k -i -X POST https://192.168.240.75/api/v1/integrations/wazuh/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Timestamp: $TS" \
  -H "X-Webhook-Signature: sha256=$SIG" \
  -d "$BODY"

unset BODY TS SIG
# Erwartung: HTTP/1.1 202 Accepted  +  {"status":"accepted","eventId":"..."}
```

### B — Über das Python-Script testen

```bash
cat > /tmp/test-alert.json << 'EOF'
{
  "id": "1717243200.1",
  "rule": { "id": "5503", "level": 7, "description": "Test: Multiple authentication failures." },
  "agent": { "id": "000", "name": "wazuh-manager", "ip": "192.168.240.76" },
  "timestamp": "2024-06-01T12:00:00.000Z",
  "data": { "srcip": "10.0.0.5" }
}
EOF

SOC_WEBHOOK_SECRET="<secret>" \
SOC_WEBHOOK_URL="https://192.168.240.75/api/v1/integrations/wazuh/webhook" \
  /var/ossec/integrations/custom-soc-webhook /tmp/test-alert.json unused \
  "https://192.168.240.75/api/v1/integrations/wazuh/webhook"
# → kein Output = Erfolg. HTTP-Fehler werden auf stderr ausgegeben.
```

### B — Wazuh-Log prüfen

```bash
tail -f /var/ossec/logs/ossec.log | grep -i "soc\|integrat\|error"
```

### C — Backend-Log prüfen (auf SOC-LXC 192.168.240.72)

```bash
# Im Backend-Verzeichnis:
# Erfolg: {"action":"INTEGRATION_ACCEPTED",...,"source":"wazuh",...}
# Fehler:  {"code":"VALIDATION_ERROR",...}
```

---

## Level-Referenz (Wazuh → SOC Priority)

| Wazuh Level | Bedeutung | SOC Priority |
|---|---|---|
| 0–3 | Systemmeldungen | (gefiltert) |
| 4–7 | Fehlgeschlagene Logins, Policy | medium |
| 8–11 | Multiple Fehler, System-Eingriffe | high |
| 12–15 | Angriffe, Rootkit-Aktivität | critical |
