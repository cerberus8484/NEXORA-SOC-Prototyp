<div align="center">

# Nexora SOC

**Self-hosted SOC orchestration for security teams**<br>
**Self-hosted SOC-Orchestrierung für Security-Teams**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

[Deutsch](#deutsch) · [English](#english) · [Installation](INSTALL.md) · [Security](SECURITY.md)

</div>

---

## Deutsch

### Überblick

Nexora SOC ist ein self-hosted Prototyp für Security Operations Center der Stufen Tier 1 bis
Tier 3. Die Plattform verbindet Incident-Tickets, Evidence, Threat Hunting,
Threat-Intelligence-Anreicherung und Telemetrie aus angebundenen Sicherheitsquellen zu einem
nachvollziehbaren Analysten-Workflow.

Nexora ergänzt Systeme wie Wazuh, QRadar und Splunk. Es ist **kein SIEM-, EDR- oder
Antivirus-Ersatz** und führt keine automatische Bedrohungsbeseitigung durch. Kritische Aktionen
bleiben rollenbasiert, freigabepflichtig und auditierbar.

### Enthaltene Funktionen

| Bereich | Beschreibung |
| --- | --- |
| Incident Management | Tickets, Statusmodell, Suche und Audit-Historie |
| Analysis Deck | Queue, Timeline, Evidence und Threat-Intel-Kontext |
| Threat Hunting | MITRE ATT&CK-zugeordnete Hunts und kontrollierte Befehle |
| Analysten-Triage | Unterstützte Bewertung mit Human Approval |
| Integrationen | Adapter für Wazuh, QRadar, Splunk, E-Mail und weitere Dienste |
| Betrieb | Docker Compose, PostgreSQL, Health Checks und RBAC |

### Schnellstart (Entwicklung)

Voraussetzungen: Docker Desktop bzw. Docker Engine mit Compose v2.

```bash
docker compose -f docker-compose.dev.yml up --build
```

Danach ist die Entwicklungsoberfläche unter `http://localhost:5173` erreichbar.

Für die native Entwicklung wird Node.js 20 oder neuer benötigt:

```bash
cd backend && npm ci && npm test
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm test
```

### Produktionsinstallation

Der Installer erzeugt eine lokale, nicht versionierte Produktionskonfiguration, generiert
Secrets und hält risikoreiche Schreib-, Autonomie- und Neustart-Funktionen standardmäßig aus.

```bash
# Ablauf ohne Änderungen prüfen
./deploy/install.sh --profile all-in-one --dry-run

# Nexora Core installieren
sudo ./deploy/install.sh \
  --profile core \
  --domain soc.example.org \
  --admin-email admin@example.org

# Core plus lokale Wazuh-Einzelknoten-Integration installieren
sudo ./deploy/install.sh --profile all-in-one --with-wazuh
```

Der Installer gibt Zugangsdaten und Verbindungsinformationen bei der Ersteinrichtung aus.
Details zu Voraussetzungen, Betrieb und Sicherheit stehen in [INSTALL.md](INSTALL.md).

### Sicherheit

- Serverseitig durchgesetztes RBAC und Audit-Log
- Validierte Eingaben und Adapter-Schicht für externe Systeme
- Secrets, private Schlüssel und Produktionskonfigurationen bleiben lokal und sind ignoriert
- Sicherheitskritische Funktionen sind standardmäßig deaktiviert

Bitte Sicherheitslücken nicht über öffentliche Issues melden. Der verantwortungsvolle
Meldeweg steht in [SECURITY.md](SECURITY.md).

---

## English

### Overview

Nexora SOC is a self-hosted prototype for Tier 1 to Tier 3 security operations teams. It
combines incident tickets, evidence, threat hunting, threat-intelligence enrichment, and
telemetry from connected security sources into a traceable analyst workflow.

Nexora complements platforms such as Wazuh, QRadar, and Splunk. It is **not a SIEM, EDR, or
antivirus replacement** and does not perform automated threat remediation. Critical actions
remain role-based, approval-gated, and auditable.

### Included capabilities

| Area | Description |
| --- | --- |
| Incident management | Tickets, lifecycle, search, and audit history |
| Analysis Deck | Queue, timeline, evidence, and threat-intelligence context |
| Threat hunting | MITRE ATT&CK-mapped hunts and controlled commands |
| Analyst triage | Assisted assessment with human approval |
| Integrations | Adapter-based support for Wazuh, QRadar, Splunk, email, and other services |
| Operations | Docker Compose, PostgreSQL, health checks, and RBAC |

### Development quick start

Requirements: Docker Desktop or Docker Engine with Compose v2.

```bash
docker compose -f docker-compose.dev.yml up --build
```

The development UI is then available at `http://localhost:5173`.

For native development, Node.js 20 or later is required:

```bash
cd backend && npm ci && npm test
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm test
```

### Production installation

The installer creates a local, untracked production configuration, generates secrets, and
keeps high-risk write, autonomy, and restart capabilities disabled by default.

```bash
# Review the plan without modifying the host
./deploy/install.sh --profile all-in-one --dry-run

# Install Nexora Core
sudo ./deploy/install.sh \
  --profile core \
  --domain soc.example.org \
  --admin-email admin@example.org

# Install Core plus the local single-node Wazuh integration
sudo ./deploy/install.sh --profile all-in-one --with-wazuh
```

The installer displays connection details and first-login credentials during setup. See
[INSTALL.md](INSTALL.md) for requirements, operations, and security details.

### Security

- Server-enforced RBAC and audit logging
- Validated input and an adapter layer for external systems
- Secrets, private keys, and production configuration stay local and are ignored
- Security-critical capabilities are disabled by default

Please do not report vulnerabilities through public issues. Follow the responsible disclosure
process in [SECURITY.md](SECURITY.md).

### License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
