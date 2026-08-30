# Suricata-Flow-Telemetrie → separater Index `suricata-flows-*`

**Status: REVIEW-ARTEFAKTE (Step 1). Nichts ist angewandt.** Kein Service, kein User,
kein Zertifikat kopiert, keine Indexer-Änderung, kein Mirror-Apply.

> **Repo-sicher per Platzhalter:** die Vorlagen enthalten **keine realen IPs**, nur
> `${HONEYPOT_IP}` · `${FLOW_ASSET_IPS}` (Phase-2-Allowlist) · `INDEXER_HOST` ·
> `${FLOW_INDEXER_PW}`. Die **echte operative Config liegt lokal außerhalb des Repos**
> (z.B. `/etc/nexora-suricata-flows/filebeat.yml`); im Repo bleibt nur diese dokumentierte Vorlage.

## Warum
Suricata schreibt bereits Flow-Records nach `eve.json` (16k+/Zeitraum), aber Wazuh
indexiert nur **regel-matchende Alerts** → die Flows landen nie in einem Index, den
Nexora liest. Wir wollen sie **nicht** als Alerts in `wazuh-alerts-*` pressen
(Index-Bloat, falsche Semantik). Stattdessen: ein **eigener, gefilterter Telemetrie-Index**.

## Architektur (getrennt vom Alert-Pfad)
```
Sensor <sensor-host>  /var/log/suricata/eve.json
  → eigener Filebeat  (Step1: nur event_type=flow → Step2: nur relevante → Step3: Noise raus)
  → Indexer https+TLS, User 'filebeat-flows' (write NUR suricata-flows-*)
  → suricata-flows-*  (eigenes Template + ISM-Rollover/Retention)
  → Nexora Suricata-Index-Adapter (Step 5, eigener Slice)

Wazuh-Agent → Manager → Filebeat → wazuh-alerts-*   ← UNVERÄNDERT (Tickets/Detection)
```

## Feste Entscheidungen
1. **Rohes Suricata-Schema** — Felder top-level (`src_ip`, `dest_ip`, `flow.*`, `event_type`),
   **nicht** unter `data.*` verschachteln. Nexora bekommt einen **separaten** Suricata-Reader
   (der bestehende `data.*`-Pfad im `flowNormalizer` gilt für den Wazuh-Indexer; dieser
   Index ist ein anderer Adapter).
2. **Retention konservativ:** Rollover **täglich ODER 5 GB**, **Retention 14 Tage**,
   **0 Replicas** (Lab), **Refresh 30s**.

## Recon-Fakten (read-only, 2026-06-24)
- Filebeat läuft nur auf dem **Wazuh-Manager** (mutual-TLS → wazuh-alerts/archives),
  **nicht** auf dem Sensor (dort nur `wazuh-agent`). `eve.json` liegt auf dem **Sensor**.
- Indexer (OpenSearch): nur Wazuh-eigene Templates, **keine ISM/ILM-Policies** → wir legen
  Template + ISM selbst an (sonst wächst der Index unbegrenzt).

## Dateien
| Datei | Zweck |
|---|---|
| `filebeat-suricata-flows.yml.example` | Sensor-Filebeat: Input `eve.json` + 3-Schritt-Filter + Output |
| `index-template.json` | OpenSearch-Index-Template (Mappings/Settings, Rollover-Alias) |
| `ism-policy.json` | ISM-Lifecycle: Rollover 1d/5gb, Delete 14d |

## Geplanter Apply (LATER, im Wartungsfenster, **erst nach GO** — hier nur dokumentiert)
> Reihenfolge gesamt: **(1) diese Artefakte reviewen → (2) Wartungsfenster: eth3 + tc-Mirror + Suricata-Restart → (3) Flow-Index aktivieren, dann Nexora-Adapter.**
> Step 2 (Sensor-Sicht auf <server-vlan>) MUSS vor sinnvollen Daten kommen — sonst nur Broadcast.

Apply-Skizze (Indexer-API + Sensor):
1. **Rolle/User** `filebeat-flows` am Indexer (write nur `suricata-flows-*`).
2. **Index-Template** PUT `_index_template/suricata-flows` ← `index-template.json`.
3. **ISM-Policy** PUT `_plugins/_ism/policies/suricata-flows-policy` ← `ism-policy.json`.
4. **Write-Index bootstrappen:** `PUT suricata-flows-000001` mit
   `{"aliases":{"suricata-flows":{"is_write_index":true}}}` (Rollover-Alias).
5. **CA-Cert** (read-only) nach `/etc/filebeat/certs/indexer-ca.pem` auf den Sensor.
6. **Filebeat** auf dem Sensor installieren, Config aus `.example` (Passwort via
   `filebeat keystore`), `filebeat test config && filebeat test output`, dann starten.

## Rollback
- Sensor: Filebeat stoppen/deinstallieren.
- Indexer: ISM-Policy + Template + User löschen; `suricata-flows-*` schließen/löschen.
- (Mirror/eth3 haben ein eigenes Rollback im Mirror-Runbook.)

## Filter-Logik (testbar, in klar getrennten Schritten)
1. **nur `event_type == "flow"`** (sonst drop).
2. **ASSET-SCOPE (Entscheidung B), behalten NUR wenn Source ODER Destination ein Asset ist:**
   Phase 1 = Honeypot `${HONEYPOT_IP}`. Phase 2 = bewusst gewählte Server-Assets
   (`${FLOW_ASSET_IPS}`: DC01/WEC01/Nexora/... als Einzel-IPs oder CIDR-Allowlist) — **NIE**
   das ganze Server-VLAN. **Folge:** externe Gegenstellen + kritische Ports zählen NUR im
   Asset-Kontext (die andere Seite ist ein Asset); **keine** generische `public`-Regel,
   **kein** beliebiger Heimnetz↔Internet-Traffic. Der Index bleibt SOC-Telemetrie, kein
   allgemeines Heimnetz-Flow-Archiv.
3. **explizit raus:** Multicast (IPv4 `224.0.0.0/4` + IPv6 `ff00::/8`), `255.255.255.255`,
   mDNS (`:5353`), SSDP (`:1900`). **Nötig trotz Asset-Scope:** ein Asset, das selbst mDNS/
   Multicast sendet, würde sonst über die Asset-Regel (Schritt 2) wieder hereinrutschen.

**Trockentest (2026-06-24, Entscheidung B verifiziert):** 5000-Zeilen-Sample echter eve.json
durch Filebeat 7.10.2 (Console-Output, kein Indexer): **16/16 Honeypot-Flows behalten**,
**0 Multicast/mDNS-Leaks** (von 1583+2296), **alle externen Heimnetz↔Internet-Flows verworfen**
(vorher unter `public` behalten), Felder top-level (kein `data.*`). Re-Test-Befehl auf dem
Manager als non-root: `filebeat -E seccomp.enabled=false --path.* /tmp/fbtest -c <cfg> -e --once`.

## Offen / Folge-Slices
- **Nexora-Suricata-Index-Adapter (Step 5):** liest `suricata-flows-*` mit **rohem** Schema
  (`src_ip`/`flow.bytes_toserver` ohne `data.`-Präfix) — getrennter Reader neben dem Wazuh-Indexer-Pfad.
- **VPS-Honeypot:** dieser Pfad erfasst nur **interne** (CT-179-)Flows. Live-Angreifer-Flows
  der VPS brauchen Flow-Export **auf der VPS** (eigener Track).
- **Zeitformat:** Suricata-`timestamp` (z. B. `…+0200`, µs) gegen das Date-Mapping verifizieren.
