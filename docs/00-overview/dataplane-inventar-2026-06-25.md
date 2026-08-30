# Data-Plane — Daten- & Artefakt-Inventar (Stand 2026-06-25, nach Pull-Migration)

Bestandsaufnahme nach der Umstellung auf den **internen Pull-Collector-Hub** (ADR-036): was brauchen
wir noch, was ist überflüssig geworden. **Keine Löschung ohne Freigabe** — dies ist die Entscheidungsgrundlage.

---

## 1. Telemetrie-Quellen (Daten) — brauchen wir / nicht

| Quelle | Domäne | Status | Begründung |
|---|---|---|---|
| **Cowrie** (`cowrie.json`) | siem | ✅ **gebraucht** | Honeypot-Login/Command, vom Hub gepullt (`hp-cowrie`) |
| **Suricata** (`eve.json`: `alert`+`flow`) | ids | ✅ **gebraucht** | IDS-Alerts **und** Flow (5-Tuple/Bytes), vom Hub gepullt (`hp-suricata`) |
| **conntrack** (kernel) | — | ❌ **nicht mehr** | host-lokal, nicht pull-bar → **abgelöst durch Suricata-`flow`** (ADR-036). conntrack-Push-Dienst abgebaut |
| OPNsense-Firewall, Wazuh | firewall/siem | ⏸ optional/künftig | Kollektoren existieren, noch nicht als Pull-Quelle konfiguriert (= ein Config-Eintrag im Hub) |

---

## 2. Deploy-Artefakte (`deploy/`)

### ✅ Aktiv / gebraucht (Pull-Architektur)
- `deploy/collector-hub/` — der neue interne Hub (Entrypoint-Doku + Beispiel-Config). **Kern.**
- `deploy/nexora-intake/docker-compose.yml` — Live-Stack (intake + intake-pg + outbox-worker + **collector-hub**).
- `deploy/lab/` — Lab-Compose + Sample-Logs (Dev/Test).
- `deploy/suricata-flows/` — separater OpenSearch-Flow-Index (eigenes Thema, „lokal/nicht aktiv") — **nicht** Teil der Collector-Migration, bleibt.

### ✅ Sensor-Teil — bleibt (läuft weiter auf dem Honeypot)
- `deploy/vps-suricata/nexora.rules` + `deploy/vps-suricata/suricata-nexora.service` — **Suricata-Sensor** (erzeugt `eve.json`, das der Hub pullt). **Behalten.**

### ⚠️ Überflüssig / abgelöst (Push-Kollektoren → durch Pull-Hub ersetzt)
> Diese beschreiben die **alte** „Collector läuft auf dem Quell-Host"-Variante. Die zugehörigen Dienste sind auf dem Honeypot bereits **disabled**. Empfehlung: entfernen **oder** als „deprecated/historisch" kennzeichnen.

- `deploy/vps-conntrack/` (komplett) — conntrack-Push; conntrack ist abgelöst.
- `deploy/vps-cowrie/` (komplett) — Cowrie-Push; ersetzt durch `collector-hub` (`hp-cowrie`).
- `deploy/vps-suricata/suricata-collector.service` + `deploy/vps-suricata/seed-vps-suricata-collector.sql` — Suricata-**Push-Collector**; ersetzt durch `hp-suricata`. (Der **Sensor** im selben Ordner bleibt — s.o.)

---

## 3. Code (`dataplane/src/collector/`)

| Datei(en) | Status |
|---|---|
| `cowrieCollector.js`, `suricataCollector.js` | ✅ aktiv (Hub-Quellen) |
| `pullSource.js`, `remoteTailSource.js`, `sshTail.js`, `collectorHub.js`, `collectorHubMain.js` | ✅ aktiv (Pull-Hub) |
| `buildEnvelope.js`, `runCollectorPipeline.js`, `collectorRegistry.js`, `collectorRuntime.js`, `collectorMain.js`, `intakeClient.js`, `replaySource.js` | ✅ aktiv (geteilte Bausteine) |
| `opnsenseCollector.js`, `wazuhCollector.js` | ⏸ gebaut, ungenutzt (künftige Pull-Quellen) — **behalten** (Erweiterbarkeit, ADR) |
| `conntrackCollector.js` | ⏸ ungenutzt (conntrack abgelöst) — behalten als Fallback (falls je Host-Shipper) |
| `conntrackMain.js` | ⚠️ **veraltet** — Standalone-Push-Entrypoint, durch `collectorHubMain` ersetzt. Kandidat zum Entfernen |

---

## 4. Untracked Dateien im Repo-Root (Triage)

| Pfad | Was | Empfehlung |
|---|---|---|
| `AGENTS.md` | Codex-Pendant zu CLAUDE.md (Projekt-Guidance) | **committen** (Projekt-Doku) |
| `docs/00-overview/produkt-erklaerung.{md,html}` | Produkterklärung | **committen** (vorher IP-frei prüfen) |
| `tools/ops/smoke-honeypot-timeline.sh` | Dev-Stack-Smoke (read-only) | **committen** (vorher auf reale IPs prüfen) |
| `analyseSeite Design/` (PNGs) | Design-Mockups (Analysis-Tabs) | committen unter `docs/` **oder** ignorieren (Größe?) — Entscheidung |
| `.codex/` (hooks) | Codex-Tooling-Config | **.gitignore** (Tool-lokal, wie `.claude`) |

---

## Aktionen — ERLEDIGT (2026-06-25)
1. ✅ **Entfernt:** `deploy/vps-conntrack/`, `deploy/vps-cowrie/`, `deploy/vps-suricata/{suricata-collector.service, seed-vps-suricata-collector.sql}`, `dataplane/src/collector/conntrackMain.js`. Sensor-Dateien (`nexora.rules`, `suricata-nexora.service`) bleiben.
2. ✅ **Untracked triagiert:** `AGENTS.md` + `produkt-erklaerung.{md,html}` + `smoke-honeypot-timeline.sh` IP-gescrubbt + committet; `.codex/` + `analyseSeite Design/` in `.gitignore`.
3. ✅ **IP-Leak gefixt:** in dieser Session versehentlich eingeschleppte reale Infra-IPs (Compose-Header-Kommentar + eigene Test-Fixtures) auf Repo-Konvention gescrubbt (`10.99.x` / `nexora.example`).

### ✅ ERLEDIGT — vor-bestehende reale IPs in Test-Fixtures gescrubbt
Die Infra-IPs in getrackten **Test-Fixtures + Lab-Samples** wurden auf TEST-NET/Konvention umgestellt
(Honeypot-public → `203.0.113.246`, Lab-Intern `10.0.10.x` → `10.99.99.x`), Daten **und** Assertions
konsistent. Betroffen: `dataplane/tests/{conntrackCollector,postgresIntakeRepo,wazuhCollector}.test.js`,
`backend/tests/correlation/ticketThreatIntel.test.js`, `deploy/lab/wazuh-alerts.sample.log`. Tests grün
(dataplane-Suite 0 fail, ticketThreatIntel 8/8). Attacker-Beispiel-IPs (extern, illustrativ) bleiben.
Damit sind in getrackten, nicht-`docs/_private/`-Dateien **keine realen Infra-IPs** mehr.

### Optional
- `deploy/vps-suricata/` → `deploy/honeypot-sensors/` umbenennen (es sind Sensoren, keine Kollektoren).
