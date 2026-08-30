# Deployment Center — Architektur-Plan (Network as Code)

> **Network as Code** für den SOC-Stack: die Deploy-Spec ist der Code (deklarativ, versioniert, wiederholbar),
> `Plan → Approve → Apply` ist der IaC-Workflow. Schön aufbereitete Übersichts-Doku: `network-as-code.html`.
>
> Stand 2026-06-30. **Konzept/Plan — noch kein Code.** Bezug: `deployment-center-concept.md` (Gesamt-Konzept + Fresh-Install).
> Ziel: vorkonfigurierte Open-Source-Systeme aus Nexora heraus **als VM auf einem Virtualisierer
> (Proxmox/ESXi) deployen — deklarativ parametrisiert** (statische IP, VLAN, DNS, Ressourcen …),
> modular (jedes System / jeder Hypervisor = ein Modul), gegated + auditiert.

---

## 1. Prinzip
**Jedes System wird gleich behandelt**, aber jedes bringt seine eigenen Vorgaben mit. Drei austauschbare Teile:

```
   System-Modul (WAS)          Hypervisor-Connector (WOHIN)        Deploy-Orchestrator (WIE)
   ┌───────────────────┐       ┌───────────────────────┐          ┌──────────────────────────┐
   │ Template/Image    │       │ Proxmox (REST-API)    │   →      │ validate(Spec) → Plan →   │
   │ paramSchema       │  ×    │ ESXi/vSphere (später) │          │ Approve(4-Augen) → Apply →│
   │ resourceDefaults  │       │ clone·net·start·destroy│         │ Status → Rollback         │
   │ configApplier     │       └───────────────────────┘          └──────────────────────────┘
   └───────────────────┘
```
Erweiterung = ein Modul *oder* ein Connector dazu (nach Vertrag) + Doku. Kein direktes „Exec" — alles über das **vorhandene Apply-Kanal-Muster** (Draft→Approve→Plan→Apply, gated + auditiert).

---

## 2. Kern-Abstraktionen

### 2.1 System-Modul (Deploy-Area, vorkonfiguriert)
Pro System eine Modul-Definition (Code-Katalog/Allowlist, analog `correlatorRegistryCatalog`):
- **identity:** `id`, `name`, `type` (`firewall|siem|ids|honeypot`), `vendor`, `version`.
- **source:** Template-Referenz (Proxmox-Template-VMID zum Klonen — bevorzugt) ODER ISO + automatisierte Erstinstallation.
- **resourceDefaults:** `cpu`, `ramMB`, `diskGB` (vom User überschreibbar).
- **paramSchema** ← *die Vorgaben*: deklarative Felder mit Typ/Validierung/Default/required (siehe §3).
- **configApplier:** wie die Vorgaben in die laufende VM kommen (siehe §4).

### 2.2 Hypervisor-Connector (austauschbar)
Einheitlicher Vertrag: `cloneFromTemplate(templateRef, spec) · setResources · attachNetwork(bridge, vlanTag) · start · status · destroy · snapshot`.
- **Proxmox-Connector** (zuerst): Proxmox REST-API (`/nodes/:node/qemu/:vmid/clone`, `config`, `status/start`). Du hast Proxmox im Lab, OPNsense läuft dort schon als VM 117 → direkt greifbar.
- **ESXi/vSphere-Connector** (danach): vSphere-API/govc.
- **Connector-Instanz** = Registry-Eintrag mit Host + API-Token (verschlüsselt), Ziel-Node, Storage, Bridge.

### 2.3 Deploy-Spec (was der User absendet)
`{ moduleId, connectorId, targetNode, storage, bridge, resources?, params }` — `params` wird gegen `module.paramSchema` validiert.

### 2.4 Deploy-Orchestrator (Lifecycle)
`validate(spec)` → **plan** (Dry-Run: „lege VM X aus Template Y auf Node Z mit IP/VLAN/DNS an") → **approve** (4-Augen) → **apply** (`clone → setResources → attachNetwork(vlan) → start → configApplier(params)`) → **status** (bis erreichbar/Heartbeat) → bei Fehler **rollback** (`destroy`). Jeder Schritt auditiert.

---

## 3. Parametrisierung (der Kernpunkt)
Jedes Modul deklariert seine Vorgaben. Gemeinsamer **Netzwerk-Block** (für alle Systeme), plus vendor-spezifisch:

**Gemeinsam (Netzwerk):** `hostname`, `ipMode` (`static|dhcp`), `staticIp`, `cidr`, `gateway`, `vlanTag` (1–4094), `dns[]` (1–3 IPs), `bridge`.
**Ressourcen:** `cpu`, `ramMB`, `diskGB`.
**Beispiel OPNsense (vendor-spezifisch):** `wanInterface`, `lanInterface`, `lan.staticIp`+`cidr`, `lan.vlanTag`, `adminPassword` (secret, write-only).
**Beispiel Wazuh / IDS-Sensor:** Netzwerk-Block + `managerUrl` (Sensor→Manager) bzw. `indexerNodes`.

**Validierung** (am System-Rand, fail-fast): IP/CIDR-Format, VLAN 1–4094, DNS-IPs, Pflichtfelder, keine Kollision (IP/VMID bereits belegt → Plan-Fehler). Secrets nie im Plan/Log/Return.

---

## 4. Config-Applier (wie Vorgaben in die VM kommen)
Pro Modul, weil Mechanismus vendor-abhängig:
- **OPNsense:** Golden-Template klonen → `config.xml` aus `params` rendern (LAN-IP, VLAN, DNS, Hostname) → per OPNsense-`config-import`/API einspielen → Reboot. (Alternativ: vorbereitetes Template + erster-Boot-Importer.)
- **Linux-Systeme (Wazuh, Suricata-IDS, Honeypot):** **cloud-init** (NoCloud-Datastore): netplan (static IP/CIDR/Gateway/VLAN/DNS) + hostname + Paket-/Service-Setup. Ein generischer `cloudInitApplier`, den viele Linux-Module teilen (DRY).
- Vertrag: `configApplier(connector, vmid, params) → Promise<void>`; idempotent, fail-safe (Rollback wenn Config scheitert).

---

## 5. Sicherheit (schreibt echte Infrastruktur!)
- Strikt hinter dem **Apply-Kanal** (Draft → 4-Augen-Approval → Plan/Dry-Run → Apply) + eigenes **`DEPLOY_ENABLED`-ENV-Gate** (default AUS, inert).
- **Reauth-Token** vor Apply (wie bestehender Apply-Kanal). RBAC **admin**. Rate-Limit.
- **Hypervisor-Credentials verschlüsselt** (kein Klartext, nie im Return). Connector-Token gehasht/SHA-256 wie NodeCredential.
- **Vollständiges Audit** jedes Schritts (clone/config/start/destroy) — append-only.
- **Rollback** bei jedem Fehlerschritt (VM destroy). **Idempotenz**: gleicher Spec → kein Doppel-Deploy (Spec-Hash).
- DSGVO/Privacy: Deploy-Parameter (IPs) sind Infra-Daten, kein PII — aber Audit-IP-Pseudonymisierung-Muster beachten.

---

## 6. Datenmodell (neu)
- **Code-Allowlists** (kein User-Input): `deployModuleCatalog` (verfügbare System-Module), Connector-Typen.
- **DB-Tabellen:** `hypervisor_connectors` (Instanzen + verschlüsselte Creds), `deploy_specs`, `deploy_runs` (Lifecycle-Status), `deploy_run_steps` (Schritt-Audit). Migration nummeriert, idempotent.

---

## 7. Vertikaler Schnitt #1 — „OPNsense → Proxmox"
**Definition of Done:** Aus der UI „OPNsense, LAN 10.0.10.1/24, VLAN 10, DNS 10.0.10.10, 2 vCPU/2GB" → **Plan** zeigt den Ablauf → **Approve** → Nexora klont das OPNsense-Golden-Template auf Proxmox, setzt Ressourcen + Netz/VLAN, startet, importiert die config.xml → OPNsense läuft mit **genau** dieser Vorgabe; alles auditiert; Fehler → Rollback.
**Bausteine:** Proxmox-Connector · OPNsense-Modul (Template-Ref + paramSchema + config-import-Applier) · Deploy-Orchestrator über Apply-Kanal · `DEPLOY_ENABLED`-Gate · UI-Seite (Plan/Approve/Status).
**Voraussetzung (operator):** ein gepflegtes **OPNsense-Golden-Template** auf Proxmox + Proxmox-API-Token + existierende VLAN-Bridge.

---

## 8. Danach (eins nach dem anderen)
- 2. Connector **ESXi/vSphere** (gleicher Vertrag).
- 2./3. Modul **Wazuh**, **Suricata-IDS-Sensor**, **Honeypot** (cloud-init-Applier wiederverwendet).
- **Modul-Autoren-Doku:** „So baust du ein neues System-Modul (paramSchema + Applier)" und „So baust du einen neuen Hypervisor-Connector" — der Erweiterbarkeits-Vertrag (deine „jede Firewall der Welt"-Vision, dann selbst machbar). → **fertig:** `deployment-center-module-authoring.md`.

---

## 9. Offene Punkte / Risiken
- **Golden-Templates** müssen existieren + gepflegt werden (Image-Beschaffung, Versionierung). OPNsense = OSS, lizenzrechtlich ok.
- **VLAN-Bridge** muss auf dem Hypervisor vorhanden sein (Connector prüft im Plan).
- **ESXi-API** unterscheidet sich deutlich von Proxmox → eigener Connector, später.
- **Netzwerk-Sicherheit:** Nexora braucht API-Zugang zum Hypervisor — abgeschottetes Mgmt-Netz, Token mit minimalen Rechten.
- **Erst-Boot-Timing:** Config-Import erst wenn VM-Agent/API bereit (Retry/Backoff).
