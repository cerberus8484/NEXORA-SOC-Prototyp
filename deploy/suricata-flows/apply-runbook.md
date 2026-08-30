# Step 6 — Apply-/Rollback-Runbook: `suricata-flows-*`

**Status: RUNBOOK (Review). NICHT angewandt.** Erst nach ausdrücklichem GO im Wartungsfenster
ausführen. Platzhalter (keine realen IPs/Hosts im Repo):

| Platzhalter | Bedeutung |
|---|---|
| `${WAZUH_INDEXER_HOST}` | OpenSearch/Wazuh-Indexer (Host:9200) |
| `<sensor-host>` | IDS-Sensor (LXC, wo `eve.json` + Filebeat laufen) |
| `${HONEYPOT_IP}` | Honeypot-IP (Phase-1-Asset) |
| `${FLOW_ASSET_IPS}` | Phase-2-Asset-Allowlist (gezielte Einzel-IPs/CIDR) |
| `${FLOW_INDEXER_PW}` | Passwort `filebeat-flows` — via `filebeat keystore`, NIE im File |
| `${INDEXER_ADMIN}` / `${INDEXER_ADMIN_PW}` | Admin-Creds nur für das Setup (nicht persistieren) |

Voraussetzung: Mirror + eth3 + Suricata-eth3 laufen (Step 2, bereits live), `eve.json` enthält
`in_iface=eth3`-Flows. Indexer-CA-Zertifikat verfügbar (read-only kopieren, kein Secret).

> Reihenfolge ist bindend: **Template → ISM → Rolle/User → Write-Index+Alias → Filebeat → Keystore → Start → Smoke**.
> Grund: ISM-`ism_template` hängt die Policy nur an Indizes, die **nach** Policy-Anlage entstehen;
> der Bootstrap-Write-Index muss also **nach** Template+Policy kommen.

---

## Apply

### 1) Index-Template
```sh
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  -X PUT "https://${WAZUH_INDEXER_HOST}:9200/_index_template/suricata-flows" \
  -H 'Content-Type: application/json' --data-binary @index-template.json
# erwartet: {"acknowledged":true}
```

### 2) ISM-Policy
```sh
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  -X PUT "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_ism/policies/suricata-flows-policy" \
  -H 'Content-Type: application/json' --data-binary @ism-policy.json
# erwartet: {"_id":"suricata-flows-policy", ...}
```

### 3) Rolle + User (Least-Privilege, write NUR auf `suricata-flows-*`)
```sh
# Rolle
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  -X PUT "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_security/api/roles/suricata-flows-writer" \
  -H 'Content-Type: application/json' -d '{
    "cluster_permissions": ["cluster_composite_ops"],
    "index_permissions": [{
      "index_patterns": ["suricata-flows-*"],
      "allowed_actions": ["create_index","write","index","indices:admin/mapping/put","indices:admin/aliases"]
    }]
  }'
# User + Rollenbindung
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  -X PUT "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_security/api/internalusers/filebeat-flows" \
  -H 'Content-Type: application/json' -d "{\"password\":\"${FLOW_INDEXER_PW}\",\"backend_roles\":[],\"opendistro_security_roles\":[\"suricata-flows-writer\"]}"
```

### 4) Initialer Write-Index + Rollover-Alias (Pflicht für ISM-Rollover)
```sh
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  -X PUT "https://${WAZUH_INDEXER_HOST}:9200/suricata-flows-000001" \
  -H 'Content-Type: application/json' -d '{"aliases":{"suricata-flows":{"is_write_index":true}}}'
# erbt Mappings via Template; ISM-Policy hängt sich über ism_template automatisch an.
# verify: Alias zeigt is_write_index=true
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  "https://${WAZUH_INDEXER_HOST}:9200/_alias/suricata-flows?pretty"
```

### 5) Filebeat auf dem Sensor installieren (`<sensor-host>`)
```sh
# Filebeat OSS 7.10.2 (Wazuh-Stack-Version). Service NICHT sofort enablen.
# Operative Config aus filebeat-suricata-flows.yml.example mit aufgelösten Platzhaltern
# nach /etc/nexora-suricata-flows/filebeat.yml (außerhalb Repo) ablegen.
# CA-Cert (read-only) nach /etc/filebeat/certs/indexer-ca.pem.
# Hinweis: läuft als root via systemd → KEINE seccomp/Pfad-Workarounds nötig
#          (die waren nur für den non-root-Trockentest auf dem Manager).
```

### 6) Keystore (Passwort nie im File)
```sh
filebeat keystore create
printf '%s' "${FLOW_INDEXER_PW}" | filebeat keystore add FLOW_INDEXER_PW --stdin --force
```

### 7) Validieren + Start
```sh
filebeat test config   -c /etc/nexora-suricata-flows/filebeat.yml
filebeat test output    -c /etc/nexora-suricata-flows/filebeat.yml   # TLS + Auth gegen Indexer
systemctl enable --now filebeat   # bzw. dedizierte Unit, falls Wazuh-Filebeat getrennt bleibt
```

### 8) Index-/Filter-Smoke
```sh
# a) Testverkehr zum Honeypot erzeugen (vom Sensor):
for p in 2222 22 23; do timeout 2 bash -c "echo > /dev/tcp/${HONEYPOT_IP}/$p" 2>/dev/null; done
sleep 20   # Flow-Emission (closed-tcp-Timeout)

# b) Landen gefilterte Flows im Index?
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  "https://${WAZUH_INDEXER_HOST}:9200/suricata-flows-*/_count?pretty"          # > 0

# c) Stichprobe: nur Asset-Flows, rohes Schema, keine Multicast-Doks
curl -sS --cacert indexer-ca.pem -u "${INDEXER_ADMIN}:${INDEXER_ADMIN_PW}" \
  "https://${WAZUH_INDEXER_HOST}:9200/suricata-flows-*/_search?pretty&size=3" \
  -H 'Content-Type: application/json' -d '{"query":{"term":{"event_type":"flow"}}}'
#   prüfen: src_ip/dest_ip/flow.* top-level, in_iface vorhanden, dest_port≠5353,
#           dest_ip nicht multicast (224./ff02:)

# d) Alert-Pfad unberührt? wazuh-alerts-* zählt weiter normal hoch, Wazuh-Filebeat active.
```

**Abnahme:** Index existiert · `_count > 0` · Doks tragen nur Asset-Flows (Honeypot/`${FLOW_ASSET_IPS}`) ·
keine Multicast/mDNS-Doks · rohes Schema top-level · `wazuh-alerts-*` unverändert.

---

## Rollback (vollständig reversibel, umgekehrte Reihenfolge)
```sh
# Sensor:
systemctl disable --now filebeat
# (Paket bei Bedarf entfernen; Config + Keystore + Cert löschen)

# Indexer:
curl ... -X DELETE "https://${WAZUH_INDEXER_HOST}:9200/suricata-flows-*"                       # Indizes
curl ... -X DELETE "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_ism/policies/suricata-flows-policy"
curl ... -X DELETE "https://${WAZUH_INDEXER_HOST}:9200/_index_template/suricata-flows"
curl ... -X DELETE "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_security/api/internalusers/filebeat-flows"
curl ... -X DELETE "https://${WAZUH_INDEXER_HOST}:9200/_plugins/_security/api/roles/suricata-flows-writer"
```
Mirror/eth3 haben ihr eigenes Rollback (Mirror-Runbook). Der Wazuh-Alert-Pfad wird hier nie angefasst.

---

## Caveats
- **Rollen-Permissions** ggf. an die OpenSearch-Version anpassen (Action-Namen). `filebeat test output`
  deckt Auth-/Mapping-Fehler vor dem Dauerbetrieb auf.
- **Zeitformat:** Suricata-`timestamp` gegen das `date`-Mapping verifizieren (Step-1-Caveat).
- **Reichweite:** erfasst nur interne Asset-Flows (CT-Honeypot). VPS-Live-Angreifer brauchen Flow-Export
  auf der VPS (eigener Track).
