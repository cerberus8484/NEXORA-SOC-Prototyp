# Deployment Center — Konzept & Fresh-Install-Referenz

> Stand: 2026-06-30. Quelle: zwei read-only Audit-Agents (Fresh-Install-Inventar + Provisioning/Connector-Infrastruktur).
> Status: **Konzept/Plan** — noch nicht implementiert. Dient als Entscheidungsgrundlage für den Scope.

---

## Teil 1 — Was eine Neuinstallation liefert

### 1.1 Container-Stack (was wird installiert)

| Stack | Datei | Services | Hinweis |
|---|---|---|---|
| **Dev** | `docker-compose.dev.yml` | postgres, api (nodemon), web (Vite), postgres_test | `DB_ENABLED=true` fest |
| **Prod** | `deploy/docker-compose.prod.yml` | postgres, api, web (nginx+SPA, :80/:443) | Start via `deploy/soc.sh` (braucht `.env.production`) |
| **Data-Plane** (separat) | `deploy/nexora-intake/docker-compose.yml` | intake, intake_pg, outbox-worker, collector-hub | **eigenes Deploy** — nur wenn Cross-Domain-Pipeline gewünscht; eigene Credentials/SSH-Keys |

Ollama (LLM) ist **kein** Compose-Service → eigene LXC. Kein automatischer „fresh-install"-Bootstrap; Operator befüllt `.env.production` aus `.env.production.example`.

### 1.2 Boot-Sequenz (automatisch beim ersten Start)
`backend/src/server.js`: `validateEnv()` (Prod-Fail-fast) → `migrate()` (45 SQL-Migrationen, idempotent) → DB-Ping → `ensureAdminFromEnv()` (Admin-Seed, wenn ENV gesetzt) → Security-Settings laden → Integration-Worker (Wazuh **immer**, Rest ENV-gated) → Korrelations-Runtime (pg-boss) → IMAP/CrowdSec-Poller (nur bei ENV).

### 1.3 Mitinstalliert (Schema + statische Daten)
- **45 Migrationen → ~40 Tabellen**: tickets, users, audit_log, jwt_blocklist, hunt_*, evidence, yara_rules, agent_suggestions, analysis_templates, use_cases(+drafts), qradar_offense_notes, published_detections, autonomy_policies, notifications, api_tokens, provisioning_* (8 Tabellen), nis2_*, mfa/oidc/webauthn, correlation_* , config_drafts/apply_* , worker_status.
- **Kein SQL-Seed-Dump.** Statt dessen statische Kataloge im Code (immer verfügbar): **17 Hunt-Typen** (`HuntType.js`), **10 NIS2-Controls** (`nis2ControlCatalog.js`), MITRE-Matrix-Subset (Frontend). Analyse-Vorlagen/Use-Cases/Detections = leer, vom Nutzer angelegt.

### 1.4 Sofort aktiv (ohne ENV) — „out of the box"
Ticket-CRUD (DB), Auth/JWT/RBAC + httpOnly-Cookie + CSRF, Threat-Hunting (17 Mock-Hunts), KI-Triage im **Stub-Modus**, YARA CRUD+Scan, NIS2-Readiness, Ticket-PDF-Export, Audit-Log + CSV-Export, Health + Prometheus, Rate-Limiting, Helmet/CORS, **Wazuh-Webhook-Intake** (HMAC, immer bereit), Korrelations-Engine (pg-boss), Provisioning-UI (admin), In-App-Notifications, Config-Registry + Apply-Schema (inert).

### 1.5 ENV-gated (default inert — Code da, wartet auf Config)
MFA, PAT, OIDC/SSO, WebAuthn, Outbound-Notifications, IMAP-Phishing, QRadar/Splunk/CrowdSec, Wazuh-API-Enrichment + Indexer-Dashboard, Wazuh-FP-Apply, TI (VT/AbuseIPDB), KI-Provider Ollama/Cloud, RAG, FQDN-Resolver, **AUTONOMY_ENABLED**, **CONFIG_APPLY_ENABLED**, ML-Routing-Advisory, TLS-Enforce/IP-Allowlist, Outbound-Ticket-Export (ServiceNow/OTRS).
**Pflicht-Secrets in Prod (Fail-fast):** JWT_SECRET, DB_*, AUDIT_IP_SALT, CORS_ORIGINS, WEBHOOK_SECRET_GENERIC.

### 1.6 Braucht externe Systeme
Wazuh-Manager (Alerts→Tickets; ohne ihn bleibt die Queue leer), Wazuh-API/Indexer (Hosts/Dashboard), QRadar/Splunk/CrowdSec (SIEM-Quellen), Ollama/Cloud (echte KI statt Stub), Qdrant+Ollama (RAG), Mailserver (IMAP/SMTP), Data-Plane-VPS-Sensoren (Cowrie/Suricata/conntrack).

### 1.7 Ehrlichkeits-Hinweise (wichtig fürs Erwartungsmanagement)
- **Hunts laufen als deterministische Mocks** — kein Hunt führt echte Befehle auf Endpoints aus (bewusst, SOC-sicher).
- **KI-Triage ohne LLM-Provider = Stub** (deterministisch).
- **RAG-Collections** (MITRE/Hunts/Incidents) müssen nach Deploy **manuell befüllt** werden.
- **Data-Plane** ist ein **separater** Compose-Stack, nicht Teil des Basis-Installs.

**Fresh-Install-Fazit:** Strukturell vollständige Plattform sofort (Schema, UI, Core-Workflows, Stub-KI). Nach ENV-Flags schalten die fertig implementierten Features frei. Mit externen Systemen entfaltet sich der volle Betrieb; ohne sie ist alles da, aber Alert-Queues leer + KI nur Stub.

---

## Teil 2 — Deployment Center: Architektur-Konzept

### 2.1 Vorhandene Fundamente (worauf man aufbaut)
| Baustein | Kann heute | UI? |
|---|---|---|
| **Provisioning** (`provisioning.js`, `provisioningDomain.js`) | Node-Lifecycle (pending→enrolled→active→retired), Enrollment-Profile, Token-Mint (einmalig), Credentials (SHA-256), Heartbeat, Rollen (control_plane/agent/integration_connector/network_sensor/gateway_sensor) + Capabilities, Rate-Limiting | ✅ `/provisioning` (admin) |
| **Collector-Hub** (`dataplane/src/collector/`) | 5 Collector-Typen: cowrie, suricata, **opnsense**, wazuh, conntrack; Plugin-Contract (`collectorRegistry`), nebenläufige Orchestrierung, `hub.config.json`-Schema, SSH-tail/pull/replay-Transporte | ⚠ `/collectors` read-only |
| **Integrations-Adapter** (`integrations/adapters/`) | 8 Adapter (validate→normalize→toTicketDraft): Wazuh, QRadar, Splunk, CrowdSec, Email, Dataplane, ServiceNow, OTRS | über Tickets/Dashboards |
| **Config-Registry + Apply-Kanal** (`configRegistry/`, `applyChannel/`) | Capability-Allowlist, Draft→4-Augen→Approve→Plan→Apply (gated `CONFIG_APPLY_ENABLED`), Audit | ❌ keine eigene UI |
| **Correlator-Registry** (`correlatorRegistryCatalog.js`) | genau 1 Eintrag (`correlation-worker`); 2. = neuer Katalog-Eintrag + gebundene Capabilities (fail-fast) | ❌ Backend-Route da, keine UI |

### 2.2 Adapter-Abdeckung (deine Quellen-Liste)
| Quelle | Backend-Adapter | Dataplane-Collector | Aufwand für Anbindung |
|---|---|---|---|
| Wazuh (SIEM) | ✅ produktiv | ✅ | — (da) |
| QRadar (SIEM) | ✅ (ENV) | — | — (da, mapping gefixt) |
| Splunk (SIEM) | ✅ | — | gering |
| **OPNsense** (FW) | via Dataplane | ✅ `opnsenseCollector` | gering (Collector da) |
| **pfSense** (FW) | ❌ | ❌ | **mittel** (filterlog-Dialekt ähnlich OPNsense → Collector-Variante) |
| **Sophos** (FW) | ❌ | ❌ | **mittel-hoch** (eigener Syslog/API-Parser) |
| **Fortinet** (FW) | ❌ | ❌ | **mittel-hoch** (FortiGate-Syslog/API-Parser) |
| CrowdSec | ✅ Slice 1 | — | gering |
| Email/IMAP | ✅ live | — | — |

→ Von deiner Firewall-Liste ist **OPNsense schon abgedeckt**, **pfSense/Sophos/Fortinet fehlen** (je ein neuer Collector/Adapter).

### 2.3 Ausbaustufen (zur Scope-Entscheidung)

**Stufe A — Quellen anbinden (Connector-Deployment).** *Realistisch, baut auf Vorhandenem.*
Eine Deployment-Seite, die bestehende Firewalls/SIEMs als Datenquelle onboardet:
1. Quelle wählen (Wazuh/QRadar/Splunk/OPNsense/pfSense/…) → Wizard.
2. Verbindungsdaten als **Quellen-Instanz-Registry** (neu — statt nur ENV): Host, Port, Credential-Ref, Adapter-Typ. Pro Instanz ein Eintrag, Secrets gehasht/verschlüsselt.
3. Collector-Variante: für tail-basierte Quellen einen `hub.config.json`-Eintrag generieren (neue **Collector-Config-UI**) + Provisioning-Token minten + Agent/Collector ausrollen.
4. Heartbeat/Status verifizieren → Quelle „aktiv" (braucht **Hub-Prozess-Status-Brücke** — heute fehlt sie, `liveProcessStatus.available:false`).
**Neu zu bauen:** Quellen-Instanz-Registry (Backend + Migration), Collector-Config-UI + -Validierung, Hub↔Backend-Status-Brücke, der Wizard. **Wiederverwendbar:** Provisioning komplett, Adapter-Bibliothek, Collector-Contract.

**Stufe B — Appliances bereitstellen (Infra-Deployment).** *Große neue Schicht.*
Tatsächlich neue Appliances hochziehen (OPNsense-VM auf Proxmox, SIEM installieren). Erfordert eine **Infra-Orchestrierungs-Schicht**, die es heute NICHT gibt: Proxmox-API/Terraform/Ansible-Anbindung, Template-/Image-Verwaltung, Secrets-Handling, langer Provisioning-Lifecycle, Rollback. Hohes Risiko (schreibt aktiv Infrastruktur). Empfehlung: **nur nach Stufe A**, und strikt hinter dem bestehenden Apply-Kanal-Muster (Draft→4-Augen→Plan→Apply, gated) — kein direktes „Exec".

**Korrelatoren (2. Engine/Correlator).** Heute: 1 Katalog-Eintrag. Ein zweiter:
1. Eintrag in `correlatorRegistryCatalog.js` (Name, Ziel, gebundene `configCapabilityIds`).
2. Passende Capabilities im `configCapabilityCatalog.js` (z.B. `correlator.worker2.maxChildren`).
3. Worker-Deployment (zweiter Container/Worker-ID) + Config über den Apply-Kanal.
4. **Correlator-Admin-UI** (neu — Backend-Route `/correlators` ist komplett, Frontend fehlt).

### 2.4 Lücken-Übersicht (was neu gebaut werden müsste)
1. Quellen-**Instanz-Registry** (Host/Port/Credential pro Quelle, statt ENV-only) — Backend + Migration + UI.
2. **Collector-Hub-Config-UI** (Formular für `hub.config.json`-Einträge + Validierung).
3. **Hub↔Backend-Status-Brücke** (Live running/failed/throughput statt `available:false`).
4. **Neue Firewall-Adapter/Collector:** pfSense, Sophos, Fortinet.
5. **Correlator-Admin-UI** (auf bestehende `/correlators`-Route).
6. **Deploy-Wizard** (Provisioning + Collector-Config + Heartbeat-Verifikation in einem Ablauf).
7. (Stufe B) **Infra-Orchestrierung** (Proxmox/Terraform/Ansible) — eigenes großes Paket.

### 2.5 Empfohlene Reihenfolge (gestuft, risikoarm zuerst)
1. **Quellen-Instanz-Registry + Collector-Config-UI** (Stufe A Kern) — größter Nutzen, baut auf Provisioning.
2. **Hub-Status-Brücke** (macht `/collectors` live).
3. **pfSense-Collector** (nah an OPNsense), dann **Fortinet/Sophos**.
4. **Correlator-Admin-UI** + 2. Correlator über Apply-Kanal.
5. **Deploy-Wizard** als verbindende UX-Schicht.
6. (Optional, später) **Stufe B** Infra-Deployment — eigene Architektur-Entscheidung (ADR), hohes Risiko.

---

## Offene Scope-Frage (für dich)
- **Stufe A oder A+B?** A = Quellen anbinden (realistisch, mittlerer Aufwand). B = Appliances provisionieren (große neue Infra-Schicht).
- **Welche Firewalls zuerst** (pfSense ist am günstigsten, Fortinet/Sophos teurer)?
- **2. Correlator** jetzt mitdenken oder später?
