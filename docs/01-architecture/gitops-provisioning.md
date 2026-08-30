# GitOps Provisioning for Nexora SOC

> **Status:** Design-Skizze (Draft 2, 2026-06-17) · **doc-only, noch kein Code.**
> **Idee in einem Satz:** Nexora-Knoten werden über einen **Git Pull Request** beschrieben,
> geprüft und nach Freigabe provisioniert — nicht von Hand am System gedreht.
>
> Nexora bleibt Open Source. Das soll sich anfühlen wie: *wir bauen eine einfache, sichere
> Grundlage, die später wachsen kann.* Kleine Bausteine, kein Big Bang, kein Overengineering.

> ## ⛔ Wichtigste Sicherheitsregel (gilt für das ganze Dokument)
>
> **Das Install-Script ändert NIEMALS Netzwerk-Konfiguration.**
> Kein Management-Interface, keine IP, kein DHCP/static-Umschalten, kein Gateway, kein DNS,
> kein VLAN, kein NAT, kein Routing, kein Sniffing, keine Firewall-Regeln, keine
> OPNsense-/Wazuh-/Firewall-Config.
>
> Der Installer ist **nur ein sicherer Bootstrap**: Agent/Connector installieren · enrollen ·
> Backend kontaktieren · Profil abrufen · Hostname/IP/Interfaces **read-only** erkennen ·
> Capabilities **read-only** melden · Heartbeat senden · auf spätere **genehmigte** Aktionen warten.
>
> GitOps kann **Wunschzustände beschreiben**, aber das **Apply von Netzwerkänderungen ist NICHT
> Teil des Installers** — das sind spätere, separate Workflows mit Plan/Preview, explizitem
> Approval, Rollback, Audit, Role-Gate und **Apply disabled by default**.

---

## 1. Warum GitOps Provisioning?

Heute werden Lab-Knoten per Script/SSH von Hand eingerichtet (`scripts/lab`). Das geht, ist aber
nicht versioniert und schwer nachvollziehbar. GitOps dreht das um — der **gewünschte Zustand**
liegt als Datei im Repo:

- **Alles versioniert** — jede Änderung hat Commit, Autor, Zeit.
- **Pull Request statt manueller Änderung** — nichts wird „mal eben" am System gedreht.
- **Review vor Apply** — ein Mensch sieht den Plan, bevor etwas passiert.
- **Prüfbar & auditierbar** — CI validiert, jeder Schritt ist dokumentiert.
- **Nachvollziehbar für Open Source** — wer das Repo liest, versteht die Infrastruktur.
- **Gut für Community und spätere Enterprise-Nutzung** — gleicher Weg, nur mehr Gates oben drauf.
- **Kein Big Bang** — kleine Bausteine, wächst Schritt für Schritt.

Das passt zum projektweiten Leitsatz: **Read-only zuerst; Writes nur mit Capability + RBAC +
Preview + Audit + explizitem GO** (vgl. `docs/04-developer-guide/agent-orchestration.md` und das
bestehende FP-Apply-Gate `WAZUH_FP_APPLY_ENABLED`).

---

## 2. Einfacher Ablauf

```
YAML im Repo
  → Pull Request
  → CI prüft (Schema, IPs, verbotene/gefährliche Flags)
  → Plan/Preview wird angezeigt (PR-Kommentar)
  → Mensch reviewt
  → Merge
  → Nexora Backend erstellt später Provisioning/Enrollment
  → Installer installiert NUR Agent/Connector und enrollt (bootstrap-only)
  → Backend zeigt Runtime-Status, Health, Capabilities
```

**Wer macht was (Schichten):**

```
GitHub          = beschreibt den GEWÜNSCHTEN Zustand (versioniert, reviewbar)
Nexora Backend  = Control Plane: Runtime-Status, Health, Audit, Enrollment, Capabilities
Agent/Sensor    = führt nur FREIGEGEBENE Aktionen aus (Bootstrap ändert kein Netz)
```

GitHub ersetzt das Backend nicht — es ist der **genehmigte Änderungsweg** dorthin.

---

## 3. Rollenmodell

```
control_plane
  - Nexora Backend / UI / API / PostgreSQL

normal_agent
  - Inventory, Logs, Heartbeat, sichere Aktionen
  - darf KEINE Netzwerk-Konfiguration ändern · kein NAT · kein Routing · kein Sniffing

integration_connector
  - Wazuh · OPNsense · QRadar · Splunk · IDS
  - API/Webhook/Syslog/Collector-Anbindung
  - zunächst read-only bevorzugt

network_sensor   (spätere Rolle)
  - Syslog, Flow, IDS, Sniffing
  - Sniffing NIEMALS automatisch beim Install — nur über separaten Approval-Workflow

gateway_sensor   (spätere Rolle)
  - NAT / Routing
  - high-risk · nur mit Preview, Approval, Rollback und Audit
  - Apply disabled by default
```

**Wichtige Regel: Agent ≠ Sensor ≠ Gateway.** Ein normaler Agent darf **niemals still**
Netzwerkfunktionen aktivieren.

---

## 4. YAML-Beispiele

Die YAML beschreibt **Wunsch/Profil**. Der Installer ändert **NICHT** automatisch das Netzwerk.
`changeNetwork: false` und `applyDuringInstall: false` sind die durchgängigen Sicherheitsanker.

### Beispiel A — normaler Agent, sicherer Bootstrap (DHCP nur read-only erkannt)

`deploy/provisioning/nodes/windows-client-01.yaml`

```yaml
node:
  name: windows-client-01
  role: normal_agent
  labels:
    environment: lab
    owner: soc

install:
  mode: bootstrap_only
  changeNetwork: false

network:
  discovery: read_only
  expectedMode: dhcp
  applyDuringInstall: false

features:
  inventory: true
  logCollection: true
  commandConsole: false
  sniffing:
    requested: false
    applyDuringInstall: false
  nat:
    requested: false
    applyDuringInstall: false

nexora:
  serverUrl: https://nexora.example
  enrollmentProfile: lab-agent
```

### Beispiel B — Sensor-Wunschprofil (statische IP als Zielzustand, NICHT beim Install anwenden)

```yaml
node:
  name: nexora-sensor-01
  role: network_sensor

install:
  mode: bootstrap_only
  changeNetwork: false

network:
  discovery: read_only
  desiredState:
    mode: static
    managementInterface: eth0
    ip: 10.99.99.50
    cidr: 24
    gateway: 10.99.99.1
    dns:
      - 10.99.99.10
  applyDuringInstall: false

features:
  syslogReceiver:
    requested: true
  flowCollector:
    requested: true
  sniffing:
    requested: true
    interface: eth1
    mode: passive
    applyDuringInstall: false
    requiresApproval: true
  nat:
    requested: false
    applyDuringInstall: false

safety:
  previewRequired: true
  approvalRequired: true
  rollbackRequiredForNetworkChanges: true

nexora:
  serverUrl: https://nexora.example
  enrollmentProfile: lab-sensor
```

### Beispiel C — Gateway/NAT nur als High-Risk-Wunschzustand (keine Installer-Aktion)

```yaml
node:
  name: nexora-gateway-01
  role: gateway_sensor

install:
  mode: bootstrap_only
  changeNetwork: false

network:
  discovery: read_only
  desiredState:
    mode: static
    managementInterface: eth0
    ip: 10.99.99.60
    cidr: 24
    gateway: 10.99.99.1
    dns:
      - 10.99.99.10
  applyDuringInstall: false

features:
  routing:
    requested: true
    applyDuringInstall: false
    requiresApproval: true
  nat:
    requested: true
    outboundInterface: eth0
    internalInterface: eth1
    applyDuringInstall: false
    requiresApproval: true

safety:
  changeWindowRequired: true
  rollbackRequired: true
  approval:
    required: true
    minimumReviewers: 1
```

> ⚠️ **Diese Beispiele beschreiben Zielzustände. Der Installer setzt sie nicht automatisch um.**
> Netzwerkänderungen sind immer ein separater, genehmigter Apply-Workflow.

---

## 5. Safety Gates

| Aktion | Risiko | Regel |
|---|---|---|
| **Bootstrap Install** | niedrig | Agent/Connector installieren · beim Backend enrollen · Inventory **read-only** melden · **keine Netzwerkänderung** |
| **DHCP expected** | niedrig | nur dokumentierter/erwarteter Zustand · Installer prüft nur read-only |
| **Static IP desired** | mittel | nur Zielzustand im GitOps-Profil · Apply später separat · validate: CIDR, Gateway, DNS, **Duplicate-IP-Check** (später) |
| **Sniffing requested** | mittel/hoch | nur `network_sensor` · Interface muss explizit angegeben sein · **Approval erforderlich** · kein Full-Packet-Capture default · **nicht beim Install aktivieren** |
| **NAT/Routing requested** | hoch | nur `gateway_sensor` · **Preview Pflicht** · **Rollback Pflicht** · Change-Window empfohlen · **explizites Approval** · **Apply disabled by default** |
| **Secrets** | — | **nie im Repo** · nur Secret-References oder Backend-Secrets · Tokens werden vom Backend erzeugt |

---

## 6. CI/PR Validation Design

> Für P_GITOPS_1 **nur Design** — keine GitHub Action implementieren.

**Bei Pull Request soll CI später:**
- YAML-Schema validieren
- verbotene Rollen/Features blockieren
- NAT/Sniffing markieren (sichtbar im Plan)
- IP/CIDR-Format validieren
- **keine Secrets im YAML erlauben**
- prüfen, dass `applyDuringInstall` bei Netzwerkänderungen `false` ist
- prüfen, dass `changeNetwork: false` ist
- **Plan erzeugen** und als PR-Kommentar schreiben

**Bei Merge:**
- Backend-Provisioning-Request erstellen
- Enrollment-Profile erzeugen oder referenzieren
- optional Install-Command anzeigen
- **keine Netzwerkänderungen automatisch ausführen**
- Apply-Schritte bleiben separate, bestätigte Workflows

---

## 7. Plan/Preview Beispiel (PR-Kommentar)

```
Nexora Provisioning Plan

Node: nexora-sensor-01
Role: network_sensor
Risk: medium

Bootstrap will:
  - install Nexora agent/connector
  - enroll node with Nexora backend
  - report hostname, IPs, interfaces (read-only)
  - start heartbeat

Bootstrap will NOT:
  - change IP address
  - change DHCP/static mode
  - change gateway
  - change DNS
  - enable sniffing
  - enable NAT
  - enable routing
  - change firewall rules
  - change Wazuh or OPNsense

Desired future state:
  - static IP 10.99.99.50/24 on eth0
  - passive sniffing requested on eth1
  - syslog receiver requested
  - flow collector requested

Required approvals for future apply:
  - 1 reviewer
  - sensor approval (sniffing requested)
  - separate apply workflow required
```

---

## 8. Backend Control Plane (spätere Objekte)

Nur Design, **keine Migration**:

```
provisioning_profiles      desired_network_states
enrollment_tokens          pending_apply_requests
installed_nodes            integration_instances
node_heartbeats            integration_health
node_capabilities          provisioning_audit_events
```

Das Backend bleibt die Quelle für **Ist-Zustand**, Health, Enrollment, Capabilities, Audit und
Rollback — GitHub liefert den **Soll-Zustand**.

---

## 9. Installer-Idee (bootstrap-only)

```bash
# Linux
curl -fsSL https://nexora.example/install.sh | sudo bash -s -- --profile nexora-sensor-01

# Windows (PowerShell)
iwr https://nexora.example/install.ps1 -UseB | iex
Install-NexoraAgent -Server "https://nexora.example" -Profile "windows-client-01"

# Windows EXE/MSI (später)
NexoraAgentSetup.exe /server https://nexora.example /profile windows-client-01
```

**Wichtig:**
- Installer zieht das Profil **aus dem Backend**.
- Installer nutzt **keine Secrets aus Git**.
- Installer **ändert kein Netzwerk**.
- Bei `requested` Netzwerkänderungen wartet der Installer auf spätere Approval-/Apply-Workflows.

---

## 10. Not in v1 (bewusst noch NICHT)

- keine automatischen Netzwerkänderungen
- kein automatisches NAT
- kein stilles IP-Ändern
- kein DHCP/static-Umschalten
- kein Sniffing beim Install
- kein Full-Packet-Capture default
- keine Secrets im Git-Repo
- kein produktiver Remote-SSH-Installer
- keine Auto-Writes auf Wazuh/OPNsense
- kein komplexes Kubernetes/GitOps-Overengineering
- keine Agent-Kommandos ohne Backend-Approval

---

## 11. Kleine Roadmap

```
P_GITOPS_1     Design doc (dieses Dokument)
P_GITOPS_2     YAML schema + validate-only script
P_GITOPS_3     GitHub Action validate + plan comment
P_PROVISION_1  Backend Provisioning Domain Model
P_AGENT_1      Enrollment Token + Heartbeat
P_INSTALL_1    Linux bootstrap installer
P_INSTALL_2    Windows PowerShell bootstrap installer
P_INSTALL_3    Windows EXE/MSI (later)
P_SENSOR_1     Network sensor role, apply disabled by default
P_GATEWAY_1    NAT/Routing with preview + rollback, apply disabled by default
```

Empfohlener nächster Schritt: **P_GITOPS_2 (YAML-Schema + validate-only)** — read-only und ungefährlich.

---

## 12. Open Questions

- Wo liegen die Provisioning-YAMLs im Repo? (Vorschlag: `deploy/provisioning/nodes/`)
- Wie wird **Duplicate-IP-Detection** gemacht (gegen andere Profile + gegen Ist-Zustand)?
- Welche **Secrets-Strategie** (Backend-Secrets, References, Verschlüsselung)?
- Welche **Runner** dürfen überhaupt `apply` ausführen (und wer nie)?
- Wie wird **Rollback** dokumentiert und getestet?
- Wie trennen wir **Community/Open Source vs. Enterprise**-Features, ohne OSS kaputtzumachen?
- Wie verhindern wir, dass ein **Agent/Claude versehentlich Netzwerkänderungen** ausführt?
  (Antwortrichtung: `applyDuringInstall:false` + Backend-Approval-Gate + Role-Gate + die
  harten Gates aus `docs/04-developer-guide/agent-orchestration.md`.)
- Wie sieht ein **sicherer manueller Apply-Workflow** aus (Plan → Approval → Change-Window → Rollback → Audit)?

---

## Bezug

- Control Plane / Runtime-Status: Integration Registry + Agent Enrollment (geplant, `P_ADMIN_*` / `P_PROVISION_*`).
- Agenten-Gates & Single-Merge: `docs/04-developer-guide/agent-orchestration.md`.
- Heutige manuelle Variante, die GitOps später ablöst: `scripts/lab` (One-Shot-Deploy).
