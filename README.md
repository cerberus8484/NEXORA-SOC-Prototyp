<div align="center">

# Nexora SOC

**Self-hosted SOC orchestration for security teams**<br>
**Self-hosted SOC-Orchestrierung für Security-Teams**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

[Deutsch](#deutsch) · [English](#english) · [Installation guide](docs/03-admin-guide/README.md) · [Security](SECURITY.md)

</div>

---

## Deutsch

### Was ist Nexora SOC?

Nexora SOC ist eine selbst betreibbare Plattform für SOC-Teams der Stufen Tier 1 bis Tier 3.
Sie verbindet Incident-Tickets, Evidenz, Threat Hunting, Threat-Intelligence-Anreicherung
und Telemetrie aus angebundenen Sicherheitsquellen zu einem nachvollziehbaren Workflow.

Nexora ergänzt bestehende SIEM-, EDR- und Log-Management-Systeme wie Wazuh, QRadar oder
Splunk. Es ist **kein Ersatz** für diese Systeme und führt keine automatische
Bedrohungsbeseitigung durch. Kritische Aktionen bleiben an Rollen, Freigaben und Auditierung
gebunden.

### Funktionen

| Bereich | Beschreibung |
| --- | --- |
| Incident Management | Tickets mit Statusmodell, Suche, Verknüpfungen und nachvollziehbarer Historie |
| Analysis Deck | Arbeitsbereich für Queue, Timeline, Evidence und Threat-Intel-Kontext |
| Threat Hunting | MITRE-ATT&CK-zugeordnete Hunts sowie eine kontrollierte Command Console |
| KI-gestützte Triage | Lokale Modelle über Ollama oder bewusst konfigurierte Provider; Empfehlungen bleiben prüfbar |
| Evidence & Audit | Chain of Custody, Hashes und append-only Audit-Log für relevante Änderungen |
| Integrationen | Adapter für Wazuh, QRadar, Splunk, ServiceNow, OTRS, E-Mail und Threat-Intel-Dienste |
| Betrieb | Docker-Deployment, PostgreSQL-Persistenz, Health Checks und rollenbasierte Administration |

### Architektur

```text
Security sources / SIEMs
          │  validated adapters
          ▼
┌─────────────────────────────────────────────────────────┐
│ Nexora SOC                                               │
│ React + TypeScript ─ nginx ─ Express API ─ PostgreSQL    │
│                         │                                │
│            tickets · evidence · hunts · audit · RBAC     │
└─────────────────────────────────────────────────────────┘
```

- **Frontend:** React 18, TypeScript und Vite
- **Backend:** Node.js, Express und PostgreSQL
- **Architekturprinzip:** Repository Pattern; In-Memory-Repositories für Tests/Entwicklung,
  PostgreSQL für persistente Installationen
- **Integrationen:** Jede externe Quelle wird über einen Adapter validiert und normalisiert

### Schnellstart für die Entwicklung

Voraussetzungen: Node.js 20 oder neuer und npm.

```bash
# Terminal 1: API (ohne DB standardmäßig In-Memory)
cd backend
npm ci
npm run dev

# Terminal 2: Web-Oberfläche
cd frontend
npm ci
npm run dev
```

Danach ist die Oberfläche unter `http://localhost:5173` erreichbar; die Vite-Entwicklung
leitet API-Anfragen an `http://localhost:3000` weiter.

Alternativ startet Docker Compose einen lokalen Entwicklungsstack mit PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f api web
```

Weitere Details einschließlich Datenbank- und Umgebungsvariablen stehen in der
[Installationsanleitung](docs/03-admin-guide/installation.md).

### Produktionsinstallation

Für einen frischen Linux-Host stehen ein Preflight und ein einheitlicher Installer bereit.
Er erstellt eine lokale, nicht versionierte Produktionskonfiguration, generiert benötigte
Secrets und erzwingt sicherheitsrelevante Schreib- und Autonomie-Funktionen zunächst als
deaktiviert.

```bash
# Ablauf prüfen, ohne Änderungen vorzunehmen
./deploy/install.sh --profile all-in-one --dry-run

# Schlanker Produktionsstack mit eigener Domain
sudo ./deploy/install.sh \
  --profile core \
  --domain soc.example.org \
  --admin-email admin@example.org
```

Benötigt werden ein aktuelles Linux-System, `git`, Docker Engine, Docker Compose v2, `curl`,
`openssl`, freie Ports 80/443 und mindestens 10 GB freier Speicher. Der Installer zeigt die
temporären Zugangsdaten nur bei der Ersteinrichtung an; beim ersten Login ist ein
Passwortwechsel erforderlich.

Die vollständige Anleitung, Profile, Ports, Health Checks und Betriebsbefehle finden sich
unter [Ein-Kommando-Installer](docs/03-admin-guide/install-onecommand.md).

### Tests und Qualität

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend
npm run typecheck
npm test
npm run lint
```

Neue Funktionen benötigen Tests. Externer Input wird validiert und Integrationen gehören
hinter eine Adapter-Schicht. Weitere Regeln stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

### Sicherheit und Datenschutz

- Rollenbasierte Zugriffskontrolle und serverseitige Autorisierung
- Sichere Cookie-Sessions, CSRF-Schutz und nachvollziehbare Audit-Ereignisse
- Validierung von Eingaben und signierte Webhooks für unterstützte Quellen
- Sicherheitskritische Apply-, Autonomie- und Neustart-Funktionen standardmäßig deaktiviert
- Keine Secrets, Schlüssel oder produktiven Konfigurationsdateien einchecken

Bitte keine Sicherheitslücken über öffentliche Issues melden. Der verantwortungsvolle
Meldeweg steht in [SECURITY.md](SECURITY.md).

### Dokumentation und Mitwirken

- [Projekt- und Feature-Status](docs/00-overview/feature-status.md)
- [Architektur und Entscheidungen](docs/01-architecture/)
- [Admin Guide](docs/03-admin-guide/README.md)
- [Developer Guide](docs/04-developer-guide/developer-guide.html)
- [Changelog](CHANGELOG.md)
- [Beitragen](CONTRIBUTING.md)

### Lizenz

Dieses Projekt steht unter der [Apache License 2.0](LICENSE). Hinweise zu Drittkomponenten
und Urheberrechten stehen in [NOTICE](NOTICE).

---

## English

### What is Nexora SOC?

Nexora SOC is a self-hosted platform for Tier 1 to Tier 3 security operations teams. It
brings together incident tickets, evidence, threat hunting, threat-intelligence enrichment,
and telemetry from connected security sources in an auditable workflow.

Nexora complements SIEM, EDR, and log-management platforms such as Wazuh, QRadar, and
Splunk. It is **not a replacement** for those systems and does not perform automatic threat
remediation. Critical actions remain subject to roles, approvals, and auditing.

### Capabilities

| Area | Description |
| --- | --- |
| Incident management | Tickets with lifecycle, search, cross-references, and traceable history |
| Analysis Deck | Analyst workspace for queues, timelines, evidence, and threat-intelligence context |
| Threat hunting | MITRE ATT&CK-mapped hunts and a controlled command console |
| AI-assisted triage | Local models through Ollama or explicitly configured providers; recommendations remain reviewable |
| Evidence & audit | Chain of custody, hashes, and an append-only audit log for relevant changes |
| Integrations | Adapter-based connections for Wazuh, QRadar, Splunk, ServiceNow, OTRS, email, and threat-intelligence services |
| Operations | Docker deployment, PostgreSQL persistence, health checks, and role-based administration |

### Architecture

```text
Security sources / SIEMs
          │  validated adapters
          ▼
┌─────────────────────────────────────────────────────────┐
│ Nexora SOC                                               │
│ React + TypeScript ─ nginx ─ Express API ─ PostgreSQL    │
│                         │                                │
│            tickets · evidence · hunts · audit · RBAC     │
└─────────────────────────────────────────────────────────┘
```

- **Frontend:** React 18, TypeScript, and Vite
- **Backend:** Node.js, Express, and PostgreSQL
- **Architecture:** Repository pattern; in-memory repositories for tests/development and
  PostgreSQL for persistent installations
- **Integrations:** Every external source is validated and normalized through an adapter

### Development quick start

Requirements: Node.js 20 or later and npm.

```bash
# Terminal 1: API (in-memory by default when no database is configured)
cd backend
npm ci
npm run dev

# Terminal 2: web interface
cd frontend
npm ci
npm run dev
```

The UI is then available at `http://localhost:5173`; the Vite development server proxies API
requests to `http://localhost:3000`.

Alternatively, Docker Compose starts a local development stack with PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f api web
```

See the [installation guide](docs/03-admin-guide/installation.md) for database and environment
configuration details.

### Production installation

A preflight check and a single installer are available for a clean Linux host. The installer
creates a local, untracked production configuration, generates the required secrets, and keeps
write, autonomy, and restart capabilities disabled at first.

```bash
# Review the execution plan without changing the host
./deploy/install.sh --profile all-in-one --dry-run

# Lean production stack with your own domain
sudo ./deploy/install.sh \
  --profile core \
  --domain soc.example.org \
  --admin-email admin@example.org
```

Requirements are a current Linux system, `git`, Docker Engine, Docker Compose v2, `curl`,
`openssl`, free ports 80/443, and at least 10 GB of storage. Initial credentials are displayed
only during first-time setup, and the administrator must change the password at first sign-in.

For profiles, ports, health checks, and operational commands, see the
[single-command installer guide](docs/03-admin-guide/install-onecommand.md).

### Tests and quality

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend
npm run typecheck
npm test
npm run lint
```

New features require tests. External input is validated, and integrations belong behind an
adapter layer. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project rules.

### Security and privacy

- Role-based access control with server-side authorization
- Secure cookie sessions, CSRF protection, and traceable audit events
- Input validation and signed webhooks for supported sources
- Apply, autonomy, and restart capabilities are disabled by default
- Never commit secrets, private keys, or production configuration files

Please do not report vulnerabilities through public issues. Follow the responsible disclosure
process in [SECURITY.md](SECURITY.md).

### Documentation and contributing

- [Project and feature status](docs/00-overview/feature-status.md)
- [Architecture and decisions](docs/01-architecture/)
- [Admin guide](docs/03-admin-guide/README.md)
- [Developer guide](docs/04-developer-guide/developer-guide.html)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

### License

This project is licensed under the [Apache License 2.0](LICENSE). Third-party notices and
copyright information are available in [NOTICE](NOTICE).
