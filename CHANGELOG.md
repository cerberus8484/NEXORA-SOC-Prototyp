# Changelog

Alle nennenswerten Änderungen an Nexora SOC. Format angelehnt an *Keep a Changelog*.
Live-Stand: nexora.example (10.99.99.75).

## [Unreleased]

### 2026-07-05 — Containment Real-Execution (ADR-042): menschlich ausgelöste, gated Host-Isolation

> **Vollständig auf `p-phase0-close`, holistisch security-reviewed (APPROVE, kein CRIT/HIGH), INERT.** Der Response-
> Workflow bekommt seine Stufe 3: echte Endpoint-Ausführung genehmigter Containment-Aktionen. **Kein „Auto"** —
> Mensch beantragt → zweiter genehmigt (Vier-Augen + Pflicht-`authorizationBasis`) → Mensch löst explizit aus (frische
> Reauth). Nexora handelt nie selbst. Konsistent mit ADR-016 (host_response=human-only-Decke, verboten ist nur
> *Automatik*) und außerhalb ADR-020 (No-Apply = Provisioning-Domäne); Geschwister zu ADR-041 (gleicher gehärteter
> `sshExecRunner`). **Bleibt inert hinter `HUNT_RESPONSE_REAL_EXEC_ENABLED` (default AUS).**

**Backend (Slices 1–2):** `HuntService.executeResponseAction` — mehrschichtig fail-closed, alle Gates VOR jedem Kanal-
kontakt: Kill-Switch → Circuit-Breaker → frische Reauth (`verifyDeployReauth`, one-shot) → admin-Route → Drei-Parteien
(`executedBy` ≠ Anforderer) → nur umkehrbar (isolate/release) → Status approved → Concurrency-Lock je Host → Runner.
Domain-Feld `executedBy`; Config-Gate `huntResponse.realExecutionEnabled`. Execute-Route
`POST /v1/hunts/:id/response-actions/:actionId/execute` (admin + X-Reauth-Token).

**Slice 3 — echter Containment-Kanal (inert):** `containmentRunner` löst `targetHost` → enrollter managed Node
(Registry, gepinnter Host-Key, **kein TOFU**, IP-Ambiguität fail-closed) → `sshExecRunner` mit OS-Dispatch: **Linux**
`isolate-host.sh`/`release-isolation.sh` (nftables, root) · **Windows** `isolate-host.ps1`/`release-isolation.ps1`
(Windows-Firewall, Administrator). **Kern-Invariante Mgmt-Preservation:** Isolation hält den Steuer-Kanal explizit
offen (live `$SSH_CONNECTION`-Peer + `NEXORA_MGMT_CIDR`) — ohne CIDR verweigert (`E_NO_MGMT_PRESERVE`, Selbst-Aussperr-
Schutz); Freigabe stellt den Vor-Zustand exakt aus State-Datei wieder her (nicht blind Allow). Skripte idempotent +
self-verify; Script-Level-Test (16/16).

**Hardening:** Startup-Readiness-Healthcheck (warnt bei armed-aber-unvollständig), Concurrency-Lock, Circuit-Breaker
(Kanal-Sperre nach 3 Fehlern, admin-Reset) + Frontend-Warnbanner, Execute-Button im `ResponseActionsPanel`, Operator-
Runbook. **M-1 (Review-Fund) geschlossen:** Containment-Targeting filtert auf aktive Nodes (retired/pending raus).

### 2026-07-04 — Deployment Center: Nodes „updatebar" (Windows + Linux) + Source-Integrations-Filter

> **Auf `p-phase0-close` gepusht (GitHub + lokale Gitea).** Der updatebar-Pfad ist **mehrschichtig fail-closed**
> und **inert** hinter `NODE_UPDATE_ENABLED` (aus) — getrennt vom vm-clone-`DEPLOY_ENABLED`. Jede RCE-Slice
> security-reviewed (kein CRIT/HIGH).

**Windows-Server persistent + updatebar (vm-clone → permanenter managed Node, Slices 6c–7d):**
- **Platform-Deploy-Keypair (`999902df`, Auth-Modell A):** ed25519, Private-Key AES-256-GCM in `platform_settings`
  (nie herausgegeben, nur transient beim Runner-Bau); Public-Key in `authorized_keys` der VM (Renderer, `0bbb369b`).
  Rotation invalidiert Provisionierungen → reauth-gated + auditiert.
- **Host-Key-Pinning ohne TOFU:** Option 1 Auto-Capture beim Deploy (best-effort) + Option 2 Admin-Arm-Confirm
  (`544080bd`, `sshHostKeyScan`); Migration 055 (`host_key_pin`).
- **Echter Update-Runner (`859913ea`, Slice 6f):** `buildDeployUpdateRunner` baut den SSH-Runner aus Private-Key +
  gepinntem Host-Key + Host-Allowlist. Fail-closed: kein Keypair→E_NO_CHANNEL, kein Pin→E_NO_HOSTKEY, keine IP→E_NO_HOST.
- **Frontend (`938493ea`…`a16d7f4f`, Slices 7a–d):** `ManagedNodesPanel` im Deployment Center — Keypair generieren/
  rotieren (mit Rotations-Warnung), Host-Key erfassen, gated Update; Operator-Loop (gemeldete Agent-Version +
  Public-Key-Copy zum Onboarden von Nicht-Nexora-Hosts). Reine View-Logik `managedNodesView` (getestet).

**Linux-Nodes updatebar (`5425aa09`, Slice 8, symmetrisch):** `nodeUpdateService.updateTargetForOs` (windows→ps1/
Administrator · linux→bash/root · sonst E_UNSUPPORTED, `os` aus der Registry); `deploy/update-wazuh-agent.sh` (root,
Paketmanager **lokal** per `command -v` erkannt → keine Distro-Injektion; self-skip wenn nicht installiert; Signatur-
prüfung über den beim Install gepinnten Keyring). Gleiche fail-closed-Gates wie Windows.

**Runbook (`5ae2dc07`):** `docs/01-architecture/deployment-center-node-update-runbook.md` — Keypair→Host-Key-Pin→
gated Update (ENV/UI/API/Fehler-Katalog/Prod-Checkliste) für den Live-Smoke.

**Source-Integrations-Filter:**
- **fix (`ca1dc5ec`):** `SOURCES`-Enum um die real produzierten `crowdsec`/`email`/`dataplane` ergänzt — vorher lehnte
  `listTicketsSchema` diese Filter-Werte ab (400), obwohl Live-Adapter sie an Tickets vergeben. `ticketApi.list/listIds`
  um `source?` typisiert; Ticket-Dropdown um „Threat Hunt".
- **feat (`2a5f80bb`):** Dashboard-Card **„Top Quellen"** — welche Integrationen echt Tickets liefern (24h/gesamt/
  Liveness), aus dem vorhandenen `ingestActivityBySource`-Aggregat; reine `sourceActivityModel` (getestet).

### 2026-07-04 — Deployment Center: Linux-Client + Windows-Client (agent-install) end-to-end, live via lokale Gitea

> **Auf `p-phase0-close` (gepusht) + auf CT120 @ 10.0.10.75 deployt** — erstmals **aus der lokalen Gitea**
> (`10.0.99.50`, statt GitHub), Build aus `p-phase0-close`, Migration 054 lief beim Boot, Health `ok`. Jede Slice
> security-reviewed (kein CRIT/HIGH). **Alles inert hinter `DEPLOY_ENABLED` (aus)** — sichtbar/konfigurierbar, aber der
> scharfe Remote-Install braucht weiter User-GO + Ziel-Host.

**Linux-Client (Wazuh-Agent per SSH) — komplette agent-install-Kette (Slices 2a–2c):**
- **`sshExecRunner` (2a, `5855ab79`):** echter SSH-Transport via **ssh2**, In-Memory-Key (nie auf Platte), **Host-Key-Pinning**
  timing-safe (kein TOFU), SSRF-Host-Policy, scriptId-Allowlist, ENV nur als validierte `export`-Preamble über stdin an
  `bash -s` (keine Command-Zeile aus Nutzereingabe), Timeout + fail-closed, rohe Fehler nur ins Log.
- **agent-install-Orchestrierung (2b, `10973606`):** `DeployOrchestrator.executeAgentInstall` (gleiche Gates zuerst,
  `applying→deployed`, idempotenter Fehlschlag→`rolled_back`), `DeployService` verzweigt `createSpec`/`plan`/`apply` auf
  `module.kind`; `DeploySpec.create({requirePlacement})`; `_redact` scrubbt jetzt auch `key=…`.
- **Verschlüsselter SSH-Connector (2b-2, `6170a97a`):** `SshDeployConnector` — `privateKey`/`passphrase` AES-256-GCM at-rest,
  `hostKeyPin` = SHA-256-Fingerprint; `makeSshRunner` baut den Runner transient; ein Host je Connector (allowlist).
- **Create-Route + Persistenz (2c-a, `3ca0173b`):** `POST /deploy/connectors` mit `type=ssh`; **Migration 054**
  (ssh-Spalten + NOT-NULL gelockert + CHECK-Constraint pro Typ); `publicConnectorView` strippt Key-Material.
- **Frontend (2c-b, `39365031`):** Kachel-Gruppe **Endpoints/Agenten**, Connector-Form mit **Proxmox/SSH-Umschalter**
  (privateKey write-only), agent-install-Sicht.

**Windows-Client (2. agent-install-Modul, `db8840c8`):** Wazuh-Agent per **OpenSSH/PowerShell** — Runner **shell-aware**
(`scriptId → {shell, envStyle}`: `bash -s`/`export` vs `powershell … -Command -`/`$env:`); `sshPowershellAdapter` +
`install-wazuh-agent.ps1` (idempotent, MSI, TLS 1.2); Modul `windows-client`; SSH-User Windows-fähig (`Administrator`,
injektionssicher). Installer (`.ps1` **+** `.sh`) validieren ENV jetzt selbst (Defense-in-Depth).

**UX-Fix + Konfigurierbarkeit:**
- **fix(ui) (`27ad8e25`):** `apply` liefert den End-Run (`DeployRun`), war im FE als `RunDetail` fehl-typisiert →
  `result.run`=undefined → Run-Panel wäre nach Apply verschwunden. Korrigiert + neue **Schritt-Timeline** (via `getRun`).
- **feat(ui) (`c7c4da43`):** agent-install nicht mehr demo-hartkodiert — **Formular** (SSH-Connector wählen ·
  Wazuh-Manager · Agent-Name); `buildAgentInstallSpecBody` (rein, getestet).

**Deploy/Ops:**
- **End-to-End-Smoke (`38428cf8`):** `npm run smoke:deploy-linux-client` — in-process ssh2-Server als Ziel, reale
  Deploy-Kette (Linux **und** Windows) mit echtem Transport, ohne Docker/Prod (Erfolg/Fehler/Host-Key-Mismatch).
- **Lokale Gitea als Deploy-Quelle** eingerichtet (`admin/Nexora-Control-Plane` auf `10.0.99.50`, scoped Token) —
  Prod-Rebuild erstmals aus Gitea gezogen + gebaut.

**Tests:** Deploy-Suite 235+ · gesamte FE-Suite 170 Dateien / ~1706 · tsc sauber.

**Offen:** MSI-Signatur-Pin (`.ps1`) + GPG-Pin (`.sh`) vor Scharfschalten · Reauth auf `POST /connectors` (Follow-up) ·
**Live-Apply** auf Test-Host (braucht GO + `DEPLOY_ENABLED=true`) · Merge `p-phase0-close → main`. Ops-Vorfall (Snapshot-
Freeze fror CT120 ein → Recovery + `osb-guest-snap` gehärtet) siehe `memory/incident_osb_snap_froze_ct120.md`.

### 2026-07-03 (PM) — Session-Log: Security-Scan-Fixes, IA-Konsolidierung, Branding, Deploy-Foundation

> **Alles gemergt nach `main` + live auf CT120 @ 10.0.10.75 deployt** (main HEAD `c6f6f6b3`). Je PR: TDD → CI 8/8 →
> Merge → `release.sh` (DB-Backup + Smoke). **Nächste Session: Start beim SSH-Runner (s. „Offen" unten).**

**Security (Code-Scan-Funde, [PR #42](https://github.com/cerberus8484/Nexora-Control-Plane/pull/42) → `64a463ce`):**
- **fix(security) HIGH:** MFA-Verifikation gegen Brute-Force rate-limiten. `mfaChallengeLimiter` auf `POST /auth/mfa`
  (pro Challenge-Token, nur Fehlversuche zählen) + `mfaUserLimiter` auf `/mfa/verify`+`/disable` (pro User); `jti`-Nonce
  in `_signMfaChallenge`; `config.mfa.verifyLimit`. +6 Tests.
- **fix(security):** `classifyConnError` auch bei `/ki/test`, `/ki/models`, `/oidc/test` (Info-Disclosure-Rest).
- **fix(ui):** `doDisarm()`-Fehler sichtbar (Feedback-Kanal); DeployPage-Teilerfolg als Warn-Ton. **perf:** Applier `Promise.all`.

**Phase 1 — IA-Konsolidierung (Frontend, PRs #43–#48):**
- Wazuh-/QRadar-Dashboard → **Monitoring** (raus aus Integrations).
- Integrations-Konfig als **eigene Seite `/integrations/config`** (aus Settings gelöst), als **Akkordeon-Liste**;
  **Wazuh-Verbindung** dorthin gezogen (alle Verbindungen zentral); **Services = reine Ops**.
- Neue Gruppen **KI / Automation** (`/ki`: KI-Agent, Autonomy, ML-Eval) und **Deployment / Nodes** (`/deployment`:
  Deploy, Provisioning, Correlators, Data-Plane).
- **Administration aufgelöst** → **Services** als eigener Top-Level-Eintrag.
- **Settings verschlankt:** API/Webhooks → Integrations; KI-Tab entfernt (war Duplikat der KI-Agent-Seite).

**Phase 2 — Branding (`feat(ui)`, [PR #49](https://github.com/cerberus8484/Nexora-Control-Plane/pull/49) → `670d55e2`):**
- Neue Branding-Felder **Schriftart** (system-sichere Stacks → `--font-sans`), **Hintergrundfarbe** (`--bg`),
  **Sidebar-Farbe** (`--sidebar-bg`) + Akzent/Name. Backend-Keys + Joi. Pure `applyBranding` (+Tests).
- **Globaler Applier beim App-Load** → Branding wirkt app-weit (nicht nur im Branding-Tab). Sidebar von gescoptem
  `--bg-elevated` auf brandbares `--sidebar-bg` umgestellt. (Schriftgröße bewusst später: px→rem-Refactor.)

**Phase 3 — Deployment Center: Linux-Client (Foundation, PRs #50/#51 → `c6f6f6b3`, hinter `DEPLOY_ENABLED` inert):**
- **Deploy-Kind-Abstraktion:** `vm-clone` (OPNsense/Proxmox-Template) vs. **`agent-install`** (Software auf bestehendem
  Host via Control-Adapter). Modul **`linux-client`** (Wazuh-Agent, `ssh-systemd`-Adapter, `existing-host`) mit
  injektionssicheren Param-Patterns.
- **`ssh-systemd`-Control-Adapter** (`installLinuxAgent`, sicherheitskritischer Kern): **auth-agnostisch** (SSH-Transport
  injiziert → kein Secret im Adapter), Injektion vor Ausführung abgelehnt, sichere ENV statt Shell-Cmd, fail-closed,
  kein Roh-/Secret-Leak. +11 Tests. **Noch nicht verdrahtet.**
- **docs:** `docs/01-architecture/deployment-capability-map.md` (Bauplan des Modulkatalogs, OSS+kommerziell,
  HAVE/DEPLOY/INTEGRATE).

**Infra/Ops (nicht Repo-Code):** pve-RAM **32→64 GB** eingebaut + verifiziert · Secrets **off-box gesichert+verifiziert**
(`…\BackupENVENC\2026-07-03_CT120-nexora\`) · tote Wazuh-Agents (InfluxDB/web-check) gelöscht · crowdsec `.100` aus.

**Offen — nächste Session (Reihenfolge):**
1. **Linux-Client fertigstellen:** (a) **echter SSH-Runner** (Transport ssh2/child_process — Host-Key, **Key-Herkunft via
   Connector, kein Inline-Secret** → eigener Security-Review) · (b) Orchestrator-Verdrahtung (`agent-install`-Pfad ruft
   Adapter, plan→approve→apply + Reauth + Gate) · (c) Frontend Ziel-Node-Auswahl. Plan: `memory/project_p_deploy_linux_client_plan.md`.
2. Danach weitere Deploy-Module (Windows-Client, Sensor, Korrelator/Data-Plane) + Lifecycle/Update-Mgmt.
3. **Reste:** DC/WC-Test-Restore · echte HA (QDevice) · Teil 3 (Wazuh `.env`→UI) · optional Settings-Tabs Hunting/Audit
   in ihre Bereiche · Font-Bundling (Inter/JetBrains woff2) falls „echte" Fonts gewünscht.

### 2026-07-03 (Nachtrag) — Security-Härtung: kategorisierte Verbindungstest-Fehler (Info-Disclosure, Follow-up #1)

> **Auf `p-phase0-close`, committet.** Behebt den HIGH-Fund aus dem Teil-2-Security-Review **repo-weit konsistent**
> (nicht isoliert — sonst Divergenz zwischen den Integrationen).

- **fix(security):** `/connection/test`-Endpunkte spiegelten den rohen `err.message` an den Client — der trug interne
  Netzwerk-Topologie (`ECONNREFUSED <IP:Port>`, DNS-/TLS-Details) oder fremde Server-Texte (OTRS `ErrorMessage`) nach
  außen (Info-Disclosure-Orakel, admin-only aber vermeidbar). Neuer geteilter `classifyConnError()`
  (`integrations/http/connErrorClassifier.js`) mappt jeden Fehler auf eine feste, whitelistete deutsche Kategorie
  (Auth · TLS/Zertifikat · DNS · Timeout · nicht erreichbar · Redirect-blockiert · generischer HTTP-Status). Der rohe
  `err.message` bleibt nur serverseitig (`logger.warn`). Angewandt auf **alle** Test-Pfade: ServiceNow · OTRS · QRadar ·
  CrowdSec · Qdrant (Route-Ebene) sowie IMAP + Wazuh (Tester-Ebene). Bewusst kalibriert: der HTTP-Status (z.B. 500) darf
  erscheinen (keine Topologie); ein Port wie `:443` wird nie als HTTP-Status fehlgedeutet (nur explizites `HTTP <nnn>`).
  Backend +10 Tests (Classifier-Suite) + angepasste Wazuh-Assertion; betroffene Suiten grün (8 Suiten / 97).
- **Offen (Backlog):** Follow-up #2 (OTRS/CrowdSec `http://`+Body-Creds nur intern/Warnung) · #3 (`testConnection`-
  Unit-Tests für qradar/crowdsec-Adapter).

### 2026-07-03 — ServiceNow + OTRS Outbound-Verbindungen UI-verwaltbar (Teil 2/3)

> **Auf `p-phase0-close`, committet — UNGEPUSHT/nicht deployt** (zusammen mit Teil 1 als ein Paket, auf Ansage).
> Schließt Teil 2 der Frontend-Administrierbarkeit. Scope aus Code-Investigation korrigiert (s.u.).

- **feat(settings) — Teil 2/3:** Die beiden **Outbound**-Ticket-Verbindungen **ServiceNow** und **OTRS/Znuny**
  (Ticket-Export) admin-seitig über **Settings → Integrationen** verwalten statt nur `.env`. Gleiches geprüftes
  Layer-2-Muster wie QRadar/CrowdSec/IMAP: Passwort AES-256-GCM in `platform_settings` (`integration_servicenow`
  /`integration_otrs`), DB > ENV (ENV Fail-safe), GET nur maskiert (nie das Passwort), `PUT` mit admin +
  Passwort-Step-up + Rate-Limit + Audit + SSRF-Deny-List, `POST /connection/test` als **read-only Probe ohne
  Speichern** (ServiceNow: Table-GET `sysparm_limit=1`; OTRS: `SessionCreate` — legt kein Ticket an). Der
  Singleton-Adapter wird über den neuen `externalTicketConnectionApplier` **sofort ohne Neustart** rekonfiguriert
  (Boot + nach jedem PUT). ServiceNow https-only, OTRS http/https (on-prem). Neue Routen `/api/v1/servicenow`
  + `/api/v1/otrs`, `ServicenowConnectionCard`/`OtrsConnectionCard` (via geteiltem `connectionCardKit`).
  Backend **+51 Tests**, Frontend **+21 Tests**, volle Backend-Suite grün (383 Suiten / 4370), tsc 0.
  Review 3× 🟢 (security ‖ typescript ‖ react), 0 CRITICAL/0 HIGH-Blocker.
- **Scope-Korrektur ggü. ursprünglichem Plan:** **Splunk** brauchte keine eigene Karte — es ist rein *inbound*
  (Alert→Ticket), sein „Verbindungs-Secret" ist das Inbound-Webhook-Secret aus **Teil 1**. **Wazuh (Teil 3)** hat
  bereits eine vollständige Verbindungskarte (`WazuhConnectionCard`, DB>ENV, Applier) — die `.env`→DB-Überführung
  aus dem Fresh-Install ist ein **Post-Deploy-UI-Schritt** (Werte einmal in der laufenden UI eintragen), kein Code.
- **Security-Follow-ups (repo-weit, bewusst nicht isoliert — sonst Inkonsistenz zu qradar/crowdsec/imap):**
  (1) `classifyConnError()`-Helper, damit `/connection/test` aller Integrationen kategorisierte statt roher
  Fehlermeldungen zurückgibt (Info-Disclosure-Härtung — HIGH-Review-Fund, betrifft das gesamte Bestandsmuster).
  (2) OTRS/CrowdSec `http://` mit Body-Creds nur für interne (RFC-1918) Hosts erlauben oder Klartext-Warnhinweis.
  (3) `testConnection`-Unit-Tests auch für qradar/crowdsec nachziehen.

### 2026-07-02 (NACHT) — Wazuh an frische Nexora angebunden + Inbound-Webhook-Secrets UI (Teil 1/3)

> **Betrieb:** Die frisch installierte Nexora (CT 120 @ 10.0.10.75) wurde **vollständig an das migrierte
> Wazuh (10.0.10.77) angebunden — nicht-disruptiv** (Wazuh-Dashboard unangetastet): Alert→Ticket-Webhook
> live (echte Tickets, u.a. Honeypot-Brute-Force), API-Enrichment (15 Agents), Indexer/Dashboard (789k Alerts,
> dedizierter read-only User `nexora`). Webhook-Secret + API-Creds waren lokal auf dem Wazuh recoverbar
> (Integrations-Script bzw. Dashboard-Config) — kein Backup-Extrakt nötig.

- **feat(settings) — Teil 1/3 (committet `e9a49a77`, UNGEPUSHT/nicht deployt):** Inbound-Webhook-Secrets
  (Alert→Ticket-HMAC) admin-seitig über **Settings → Integrationen** verwalten statt nur `.env`. Je Quelle
  (wazuh/qradar/splunk/dataplane/generic) AES-256-GCM in `platform_settings`, DB > ENV mit generic-Fallback;
  der Webhook-Handler löst pro Request auf → **Rotation greift sofort ohne Neustart**. GET/PUT
  `/settings/webhook-secrets` (admin + Audit, nie ein Secret-Wert), `WebhookSecretsCard` (setzen/rotieren/
  generieren/löschen). Behebt die Frontend-Administrierbarkeits-Lücke, die die Wazuh-Anbindung per SSH/`.env`
  erzwang. Backend +40 / Frontend +3 Tests, volle Suiten grün (4319 / 1656), tsc 0.
- **Offen (nächste Session):** Teil 2 = Splunk/ServiceNow/OTRS-Verbindungskarten (ENV-only → UI); Teil 3 =
  Wazuh-Verbindung vom `.env`-Shortcut in die DB/UI-Karte überführen. Handoff in Memory `feedback_frontend_administrability`.

### 2026-07-02 (ABEND) — 1-Befehl-Fresh-Install (Proxmox-Host-Helper) + Install-Fixes

> **Auf `main` ([PR #39](https://github.com/cerberus8484/Nexora-Control-Plane/pull/39) → `6630c8e1`) und live end-to-end bewiesen** auf dem neuen Cluster.

- **feat(deploy):** `deploy/proxmox-helper/nexora-ct-install.sh` — im Stil der Proxmox-VE-Helper-Scripts:
  ein Befehl auf der PVE-Host-Shell legt automatisch einen Debian-LXC an (unprivilegiert +
  nesting/keyctl/fuse, Docker via `fuse-overlayfs` auf ZFS-rootfs), installiert Docker, klont das Repo
  und fährt `install-prod-fresh.sh` durch — am Ende läuft Nexora. Privates Repo via Read-Only-Deploy-Key
  (empfohlen) oder `GH_TOKEN`, beides via stdin (nie in `ps`/Log). Alles über ENV überschreibbar.
  **Live:** CT 120 `nexora-soc` @ 10.0.10.75 auf `pve` (192.168.0.101), 53/53 Migrationen, Smoke 12/12 grün, UI 200.
- **fix(deploy):** Vier Fresh-Install-Lücken, die die Reproduzierbarkeits-Probe aufdeckte:
  `get.docker.com` statt `apt install docker-compose-plugin` (nicht in Debian/Ubuntu-Basis-Repos;
  Helper + `proxmox-vm-bootstrap.sh`) · `deploy/*.sh` auf `100755` (waren ohne +x committet) ·
  `gen-env-production.sh` SIGPIPE-Abbruch unter `pipefail` gefixt · `smoke-test.sh` prüft
  `/api/v1/hosts/manual` statt `/api/v1/hosts` (der hosts-Router hat bewusst keine bare `GET /`).

### 2026-07-02 (NACHTRAG) — IMAP-Postfach UI-verwaltbar + Deploy-Härtung + DRY-Refactor + Doku-Drift

> **6 Commits auf `p-phase0-close`, gepusht nach origin (nicht deployt — Deploy separat auf Ansage).**
> Schließt den letzten offenen Layer-2-Baustein (IMAP-Hot-Reload), zwei Deploy-Center-Härtungen aus dem
> Backlog, einen DRY-Refactor der Verbindungs-Karten und Doku-Drift-To-dos.

- **feat(imap):** IMAP-Postfach-Verbindung (Host/Port/User/Passwort/TLS des SOC-Phishing-Postfachs) admin-seitig
  über **Settings → Integrationen** verwaltbar statt nur `.env`. Gleiches geprüftes Muster wie die 6 anderen
  Integrationen: Passwort AES-256-GCM in `platform_settings`, DB > ENV (ENV Fail-safe), GET nur maskiert,
  admin + Passwort-Step-up + Rate-Limit + Audit, Verbindungstest (bounded 4s-Timeout) ohne Speichern.
  **Poller hot-reload:** kein Boot-ENV-Gate mehr — der `ImapPoller` löst die Verbindung pro Zyklus DB > ENV auf
  (unkonfiguriert → self-skip ohne Netzwerk), eine UI-Änderung greift beim nächsten Poll-Zyklus ohne Neustart
  (CrowdSec-Muster). Email-Processor jetzt immer registriert (nicht mehr `IMAP_HOST`-gegatet).
  **SSRF-Härtung:** neue geteilte host-basierte Deny-List `isBlockedSsrfHost` (Single Source of Truth in
  `internalUrlAllowlist`; `isBlockedSsrfUrl` delegiert nun daran) blockt Loopback/Link-local/Metadaten/localhost —
  behebt einen MEDIUM-Review-Fund (rohes TCP, `/test` ohne Step-up). Backend +48 / Frontend +12 Tests,
  volle Suiten grün (Backend 4279 · Frontend 1650), tsc 0. Security- + TS-Review je 🟢, 0 CRITICAL/0 HIGH.
- **fix(deploy):** Zwei Härtungen aus dem Deploy-Center-Backlog. (1) **`failureReason`-Redaktion** — roher
  Node-/Proxmox-Fehlertext floss via `run.toJSON()` an den Client; neues `_redact()` scrubbt Secret-Muster
  (Proxmox-Token, Auth-Header, `key=value`, URL-Credentials, lange Hex/Base64) an allen Client-/Audit-/DB-Grenzen
  (roher Text nur noch im internen Server-Log). (2) **TOCTOU→409** — verliert ein Apply das Single-Flight-Rennen,
  wirft der Repo-Backstop `ACTIVE_RUN_CONFLICT` als plain Error (→ vorher 500); `DeployService.apply` mappt das
  jetzt sauber auf 409. +2 Tests, Deploy-Suite 166 grün.
- **refactor(settings):** Die vier Single-Section-Verbindungs-Karten (CrowdSec/QRadar/Qdrant/IMAP) auf einen
  gemeinsamen `useConnectionCard`-Hook + `ConnectionCardShell` (neu `connectionCardKit.tsx`) umgestellt — vorher
  war State/Race-Guard/Save-Flow/Shell 1:1 dupliziert (Rule-of-Three, TS-Review-LOW). Jede Karte ~185 → ~75 Zeilen,
  Verhalten unverändert. Wazuh (2 Sektionen) + TI-Keys bewusst nicht migriert. Neuer Component-Test für die
  geteilte Shell. Frontend-Suite 1653 grün (+3), tsc 0.
- **docs(env):** `.env.example` um nachweislich gelesene, bislang undokumentierte Schalter ergänzt
  (`QRADAR_BASE_URL`/`QRADAR_TOKEN`/`QRADAR_HOST`/`QRADAR_TLS_REJECT_UNAUTHORIZED`,
  `HUNT_RESPONSE_AUTO_EXECUTE_MOCK`, `CONFIG_APPLY_ENABLED`, `WAZUH_FP_APPLY_ENABLED`).

### 2026-07-02 (TAGESABSCHLUSS) — Layer 2 komplett: alle Integrationen/Secrets UI-verwaltbar

> **Session-Ergebnis:** 2 PRs (#36, #37) + 8 Commits, **alle auf `main` gemergt und live auf nexora**
> (Server-HEAD `56e1d4be`, 2 Deploys je mit verschlüsseltem DB-Backup + Health `db:ok`, alle CI-Gates grün).
>
> **Umgesetzt (⭐ Frontend-Administrierbarkeit):** Fünf ENV-only-Blöcke wurden admin-seitig UI-verwaltbar,
> nach einem einheitlichen, je einzeln security-review-geprüften Muster (Secrets AES-256-GCM in
> `platform_settings`, DB > ENV, ENV bleibt Fail-safe-Fallback, sofort wirksam ohne Neustart, GET nie im Klartext,
> admin + Passwort-Step-up + Rate-Limit + Audit + SSRF-Schutz, Verbindungstest ohne Speichern):
> **Wazuh-Verbindung** (API + Indexer) · **Threat-Intel-Keys** (VirusTotal/AbuseIPDB) ·
> **Outbound-Benachrichtigungen** (SMTP + Webhooks + Master-Schalter) · **QRadar-Verbindung** ·
> **Qdrant-Verbindung** (RAG). Kein Migrations-Bedarf (`platform_settings` selbst-anlegend).
>
> **Behavioral-Backlog:** **MFA-Admin-Reset** (`POST /mfa/admin/reset`, admin + Step-up + Audit, nicht hinter
> MFA_ENABLED-Gate) schließt den MFA-Lock-in (Bug #1); #2/#3 waren via PR #21 bereits erledigt (verifiziert).
>
> **CrowdSec** als Boot-Poller **hot-reloadbar** gemacht: Poller + Processor immer instanziiert, Config **pro
> Poll-Zyklus aus DB > ENV** aufgelöst (self-skip wenn unkonfiguriert) → UI-Änderung greift ohne Neustart.
> Muster jetzt Vorlage für IMAP-Hot-Reload. Damit sind **alle Integrationen/Secrets UI-verwaltbar**.
>
> **Zwei CI-only-Bugs gefunden + gefixt** (lokal grün, CI rot): Test-Isolations-Leak über den InMemory-
> Settings-Singleton (Real-Send-Timeout) → hermetische afterAll-Cleanups; QRadar-Verbindungstest 10s-Hang
> gegen nicht-routbaren Host → 3s bounded Timeout. **Lehre: `jest --runInBand` (CI) deckt State-Leaks +
> Real-Network-Hangs auf, die Sharding/schnelles Lab-Netz lokal maskieren.**
>
> **Doku:** `docs/03-admin-guide/env-schalter-inventar.md` (3-Klassen-Einteilung + Konvention für neue UI-Schalter).
> **Offen (niedrige Prio):** Tuning-Werte/Feature-Flags UI-toggelbar · IMAP-Hot-Reload · Doku-Drift-Pflege.

### 2026-07-01 (TAGESABSCHLUSS) — Session-Ergebnis + ⭐ TO-DO NÄCHSTE SESSION

> **Session-Ergebnis:** 6 PRs (#30–#35) gebaut, gemergt und **alle live auf nexora deployt**
> (Server-HEAD `83262f9e`, jeder Deploy mit verschlüsseltem DB-Backup + Health `db:ok`).
> Zusätzlich vorab: `main` (PR #28/#29) auf nexora ausgerollt (Migrationen 051+052).
>
> Inhalte: config-`deliver`-Kanal (inert) · Manual-Host-Quelle (Migr. 053) · Rate-Limit-Fix
> beim Ticket-Schließen · Analyse-Scoping (Analyst=eigene, Admin=alle) · Comm-Map First-Seen ·
> Nav-Umbau + Entschlankung (Kategorie-Übersichtsseiten, Settings solo) · Deploy-Modul-Kacheln ·
> Button-CTAs · **Administration → Services** (Wazuh-Manager-Restart) · **UI-Scharfschalten**
> (Passwort-Step-up, kein SSH/.env mehr) · ehrliche API-Fehler (FP 422 → echter Grund) ·
> „Alle gefilterten auswählen"-Fix (`GET /tickets/ids`).
>
> **Neue Projekt-Regel (Memory):** Frontend-Administrierbarkeit — jede Backend-Admin-Fähigkeit
> muss aus dem Frontend bedienbar sein; DoD = Backend + Tests + Frontend-Admin.
> **Operativ:** alle Prod-`.env` off-repo gesichert (`../nexora-env-backup-20260701-212940`).

#### ⭐ Offen / To-do — Nächste Session (priorisiert)

**P1 — Frontend-Administrierbarkeit fortsetzen:**
- [ ] **Layer 2:** Wazuh-**Verbindung** (URL + Admin-User/Passwort bzw. API-Key) verschlüsselt in der
      UI verwalten („Verbindung testen", `secretsCrypto`-Muster wie Deploy-Connectors) — ersetzt die
      `.env`-Creds additiv mit Fallback. Berührt den Kern-Wazuh-Client → eigener fokussierter Build.
- [ ] **ENV-Schalter-Sweep:** alle ENV-only-Admin-Schalter inventarisieren → welche werden UI-toggelbar
      (Muster: Arm-Flow), welche bleiben bewusst ENV-only (Kill-Switches) + ehrliche UI-Anzeige.

**Deploy Center — vor Go-Live:**
- [ ] Live-Smoke auf Lab-Proxmox (Golden-Template + First-Boot-Importer + API-Token + VLAN-Bridge);
      erst danach `DEPLOY_ENABLED` + `DEPLOY_DELIVER_CHANNEL=first-boot-drive` setzen.
- [ ] Härtungs-Backlog („not now"): TOCTOU-Txn · `failureReason`-Redaktion.

**Kleinkram / LOW (aus Reviews):**
- [ ] `wazuh.js` `restartActor` liest `req.user.id` statt `.sub` (Audit-Attribution, pre-existing).
- [ ] `express.json`-Body-Limit global verifizieren (LOW-Review-Fund).
- [ ] Host-Enrollment: Live-Smoke gegen echten Wazuh-Manager · Enrollment-Rate-Limit · Clipboard-UX.
- [ ] Env-Backup-Ordner (`../nexora-env-backup-…`) nach Layer 2 sichern/löschen (liegt im Klartext).

**Projekt-Backlog (unverändert offen):**
- [ ] P19c/d (lokales KI-Modell + kontinuierliches Lernen) · KI-Settings W2 · E2E (Playwright) ausbauen.
- [ ] MITRE-Coverage ausweiten · UseCase-Developer (Stub→echt) · ML-Routing scharf (Prod-Gold ≥20).

> ℹ Im Working Tree liegen uncommittete **mkdocs-Doku-Dateien einer anderen Session**
> (docs/index.md, mkdocs.yml, DokuBilder/ …) — bewusst nicht angefasst, gehören der anderen Session.

### 2026-07-01 (Fortsetzung 10) — „Alle gefilterten auswählen" repariert (Validation failed)

> Der Button „Alle N (gefiltert) auswählen" auf der Tickets-Seite warf immer „Validation failed":
> das Frontend holte die IDs mit `limit=5000`, die Ticket-Liste erlaubt serverseitig aber nur `limit≤500`.

#### Fixed
- **Neuer schlanker Endpunkt `GET /api/v1/tickets/ids`** — nur die IDs der gefilterten Tickets,
  `limit` bis 5000 (== `SELECT_ALL_LIMIT`), gedeckelt. Nutzt **exakt dieselbe Filterung wie die Liste**
  (`ticketService.findIds` → `repo.findAll`, keine Divergenz), gibt aber nur `{ ids, total }` zurück
  statt voller Ticket-Objekte (effizient). Vor `/:id` registriert.
- **Frontend:** `selectAllFiltered` nutzt jetzt `ticketApi.listIds` (statt der auf 500 gedeckelten Liste)
  → „Alle auswählen" funktioniert wieder. Backend 40 + Frontend 151 Tests grün.

### 2026-07-01 (Fortsetzung 9) — Ehrliche API-Fehler (FP „HTTP 422" → echter Grund)

> Beim FP-„Regel erstellen" zeigte die UI nur „HTTP 422", obwohl der Server die echte
> Begründung mitschickte (Guardrail: agent-scoped Ausnahme ohne verifizierbaren Selector →
> würde die Eltern-Regel global abschalten → korrekt blockiert). Die Meldung ging verloren.

#### Fixed
- **`ApiError` trägt jetzt `errors[]`** aus dem Antwort-Body; der `apiClient` reicht sie beim
  Werfen durch (vorher nur `message`/„HTTP 422"). Neuer pure Helper **`apiErrorText`** (6 Tests)
  bevorzugt die strukturierten `errors` vor der Message.
- **FP-Fehler zeigen den echten Grund:** `quickFp` (Analyse-Deck) und die vier Handler im
  `WazuhExceptionBuilderModal` (Weiterleiten/Apply/Restart/Revert) nutzen `apiErrorText`. Bei
  Validierungs-/Guardrail-Fehlern (4xx) führt der Quick-FP jetzt zusätzlich in den Editor mit dem
  Hinweis, einen Selector (Hostname/IP) zu ergänzen — statt einer Sackgasse „HTTP 422".

### 2026-07-01 (Fortsetzung 8) — Wazuh-Restart aus der UI scharfschalten (Frontend-Administrierbarkeit)

> Grundsatz: jede Backend-Admin-Fähigkeit muss aus dem Frontend administrierbar sein — kein
> SSH/`.env`-only. Erster Fall: der Wazuh-Restart-Gate war nur per ENV setzbar.

#### Neu (Added)
- **Restart per UI scharfschalten (admin, Passwort-Step-up):** `POST /services/wazuh-manager/arm`
  (verifiziert das Passwort des aufrufenden Admins gegen den eigenen Hash, fail-closed, auditiert
  `WAZUH_MANAGER_RESTART_ARMED`; Fehlversuch → 403 + `..._ARM_DENIED`, eigener Rate-Limiter) und
  `.../disarm`. Der Restart-Gate akzeptiert jetzt **ENV *oder* DB-Flag** (`isWazuhRestartArmed`,
  fail-closed) — `WAZUH_MANAGER_RESTART_ENABLED` bleibt als Break-Glass-Fallback.
- **Services-Kachel:** „Restart scharfschalten" → Passwort-Bestätigen-Dialog → aktiv; Badge zeigt
  Zustand + Quelle (UI vs ENV) ehrlich; „Entschärfen" nur bei UI-Scharfschaltung. Ist die Wazuh-API
  nicht konfiguriert, bleibt Restart deaktiviert (mit Grund) auch wenn scharf — kein Fake-Erfolg.
- Kein SSH/`.env` mehr nötig, um den Restart freizugeben. Pure Logik getestet (Backend 47, Frontend 38).

### 2026-07-01 (Fortsetzung 7) — Services-Control-Seite (Wazuh-Manager-Restart)

> Nutzer-Pain: FP-Regel geschrieben+validiert, Status `restart_required`, aber kein UI-Weg,
> den Wazuh-Manager neu zu starten. Der gegatete/auditierte Restart-Endpunkt existierte —
> nur ohne Oberfläche außerhalb des FP-Modals.

#### Neu (Added) — Administration → Services
- **`GET /api/v1/services`** (admin) — kleine Service-Registry mit ehrlichen Capability-Flags
  (pure `serviceControlCatalog`, 6 Tests + 7 Route-Tests). Kein Restart-Code hier.
- **`ServicesPage` (`/services`, admin-only)** — Kachel je verwalteter Dienst; erster Eintrag
  **Wazuh Manager** mit **Restart** über den bestehenden Endpunkt (`POST /wazuh/manager/restart`,
  kein Duplikat). **Ehrlich gegated:** ist `WAZUH_MANAGER_RESTART_ENABLED` aus oder die Wazuh-API
  nicht konfiguriert, ist der Button deaktiviert mit klarem Grund. **Bestätigungsdialog** vorher;
  Config wird serverseitig vor dem Restart validiert; kein Fake-Erfolg (nur `confirmed` = Erfolg).
  Erscheint automatisch als Kachel auf der Administration-Übersicht. Pure `restartFeedback` (10 Tests).
- **Operator:** `WAZUH_MANAGER_RESTART_ENABLED=true` setzen, damit der Restart aktiv ist.

### 2026-07-01 (Fortsetzung 5) — Bug-Sammelauftrag Teil 2: Navigation · Deploy-Kacheln · Buttons

> 2 parallele Agenten (Nav ‖ Deploy-Kacheln, disjunkte Dateien) + Lead (Buttons).
> Verifikation projektweit: tsc exit 0; Vitest 607 grün (layout/deploy/analysis/settings).

#### Changed — Navigation (#5)
- Kategorie-Gruppen sind jetzt **anklickbare Übersichtsseiten** mit Kachel-Grid ihrer Unterseiten:
  **Hunting** `/hunting`, **Detection** `/detection`, **Integrations** `/integrations`,
  **Monitoring** `/monitoring`, **Administration** `/administration` (eine generische, DRY
  `CategoryLandingPage`; Kachel-Beschreibung aus `BREADCRUMB`, rollen-gefiltert). Der Sidebar-
  Gruppen-Header wird ein klickbarer `NavLink` zur jeweiligen Übersicht. **Settings** ist jetzt
  ein **eigenständiger** Top-Level-Eintrag (raus aus Administration). Dashboard/Operations/
  Compliance/Account unverändert. `/collectors` bleibt die Integrations-Collectors-Unterseite
  (kein Pfad-Konflikt). +10 navConfig-Tests (18/18).

#### Changed — Deployment Center Modul-Auswahl (#6)
- Die flache Modul-Liste ist durch ein **gruppiertes, quadratisches Kachel-Grid** ersetzt
  (Gruppe „Firewalls"). **Nur OPNsense ist aktiv** (an den bestehenden Plan→Approve→Apply-Flow
  verdrahtet); pfSense/Sophos/Fortinet/IPFire erscheinen als Kacheln, aber ehrlich **„Geplant"**
  (deaktiviert) — Verfügbarkeit aus dem echten Backend-Modul-Katalog abgeleitet, nichts
  Unimplementiertes wirkt deploybar. Eigene **Marken-Approximations-Icons** (keine Original-Logos;
  Platz für echte Logo-SVGs vorbereitet). Pure `deployModuleTiles` + 8 Tests (deploy 30 grün).

#### Changed — Buttons visuell hervorgehoben (#7)
- Der `primary`-Button ist jetzt ein klarer CTA: leichter Auftrieb-Schatten, Hover-Glow,
  sichtbarer Fokusring (`:focus-visible`); `success` analog. Flache „Speichern"-Buttons, die bis
  zum Speichern als `ghost` (fast unsichtbar) rendern, sind auf **`primary`** umgestellt (Saved =
  grün): KI-Einstellungen, OIDC, 3× SettingsPage. Nur Farben aus CSS-Variablen.

### 2026-07-01 (Fortsetzung 4) — Bug-Sammelauftrag Teil 1: Ticket-/Analyse-Fixes

> Nutzer-Diktat (7 Punkte). Bugs 1–4 zuerst; 4 parallele Explore-Agents (Details:
> `docs/agent-runs/AGENT-LOG.md`). Nav/Deploy-Kacheln/Buttons folgen.

#### Fixed
- **Rate-Limit beim Ticket-Schließen (#1):** Der globale Per-IP-Limiter (200/min) blockierte
  Analysten, die mehrere Tickets in Folge schließen („Too many requests"), weil jeder Close
  PUT + Listen-Reload auslöst und der Deck-Wechsel nachlädt. Neuer pure Skip
  (`middleware/globalRateLimitSkip.js`) nimmt den auth-gated Ticket-Triage-Hot-Path
  (`GET /tickets`, `PUT /tickets/:id`) aus dem globalen Topf — Login/Create/Delete/Bulk/Export
  bleiben limitiert. Behebt auch das Massen-Schließen. (9 Tests)
- **Analyse-Seite zeigte fremde Tickets (#2):** Die Analyse-Workbench lud alle Tickets ungefiltert.
  Jetzt seitenspezifisch auf die **eigenen zugewiesenen** Tickets gescopt (`AnalysisPage` +
  `ActiveTicketSwitcher` via getestetem `myTickets`-Match auf Anzeigename/E-Mail); ohne Zuweisung
  bleibt das Deck ehrlich leer. Kein globales Backend-Lockdown (Triage-Queue der Tickets-Seite
  bleibt unberührt).
- **Communication Map „First Seen" fehlte (#3):** Bei Traffic mit Bytes aber ohne Flow-/Timeline-
  Fenster blieb das Zeitfenster „—". `deriveTrafficBreakdown` fällt jetzt ehrlich auf die
  Detektionszeit zurück (realer Beobachtungszeitpunkt); Top Conversations bekommt eine
  „First Seen"-Spalte, `deriveConversations` verfolgt `firstSeen`. (+4 Tests, kein Fake-Datum)

#### Bereits vorhanden (verifiziert)
- **Ticket-Mehrfachauswahl (#4):** Select-all + Zeilen-Checkboxen + Bulk-Schließen/-Löschen +
  Rechtsklick-Menü existieren schon (`9af25d16`). Kein neuer Code; #1 entfernt die Rate-Limit-Bremse.

### 2026-07-01 (Fortsetzung 3) — Manual-Host-Quelle (Nicht-Wazuh-Assets, TDD)

> Der Source-Filter der HostsPage hatte „Manual/Splunk/QRadar/SOAR" nur als disabled-Optionen.
> Die **Manual-Quelle** ist jetzt echt gebaut (Splunk/QRadar/SOAR bleiben deferred bis echte
> Integrationen existieren — bewusst YAGNI).

#### Neu (Added) — Manual-Host-Quelle
- **Backend:** `ManualHost`-Domäne + Joi-Schema + Repo (InMemory **und** Postgres) + Factory +
  `ManualHostService` (auditiert) + Migration **053** (`manual_hosts`). Routen unter `/api/v1/hosts`:
  `GET /manual` (viewer+), `POST /manual` + `DELETE /manual/:id` (admin, validiert, auditiert —
  `MANUAL_HOST_ADDED/REMOVED`). Vor `/:agentId` registriert (sonst Pfad-Kollision). **20 Tests grün.**
- **Frontend:** manuelle Assets werden in die HostsPage gemerged, der **„Manual"-Filter ist aktiv**.
  Ehrliche Darstellung: kein Heartbeat/Inventory → neuer Status **`unmonitored`** (kein Fake-„Online"),
  Inventory „missing", kein Risk-Score; KPI „Online" zählt unmonitored nicht mit; Wazuh-Detail-Calls
  werden für manuelle Hosts übersprungen. „Add Host"-Modal um Tab **„Manuelles Asset"** erweitert
  (hostname/IPs/OS/Kunde/Notizen), Admin-Löschbutton im Detail. Pures Mapping-Modul getestet
  (**64 Hosts-Tests grün**, tsc sauber).
- **Deferred (YAGNI):** Splunk/QRadar/SOAR als Host-Quelle — brauchen echte Integrationen, bleiben
  als disabled-Optionen sichtbar.

### 2026-07-01 (Fortsetzung 2) — Prod-Deploy live · config-`deliver`-Kanal implementiert

> **Session-Ergebnis:** `main` (`7ba289ae`) auf **nexora** ausgerollt (`release.sh`, FF, verschlüsseltes
> DB-Backup vorher) — **Deploy Center + Host-Enrollment sind jetzt live auf Prod** (inert:
> `DEPLOY_ENABLED` bleibt AUS). Danach den fehlenden **config-`deliver`-Kanal** per TDD gebaut.

#### Deploy (Prod)
- **nexora** von `aef0e303` → `7ba289ae`: Migrationen **051 + 052** beim Boot angewandt (15:20:43),
  Deploy-Center-Tabellen live, Routen `/api/v1/deploy/*` + `/api/v1/hosts/*` antworten `401` (auth-guarded),
  Health `db:ok`. Deploy Center bleibt **inert** (`DEPLOY_ENABLED` unset) — nur Read/Plan, kein Apply.

#### Neu (Added) — config-`deliver`-Kanal (First-Boot-Drive, TDD)
- **`DEPLOY_DELIVER_CHANNEL`** wählt den Gast-Zustellkanal; Default `none` bleibt **fail-safe** (config-Schritt
  wirft → kontrollierter Rollback, keine unkonfigurierte VM als „deployed").
- **`first-boot-drive`:** gerenderte `config.xml` → `opnsenseConfigMedia` (pure Verpackung, `/conf/config.xml`)
  → neue Connector-Vertrags-Op **`attachConfigMedia`** hängt sie als CD-ROM (`ide2=…,media=cdrom`) an die VM;
  der First-Boot-Importer im OPNsense-Golden-Template zieht sie beim Boot.
- Neue Module: `opnsenseConfigMedia`, `firstBootDriveDeliver`, `deliverChannelFactory` (ENV-Gate). Connector-Op
  in **InMemory** (voll) + **REST** (Proxmox upload+cdrom, mock-getestet — Materialisierung Live-Smoke später).
  Verdrahtet in `deployServiceFactory`. **19 Deploy-Suiten / 164 Tests grün.** ENV-Example + Runbook (Schritt 5)
  aktualisiert. **Offen:** Live-Smoke gegen echtes Proxmox + First-Boot-Importer im Golden-Template.

### 2026-07-01 (Fortsetzung) — Host-Enrollment gemergt · ⭐ TO-DO NÄCHSTE SESSION

> **Session-Ergebnis:** zwei Features komplett durch Build→Review→Merge — Deployment Center
> ([PR #28](https://github.com/cerberus8484/Nexora-Control-Plane/pull/28)) und Host-Enrollment
> ([PR #29](https://github.com/cerberus8484/Nexora-Control-Plane/pull/29), Merge-Commit `7ba289ae`).
> **Beide auf `main`, aber noch NICHT auf dem Prod-Server deployt.**

#### Neu (Added) — Host-Enrollment (PR #29)
- **Wazuh-Agent aus der UI registrieren:** `WazuhApiClient.addAgent({name,ip})` → `POST /agents` (create,
  non-destruktiv) liefert `{id,name,key}`; Route `POST /api/v1/hosts` (admin) + Joi-Schema (Name-Zeichensatz
  eng, IPv4); auditiert (`WAZUH_AGENT_ENROLLED`, **nie der Key**). Frontend: „Add Host"-Button (war disabled)
  aktiv, `AddHostModal` zeigt den Enrollment-Key **einmalig** + Install-Schritte. security-reviewed 🟢 Grün
  (0 CRITICAL/HIGH; MEDIUM „fehlendes Audit" sofort gefixt). Nur mit konfigurierter `WAZUH_API_*` wirksam.

#### ⭐ Offen / To-do — Nächste Session (priorisiert)

**P0 — Deployen + verifizieren (beide Features hängen ungenutzt auf `main`):**
- [x] `main` nach **nexora** ausgerollt (`release.sh`, DB-Backup vorher). Migrationen **051 + 052** beim Boot ✓.
- [x] Nach Deploy: Routen `/api/v1/deploy/*` + `/api/v1/hosts/*` = `401` (auth-guarded), Deploy-Tabellen live.
      *(UI-Sichtprüfung `/deploy` + „Add Host" im Browser bleibt für Operator.)*

**Deploy Center — vor Go-Live (`DEPLOY_ENABLED=true`):**
- [x] **config-`deliver`-Kanal** implementiert (`DEPLOY_DELIVER_CHANNEL=first-boot-drive`, TDD, 164 Tests grün).
      Default `none` weiter fail-safe. Offen: Live-Smoke + First-Boot-Importer im Golden-Template.
- [ ] **Live-Smoke** auf Lab-Proxmox nach `deployment-center-runbook.md`: Golden-Template + API-Token (minimal)
      + VLAN-Bridge; ENV `DEPLOY_ENABLED=true`, `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`, `SETTINGS_ENC_KEY`.
- [ ] Härtungs-Backlog (Reviewer „not now"): TOCTOU-Transaktion (SELECT FOR UPDATE um Gate→toApplying),
      `failureReason`-Redaktion. *Nur bei echtem Parallelitätsdruck kritisch.*

**Host-Enrollment — Rest:**
- [ ] Live-Smoke gegen echten Wazuh-Manager (`WAZUH_API_*` gesetzt) → echter Agent-Key.
- [ ] LOW: Enrollment-Rate-Limit (Defense-in-Depth) · Clipboard-Fehler-UX in non-HTTPS-Kontext.
- [x] **Source-Integrations-Filter — Manual-Quelle** erledigt (siehe Fortsetzung 3 oben). Offen: Splunk/
      QRadar/SOAR als Host-Quelle (deferred bis echte Integrationen; bleiben disabled-Optionen).

**Projekt-Backlog (ROADMAP, echte offene Punkte):**
- [ ] P19c/d (lokales KI-Modell + kontinuierliches Lernen) · KI-Settings W2 · E2E (Playwright) ausbauen.
- [ ] MITRE-Coverage ausweiten · UseCase-Developer (Stub→echt) · Outbox-`completed`-Retention.
- [ ] ML-Routing scharf: Prod-Gold-Records ≥20 + `ML_ROUTING_POLICY_PATH` (Operator; `ml-routing-policy-runbook.md`).

**⚠ Doku-Hinweis für Session-Start:** Mehrere „offene" Backlog-Notizen waren diese Session **stale**
(Frontend-Lücken PDF-Export/Ticket-Delete-UI/Dashboard-Detection-Sources sowie behavioral-Audit #2 QRadar-
Checkliste + #3 Dedup-restart-fest = **alle längst erledigt**). → `docs/00-overview/feature-status.md` + Code
sind die Wahrheit, nicht ältere Notizen/ROADMAP. Vor „ist X offen?" erst greppen/prüfen.

---

### 2026-07-01 — Deployment Center: Network as Code (vertikaler Schnitt #1, ADR-041) — inert

> Neuer, **infra-schreibender** Kanal: aus Nexora heraus eine vorkonfigurierte OPNsense-Appliance
> deklarativ als VM auf Proxmox deployen (IP/VLAN/DNS/Ressourcen). 7 TDD-Phasen, Backend + Frontend,
> alles hinter dem Kill-Switch **`DEPLOY_ENABLED` (default AUS)** — bleibt bis zur Operator-Freigabe
> vollständig inert. Wiederverwendet das bestehende Apply-Kanal-Muster (Draft→4-Augen→Reauth→Plan→
> Apply→Rollback→Audit). Design: `docs/adr/decisions.md` (ADR-041) +
> `docs/01-architecture/deployment-center-*.md`. Migration dieser Runde: **051** (Deploy-Datenmodell).

#### Neu (Added)
- **Domäne + Kataloge:** `DeploySpec` (immutabel, kanonischer **secret-freier** Spec-Hash) + `DeployRun`
  (fail-closed State-Machine planned→approved→applying→cloning→starting→configuring→verifying→deployed
  bzw. rolling_back→rolled_back→failed_safe_stop). Code-Allowlists `deployModuleCatalog` (OPNsense) +
  `hypervisorConnectorCatalog` (Proxmox-Vertrag). Migration `051` (6 Tabellen, Single-flight-/Replay-
  Indizes, append-only Trigger).
- **paramSchema-Validierung:** deklaratives Modul-Schema → Joi (IPv4/CIDR 0–32/VLAN 1–4094/DNS 1–3);
  Secrets (`adminPassword`) werden hart abgelehnt und aus dem Spec-Hash gestrippt.
- **Proxmox-Connector:** einheitlicher Vertrag; InMemory-Fake (Fehler-Injektion je Schritt, CI-Default)
  + echter REST-Client (PVEAPIToken-Header, Token nur transient, **SSRF-Allowlist** + Link-local/Metadata-deny).
- **Deploy-Orchestrator + Gates:** Lifecycle mit Rollback (`destroy`) und Safe-Stop (globale Sperre bei
  Rollback-Fehler); Gates (Kill-Switch→Safety-Lock→approved→Vier-Augen→Reauth→Single-flight→Replay);
  Repository-Pattern (InMemory + Postgres + Factory); `deploy_reauth`-Token (kein Session-Token).
- **OPNsense config.xml-Applier:** Renderer mit **XML-Escaping** aller dynamischen Werte (Injection-Schutz);
  Applier mit Retry/Idempotenz. Default-Zustellkanal ist **fail-safe** (wirft) → kein „deployed ohne Konfiguration".
- **Routen `/api/v1/deploy`** (admin-only): modules/connectors/specs, plan (Dry-Run), approve (Vier-Augen),
  apply (`X-Reauth-Token` + Gate). `config.deploy` + `validateEnv`-Fail-fast (Prod: `DEPLOY_ENABLED=true`
  ohne `DEPLOY_HYPERVISOR_ALLOWED_HOSTS` bootet nicht). `POST /auth/deploy-reauth`.
- **Frontend:** Admin-Seite **Deployment Center** (`/deploy`, Nav-Gruppe Integrations) — Connector anlegen,
  Plan→Approve→Apply mit Passwort-Reauth, ehrliche Disabled-Zustände + `DEPLOY_ENABLED`-Hinweis
  (`deployApi`/`deployView` als getestete reine Module).

#### Sicherheit
- Kill-Switch `DEPLOY_ENABLED` (default AUS) · Hypervisor-Token AES-256-GCM verschlüsselt (nie im
  Return/Log/Audit, nur `prefix`) · SSRF-Allowlist · XML-Escaping · Idempotenz per Spec-Hash · lückenloses
  Rollback + append-only Audit · admin-RBAC + frische Reauth vor jedem Apply.

#### Tests
- Backend-Gesamtsuite **340 Suiten / 3986 Tests grün**; Frontend **1531 Tests grün**, tsc clean.

#### Status
- **Review-gehärtet + [PR #28](https://github.com/cerberus8484/Nexora-Control-Plane/pull/28) gemergt nach `main`**
  (Merge-Commit `b43d61c8`). Parallel security- + code-review (0 CRITICAL); alle HIGH + beide Security-MEDIUM
  gefixt (SSRF host→IPv4 + Metadata-Blocklist, `/auth/deploy-reauth` admin+Rate-Limit + One-Shot-jti,
  `SETTINGS_ENC_KEY`-Pflicht, `err()`→AppError, `GET /deploy/audit`, Vier-Augen auf stabile User-ID (Migr 052),
  `statusPollTimeoutMs` verdrahtet). **Operator-Runbook** `docs/01-architecture/deployment-center-runbook.md`.
  UI live im Browser verifiziert (kein Token-Leak). Bleibt **inert** (`DEPLOY_ENABLED=false`).
- CI-Fix mitgemergt: vorbestehender auth-real-E2E-Rot (Forced-PW-Change) → E2E-Fixture-Opt-out
  `ADMIN_MUST_CHANGE_PASSWORD=false` (`bootstrapAdmin` liest das Flag; Default `true` unverändert).

### 2026-07-01 — Walkthrough-Backlog abgearbeitet (PR #21–#27, live auf nexora)

> Aus einem Live-Walkthrough der Nutzer-Oberfläche: konkrete, gegen den echten Prod-Zustand
> getracte Bugs/Lücken — gebaut (TDD), pro Welle reviewt, in 7 PRs deployt und verifiziert.
> Migrationen dieser Runde: **048** (`correlation_result_evidence(ticket_id)`-Index),
> **049** (`external_links`), **050** (`tickets.closed_at` + Backfill 17.628).

#### Neu (Added)
- **Host-Inventar-Ansicht (PR #21):** echte, durchsuchbare **Software-Liste** (paginiert) + Hardware/OS-Karte
  je Host (`GET /hosts/:id/packages`). Vorher zeigte die App nur die Paketanzahl, nie die Liste.
- **Honeypot-Session-Payloads W1 (PR #22, end-to-end live bewiesen):** Cowrie-Befehle/Logins/Downloads/Tunnel
  wurden bei der Normalisierung verworfen → Payloads leer. Jetzt Kette Collector-`activity` → EventEnvelopeV1 →
  Fusion `sessionActivity` → Ticket-`payloads` → neue Payloads-Sektion „Session-Aktivität / Honeypot-Befehle"
  (untrusted Input nur als Text, kein Passwort, Längen-Caps).
- **App-Map-Flow-Statistik W3 (PR #24, end-to-end live bewiesen):** Ticket-`network` trägt jetzt
  Pakete/Events/Firewall-Action/First-Last-Seen (aus conntrack + Fusion). Die Network/NAT-App-Map zeigt echte
  Werte statt „66 Bytes / 0 Events".
- **Integrations-&-Collectors-Übersicht (PR #25):** `/collectors` → konsolidierte Seite: Integrationen
  (konfiguriert/erreichbar + Wazuh-Verbindungstest), Live-Hub-Collectors (Health/Zähler), Ingest-Aktivität.
- **Wazuh-Manager-Restart aus Nexora (PR #21):** `POST /wazuh/manager/restart` via Wazuh-API (kein SSH) —
  admin + ENV-Gate `WAZUH_MANAGER_RESTART_ENABLED` (default AUS) + Config-Validierung + Audit.
- **Tickets-UX (PR #21):** „Meine Tickets"-Filter im Analyse-Switcher (W7), Erstell-Datum (T1), „Alle
  (gefiltert) auswählen" + gechunktes Löschen ≤100 (T3, entschärft den Bulk-Delete-Timeout), Smart-Header
  mit Kennzahlen (T5).
- **New-Hunt-Modal Ticket-Verknüpfung (PR #26):** durchsuchbares Dropdown offener Tickets + Follow-up-Prefill.
- **SOC-Metriken (PR #27):** Zeitraumfilter 7d/30d/90d/Alle (`?since=`) + Aktualisieren-Button.

#### Geändert / Behoben (Changed / Fixed)
- **Dedup restart-fest (PR #21):** `PostgresExternalLinkRepository` (Migr 049) + Splunk-Dedup DB-basiert →
  keine Doppel-Tickets/-Exports nach API-Neustart.
- **Dataplane Anti-Flut #3 (PR #21):** Fusion-Modus `attacker:v1:<srcIp>|<verdict>` ohne Zeit-Bucket
  (ENV `FUSION_ATTACKER_AGG`) → 1 Ticket je Angreifer-IP statt N; Verdikt-Upgrade bleibt. + Folge-Fix der
  alertCount-Regression (Wiederholungs-Zähler ≠ eventCount).
- **SOC-Metriken semantisch korrigiert (PR #27):** MTTR aus echtem `closed_at` (bei OPEN→CLOSED gesetzt,
  Migr 050 + Backfill) statt `updated_at` (das jeder Edit verfälschte); FP-Rate-Nenner nur klassifiziert
  geschlossene Tickets (`close_reason<>''`).
- **ThreatHunts (PR #26):** Race-Condition beim „Ticket erstellen" (erzeugte Ticket fürs *falsche* Finding)
  behoben; toter hartkodierter „Related(0)"-Tab + toter Pause-Button entfernt; Ticket-Toast klickbar.
- **Analyse-Deck (PR #21):** Host-Kontext im Deck-Header + Network/NAT (W2); QRadar-Investigation-Checkliste
  persistent je Offense (#2); QRadar/Hunts/UseCase/Dashboard **leer-vs-Fehler** ehrlich getrennt; `auth`
  refresh/restore 401-Trennung (kein stale-Logout bei Netz-/5xx-Fehler); `useHuntSession` Poll-Fehlerzähler.
- **DB-Härtung (PR #21/#27):** Index `correlation_result_evidence(ticket_id)` (Migr 048),
  `idx_tickets_closed_at` (Migr 050).
- **Silent-Failures sichtbar (PR #21/#27):** diverse verschluckte Fehler (AuthService-Cleanup, ApiToken,
  ThreatIntel-Cache, QRadar getStats, SOC-Metriken-Fehlertext) loggen/zeigen jetzt statt zu schlucken.
- **Evidence-Filter-Kontrast (PR #21, W5):** unselektierte Filter-Toggles sichtbar (waren weiß-auf-hell).

#### Sicherheit (Security)
- **Wazuh-Restart-Härtung (PR #21):** Response-Whitelist (keine rohe Wazuh-API-Antwort) + strenger
  Rate-Limiter (3/15 min). **phishingParser:** ungenutzter `authResults.raw` (PII) entfernt.
- Untrusted Honeypot-Befehle in der UI ausschließlich als React-escaped Text (kein `innerHTML`, URLs nicht klickbar).

#### Betrieb (Ops, kein Code)
- **Ticket-Flut bereinigt:** 2.660 offene `[observed]`-Rausch-Tickets reversibel geschlossen (state→CLOSED/benign).
- **Outbox-Dead-Letter:** 50.709 `emit_failed` (historisch, unter Last entstanden — Pipeline jetzt gesund)
  analysiert + gepurgt.
- **Aktiviert:** `FUSION_ATTACKER_AGG=true` + W1-Collector (collector-hub-Rebuild); MFA-Enrollment des Nutzers
  deaktiviert (Login nur Passwort).

#### Offen / To-do (Stand 2026-07-01)
- **Deploy-Center / Integrations-Management (GROSS, sicherheitssensibel):** Quellen aus der UI
  hinzufügen/konfigurieren/deployen — gated Apply-Kanal, RBAC, Audit. **Erst planen (Threat-Model + Slices),
  nicht blind bauen.** Vision: `project_control_plane_vision` / `deploy_page_vision`.
- **W3/OPNsense:** denied/permitted in der App-Map bleibt leer bis die OPNsense-Firewall-Quelle aktiv ist (pausiert).
- **SOC-Metriken #6/#7:** „Top-Rules" zeigt Wazuh-/QRadar-IDs statt Regel-Namen (braucht `rule_name`-Mapping);
  Aggregat-Queries via `EXPLAIN` auf Prod-Klon verifizieren (6 sequenzielle Queries; Index für MTTR schon dabei).
- **ThreatHunts #6/#9:** Legacy `HuntConsolePage` (`/threat-hunts/:id`) hat ein eigenes Mini-Modal +
  unvollständige Timeline → auf `NewHuntModal`/vollständige Ansicht konsolidieren.
- **UseCase-Developer:** nutzt den Stub-Provider (kein echtes LLM) — als Beispiel gekennzeichnet, Ausbau offen.
- **MITRE-Coverage:** kuratiertes ATT&CK-Subset, Ausweitung/Labeling offen.
- **Dataplane-Metrik durabel:** `/dataplane`-Fehlerzähler auf „letzte 24 h" statt All-Time umstellen
  (`gatherDbCounts`) — damit ein künftiger Dead-Letter-Rückstau nicht wieder alarmiert. Outbox-`completed`
  (197k) = Retention-Kandidat.
- **Generalprobe Fresh-Install** auf Linux+Docker-Host (`preflight-check.sh` + Installer) — braucht Hardware.
- **Wazuh-Restart-Button** ist deployt aber **default aus** (`WAZUH_MANAGER_RESTART_ENABLED`) — bei Bedarf scharf stellen.

### 2026-06-30

- **Fresh-Install- & Umzug-Toolchain (PR #12/#14/#15/#16):** durchgängig gescripteter Umzug auf
  einen neuen Proxmox-9-Host — `deploy/proxmox-vm-bootstrap.sh` (frische VM: Docker+Tools+Clone) →
  `gen-env-production.sh` (Secrets + policy-konformes Admin-Temp-PW) → `install-prod-fresh.sh`
  (Stack hoch, TLS, Migrationen, Admin) → `restore-db.sh` (verschlüsseltes Backup einspielen) →
  `nexora-intake/install-dataplane.sh` (Korrelator/Kollektoren-Scaffold). Runbook
  `docs/03-admin-guide/migration-old-to-new.md` (Secret-Kontinuität, Cutover, Rollback).
  `migrate()` trackt jetzt angewandte Migrationen (`schema_migrations`, jede genau 1×);
  `validateEnv` fängt CHANGE_ME-Platzhalter-Secrets; `.gitignore` schützt Prod-Secrets + SSH-Keys.
- **Erst-Login-Passwortzwang (PR #12/#13):** Bootstrap-Admin muss bei der Erstanmeldung sein
  temporäres Passwort wechseln (Migration 047 `must_change_password`) — **serverseitig erzwungen**
  in `requireAuth` (nicht nur Client-Gate).
- **Sicherheits-Audit + Fixes (PR #13, 5 Reviewer-Agenten):** serverseitiger Auth-Zwang, echte
  DB-Fehler im Korrelations-Adapter propagieren (statt stillem Job-Verlust), `AUDIT_IP_SALT`
  Prod-fail-fast, reale Lab-/VPS-IPs aus `.env.production.example` entfernt, fehlendes
  `WEBHOOK_SECRET_DATAPLANE` ergänzt, Decrypt-Fehler-Logging, Admin-Passwort-Entropie,
  restore-db-Container-Validierung, apiToken-Query gedeckelt.
- **UI-Seiten-Referenz (PR #12):** pro UI-Seite (29) eine Doku + Querverweis-Index unter
  `docs/02-user-guide/pages/` (Zweck · Funktionen · Datenquellen · Verknüpfungen · Zustände).
- **Data-Plane-UI + Hub↔Backend-Status-Brücke (PR #8/#9, LIVE):** Der Dataplane-Knoten meldet
  seinen Live-Status (Collector-Hub-Zustände + echte Intake-/Outbox-Zähler) per HMAC an
  `POST /dataplane/status` (Migration 046, upsert je nodeId, fail-honest: stale ≠ available);
  neue read-only Seite `/dataplane` (KPIs + pro-Knoten Collector-Tabelle + Pipeline-Zähler).
  `collectors/activity.liveProcessStatus` wird damit ehrlich `available=true` bei frischem
  Snapshot (schließt die zuvor als „geplant" markierte Brücke). Push-Job ENV-gated im
  `collectorHubMain` (default AUS), live aktiviert für `nexora-collector-hub-1`. Mitgeliefert:
  Security-Härtung — `verifyWebhookSignature` verlangt den echten Rohkörper fail-closed
  (kein stiller `JSON.stringify`-Fallback; betrifft auch `/incidents` + SIEM-Webhooks).
- **Honeypot-Sicherheit verifiziert + Breakout-Erkennung (ops/infra):** Online-Honeypot
  (Public VPS, Cowrie) live geprüft — Cowrie als unprivilegierter User, Firewall default-deny
  (IN/OUT/FORWARD), einziger Egress = Wazuh-Log-Pfad, **kein Breakout-Indikator** (keine
  injizierten Keys/Cron). Neu gehärtet: Wazuh-Agent Realtime-FIM auf `/root/.ssh`,
  `/home/cowrie/.ssh`, `/var/spool/cron`, `/etc/cron.d` + Cowrie-Home → ein injizierter
  SSH-Key oder Cron-Eintrag alarmiert jetzt **sofort** (Host-Breakout-Detektion).
- **Easy-Install / Forced-Password-Change (untersucht, Plan ready — noch kein Code):** Seed-Admin
  soll beim Erst-Login einen Passwortwechsel erzwingen. Die vorhandene `ForcedPasswordChange`-
  Komponente (heute nur Ablauf-getrieben über `passwordExpired`) wird wiederverwendet; 6-Schritte-
  TDD-Plan (Migration `users.must_change_password`, User-Domain, `ensureAdminUser`,
  `changePassword`, `/auth/me`-Serialisierung, Frontend-Gate) liegt im Session-Handoff.
- **Network as Code — Deployment-Center-Konzept (Doku, noch kein Code):** Architektur für
  deklaratives Provisioning vorkonfigurierter Open-Source-Systeme (Firewalls/SIEMs/IDS/Honeypots)
  als VM auf Proxmox/ESXi — parametrisiert (statische IP, VLAN, DNS, Ressourcen), modular
  (System-Modul × Hypervisor-Connector × Orchestrator), gegated/auditiert über den Apply-Kanal,
  erweiterbar per Modul. Doku-Set: `docs/01-architecture/network-as-code.html` (Übersicht),
  `deployment-center-architecture.md` (technischer Plan), `deployment-center-concept.md`
  (Gesamt-Konzept + Fresh-Install-Referenz). Erster geplanter Schnitt: OPNsense → Proxmox.
- **Navigation aufgeräumt + Rollen-Gating (PR #6):** Überfüllte `system`-Gruppe (10 Items)
  aufgeteilt in **Monitoring** (Hosts, SOC-Metriken, System&DB, Audit) + **Administration**
  (Correlators, KI Agent, ML-Eval, Autonomy, Provisioning, Settings); neue `visibleNavItems(role)`
  blendet Admin-Tools für Analysten/Viewer aus (verifiziert gegen Server-`requireRole`). Pfade/
  Breadcrumbs unverändert.
- **QRadar-Offense-Mapping behoben (PR #6):** Dashboard-Provider gab rohe snake_case-Felder
  zurück → Offense-Felder im Frontend leer sobald QRadar verbunden. `mapOffenseDto`/`mapEventDto`
  mappen auf camelCase; Roh-Fetch von Mapping getrennt (Stats unverändert).
- **Honeypot-Ticket-Flut gelöst (PR #3):** Suricata-Collector neue Option `eventTypes` (filtert
  reine flow-Telemetrie, nur Alerts) + observed-Ticket-Dedup nach `(srcIp,dstIp,category)` mit
  `alert_count`++ statt N Tickets. Quelle ~1000× reduziert, Deck-Altlast bereinigt.
- **Sicherheit/UX-Härtung:** `AUDIT_IP_SALT` als Pflicht-Secret mit Fail-fast (DSGVO Art. 25, PR #4);
  OIDC-Config an der API-Grenze gehärtet (verhindert SecurityTab-Crash, PR #5); ThreatHunts-Stop
  admin-gaten, DetectionLibrary-Button bei fehlender Wazuh-Verbindung disablen, KI-HITL-Badge
  dynamisch aus echtem Autonomy-Status, ProfilePage-Ladefehler sichtbar, MITRE-Subset- +
  UseCaseDev-Stub-Transparenz-Labels (PR #6/#7).
- **System-weiter Verdrahtungs-Audit (6 Agents):** Ergebnis — keine der ~27 Seiten ist Attrappe,
  keine der 35 Routen ein toter Stub; Dokumentation in `docs/agent-runs/AGENT-LOG.md`.

- **ML-Eval-Snapshot-Export als erster MLE-Schritt:** Neuer admin-gated Backend-Endpunkt
  `POST /api/v1/ml/eval/export` erzeugt bounded, redigierte Eval-Snapshots nach
  `ml-eval-schema v1` als JSONL oder JSON-Preview. Quellen: reviewed
  `AgentSuggestion` und geschlossene Tickets; Proposal/Rationale/Ticket-Freitexte
  bleiben draussen. Export wird auditiert (`ML_EVAL_EXPORT`). Zusaetzlich erzeugt
  `npm run ml:eval-report -- <snapshot.jsonl>` Offline-Slice-Reports und eine
  Raw-Verdict-vs-Human-Label-Matrix; vergleichbare Outcome-Labels erhalten einen
  vorsichtigen Agreement-Block (`fp` normalisiert zu `false_positive`, Review-Labels
  werden uebersprungen). Gold-Samples sind als `label_source=gold_review` strenger
  validiert (Outcome-Label, outcome-faehiges Raw-Verdict, `reviewed_at`, redigierter
  Grund) und separat ausgewiesen. Ein Threshold-Sweep (`0`, `0.5`, `0.7`, `0.9`)
  zeigt Coverage, akzeptierte Predictions und Review-Routing fuer Outcome-faehige
  Records. Ein fail-closed Routing-Gate (`minAgreement`, `minCoverage`,
  `minGoldRecords`, default 20 Gold-Records) verhindert voreilige Threshold-Empfehlungen.
  Bei Gate-Fail liefert die CLI bewusst Exit-Code `1`. Export-Snapshots tragen jetzt
  ausserdem reproduzierbare Metadaten (`generatedAt`, `recordSha256`,
  Label-/Human-Label-Counts) und liefern die Dataset-Signatur bei JSONL auch per Header.
  Neu dazu kommt `npm run ml:dataset-pack`, das aus einem Snapshot ein referenzierbares
  Artefakt-Bundle (`snapshot.jsonl`, `manifest.json`, `report.json`, `report.md`) baut.
  Darauf aufbauend erzeugt `npm run ml:dataset-split` deterministische
  `train/validation/test`-Splits plus `split-manifest.json` fuer reproduzierbare
  Baselines und spaetere Trainingsruns. Zu kleine Datasets werden im Split-Manifest
  explizit als Warnfall markiert (`validation_split_empty`, `test_split_empty`).
  Neu dazu kommt `npm run ml:run-init`, das aus Dataset- und Split-Manifest ein
  `baseline-run.json` mit Status `ready|blocked` und expliziten Blockern erzeugt.
  Neu dazu kommt `npm run ml:run-eval`, das ein `baseline-eval.json/.md` schreibt und
  blockierte Runs bewusst ohne Schein-Metriken dokumentiert. Neu dazu kommt
  `npm run ml:readiness`, das fehlende Gold-Records und Split-Luecken als konkreten
  Gap-Report ausgibt. Neu dazu kommt `npm run ml:gold-merge`, das neue kuratierte
  Gold-JSONL-Dateien validiert, dedupliziert und sortiert zusammenfuehrt.
  Neu dazu kommt `npm run ml:gold-pipeline`, das den kompletten MLE-Artefaktpfad fuer
  einen Gold-Bestand in einem Lauf neu erzeugt. Neu dazu kommt `npm run ml:run-compare`,
  das auf einem `ready`-Artefakt mehrere Thresholds gegen Validation/Test vergleicht und
  eine Empfehlung schreibt. Neu dazu kommt `npm run ml:run-policy-compare`, das
  unterschiedliche Empfehlungs-Policies auf demselben Artefakt gegeneinander haelt.
  Neu dazu kommt `npm run ml:policy-export`, das aus `policy-comparison.json` +
  `baseline-run.json` ein **deploybares Routing-Policy-Artefakt**
  (`recommended-routing-policy.json` + `.md`, Schema `nexora.ml.routing-policy.v1`)
  erzeugt: genau eine gewaehlte Policy (Default `conservative_review_bias` —
  im Zweifel Review), ein Akzeptanz-Threshold, vollstaendige Provenance
  (Dataset-/Split-SHA, Routing-Gate) und die belegenden Validation/Test-Metriken.
  Fail-closed: blockierter Run/Vergleich → `status=blocked`, kein Threshold, Exit-Code `1`.
  **+15 Backend-Tests** (9 Domain + 6 CLI).
- **ML-Routing-Policy in die KI-Triage verdrahtet (advisory, ENV-gated):** Ist
  `ML_ROUTING_POLICY_PATH` auf ein `recommended-routing-policy.json` mit
  `status=ready` gesetzt, erhalten Agent-Suggestion-Responses
  (`GET /api/v1/agent/suggestions[/:id]`, `POST /api/v1/agent/propose`) ein
  advisory `routing`-Feld: `auto_accept_eligible` (confidence >= Policy-Threshold)
  bzw. `route_to_review` (darunter), inkl. `policyName` + `threshold`. **Kein
  Auto-Handeln** — Human-in-the-Loop bleibt, es ist ein Triage-Hinweis. Fail-safe:
  ungesetzte/blockierte/fehlerhafte Policy → kein `routing`-Feld, unverändertes
  Verhalten (Default AUS). Fehlende confidence wird nie geraten (`unknown`).
  **+27 Backend-Tests** (16 Domain-Helfer, 8 ENV-Loader, 3 Route-Verdrahtung).
- **ML-Evaluation Admin-Seite (`/ml-eval`):** Neue read-only Frontend-Seite (Admin)
  macht die ML-Eval-Schicht sichtbar: zeigt die aktive Routing-Policy (Name +
  Accept-Threshold, oder ehrlicher Inaktiv-Zustand inkl. Hinweis auf
  `ML_ROUTING_POLICY_PATH`) und erlaubt eine bounded, redigierte
  Eval-Snapshot-Vorschau (Record-Counts, Label-Verteilung, Schema-Signatur) per
  Knopfdruck — ehrlicher Leerzustand bei 0 Records. Dazu neuer admin-gated
  Backend-Endpunkt `GET /api/v1/ml/eval/status` (ohne Dateipfad-Leak).
  **+3 Backend-Tests + 4 Frontend-Tests (Vitest).**
- **Operator-Runbook „ML-Routing-Policy scharfschalten":** `docs/01-architecture/ml-routing-policy-runbook.md`
  beschreibt den vollstaendigen Prod-Pfad: Eval-Snapshot ziehen → Gold kuratieren/mergen →
  `ml:gold-pipeline` → `ml:run-policy-compare` → `ml:policy-export` → `ML_ROUTING_POLICY_PATH`
  setzen → verifizieren (`/ml/eval/status`, `/ml-eval`, `routing`-Feld) → Rollback. Der Loop
  ist lokal end-to-end auf dem 20-Record-Gold-Set verifiziert (deterministischer Dataset-SHA,
  Live-Load der Policy als `active`, Klassifikation `auto_accept_eligible`/`route_to_review`).
  **+57 Backend-Tests**.
  **+32 Backend-Tests**.

- **Long-term-Architekturtracks konkretisiert:** Die Roadmap-Punkte
  `Zero-trust access` und `Machine learning model training` sind jetzt als
  produktneutrale Architektur-/Security- bzw. MLE-Tracks dokumentiert:
  `ADR-038`, `ADR-039`, `docs/05-security/zero-trust-access-plan.md`,
  `docs/01-architecture/ml-training-plan.md`, `ml-label-contract.md`,
  `ml-eval-schema.md` plus redigiertes JSONL-Beispiel.

- **Communication Map um Traffic-Kennzahlen erweitert:** Der Network-&-NAT-Tab zeigt
  direkt in der Communication Map jetzt Gesamt-Traffic, Denied Traffic und Permitted
  Traffic jeweils mit Event-Anzahl sowie First-/Last-Seen-Uhrzeit. Die Ableitung nutzt
  echte `network.flows` und faellt ohne Flows auf Wazuh-Timeline-Actions zurueck.
  Fehlt `durationMs`, wird die Dauer aus Flow-Start/-Ende bzw. Timeline-First/-Last
  berechnet, damit geflossener Traffic nicht mit leerer Dauer erscheint. **+4 Tests**
  fuer Flow-/Timeline-Zaehllogik und Duration-Fallback.

- **Lokale Ollama-Analyse auf 512 Tokens begrenzt:** Standard-Output-Budget
  `OLLAMA_NUM_PREDICT` von 2000 auf 512 reduziert, damit CPU-only-Ollama keine
  minutenlangen Single-Slot-Analysen blockiert; über `OLLAMA_NUM_PREDICT` ENV
  weiterhin überschreibbar. Betrifft `OllamaLlmProvider` und
  `OllamaUseCaseDeveloperProvider`. `deploy/.env.production.example` dokumentiert
  den Parameter. **+2 Tests** (Vertragstests für beide Provider).

- **Data-Plane-Intake-Build-Kontext korrigiert:** `deploy/nexora-intake/
  docker-compose.yml` zeigte auf `./dataplane` (relativ zum Compose-Verzeichnis,
  nicht existent) statt `../../dataplane` (richtiger Pfad zum Dataplane-Paket) →
  `docker compose up` im Deploy-Verzeichnis schlugen mit „build context not found"
  fehl. Einzeilige Pfad-Korrektur; kein Logik-/Konfigurationsänderung.

- **Data-Plane-Noise reduziert + Wazuh-FP-Workflow gehaertet:** Reine Suricata-`ids`/
  `info`-Telemetrie ohne Alert/Detection/Firewall-Aktion wird jetzt pro Ziel/Port/
  Protokoll in einem 15-Minuten-Noise-Fenster zu einem stabilen Sammel-Incident
  verdichtet; echte Alerts, Wazuh-Detections, Firewall-Blocks und Conntrack-Fusionen
  bleiben unveraendert praezise. Der Wazuh-FP-Service prueft Rollen nun zusaetzlich
  serverseitig: `apply` nur Engineer/Admin, `restart`/`revert` nur Admin.

- **QRadar-Use-Case-Doku ergänzt:** Neue HTML-Bibliothek unter
  `docs/06-integrations/qradar/` mit MITRE-Coverage-Map, Szenarioseiten,
  QRadar-Rule-Wizard-Anleitung, False-Positive-Hinweisen und Validierungskriterien;
  die Integrations-README verlinkt die neue Doku-Suite.

- **Backend-Gate stabilisiert:** Die lokale Windows-Vollsuite brach unter hoher nativer
  `bcrypt(12)`-Last mit Exitcode `-1073740791` ab. Tests nutzen jetzt in `NODE_ENV=test`
  standardmäßig bcrypt 4 Rounds; Produktion bleibt fail-safe bei mindestens 12 Rounds
  (`resolveBcryptRounds` + Guard-Tests). Der Provisioning-Rate-Limit-Test hat zusätzlich
  ein explizites 30s-Timeout. Verifikation: `LOG_LEVEL=error npx jest --runInBand
  --no-cache --silent` grün mit 278 Suiten / 3562 Tests.

> **Deployed & live-verifiziert auf nexora 2026-06-27 — Self-hosted Mailserver + E-Mail-Notifications PRODUKTIV (intern):** Eigener Mailserver auf **Proxmox-CT 108 (`10.0.10.85`)** ausgerollt und Nexora-Notification-Outbound **end-to-end live verifiziert**: `soc_api_prod (nodemailer) → SMTP :25 → docker-mailserver → soc@-Postfach` (`250 OK` + Mail im Postfach). Zuerst **Stalwart** deployt, dann auf **docker-mailserver** gewechselt, weil Stalwart wizard-first ist (kein `stalwart-cli` im v0.16.11-Release, Management-API im Bootstrap nicht gemountet → nicht headless automatisierbar; ADR-037-Revision). DMS headless aufgesetzt: Konten `notify@`/`phishing@`/`soc@` per `setup`-CLI, intern ohne TLS/Smarthost (Port 25 lokale Zustellung). Prod-`.env.production` (VM 120) gesetzt (`NOTIFICATIONS_OUTBOUND_ENABLED=true` + `NOTIFY_SMTP_*`), `soc_api_prod` recreated (Backup `.env.production.bak-*`). Deploy-Fallen gelöst: Debian-LXC-Postfix auf :25 maskiert, Container-DNS auf 1.1.1.1/8.8.8.8. **Offen:** Phishing-IMAP-Passthrough im Prod-Compose + externe Zustellung (Smarthost-Creds + reale Domain). Acht Commits auf `p-phase0-close` (`ecf7ce4d`→`d1e06d10`), **noch nicht nach main gepusht**. Operator-Details: `deploy/mailserver/README.md`.
>
> **Deployed & live-verifiziert auf nexora 2026-06-25 — Data-Plane-Kette inkl. 3-Domänen-Cross-Domain PRODUKTIV:** Echte externe Angreifer (Online-Honeypot) laufen end-to-end durch: `VPS-Kollektoren (conntrack · Cowrie · Suricata) → WireGuard → Intake → Outbox → Worker (Cross-Domain-Fusion) → soc_api_prod (A4-Ingress, HMAC) → priorisierte Prod-Tickets`. Verdikt-Stufung **live belegt**: conntrack-Flow allein = `observed` → +Cowrie-SIEM = `suspicious` → +Suricata-IDS-Alert = `confirmed_malicious` (INC000816/817/831 „flow+siem+ids", high). **A4-Verdikt-Upgrade** (`d98bebca`, nur `api` rebuilt, DB-Backup vorab): bestehende Tickets steigen bei neuem Signal auf (Analyst-Urteile benign/fp unangetastet, kein Downgrade) — live `escalated=3`. Alle drei VPS-Kollektoren als **non-root** (`CAP_NET_ADMIN`/Gruppen-Read). Prod von `5f6d9d52`→`28bb3fee`+ rebuilt, Remote tokenlos (Deploy-Key). Operator-privater Host-für-Host-Changelog + Rollback: `docs/_private/INFRA-CHANGELOG-2026-06-25.md`.
>
> **Deployed & live-verifiziert auf nexora 2026-06-23 (drei Releases, je mit Gates CI-grün → `backup-db.sh` → `release.sh`):** Sammel-PR #1 `p-phase0-close → main` (`5b3042c`, 74 Commits: P_CORR_1 · P_CORR_ADMIN_2 · P_PROVISION_SECURITY_1 · P_NIS2_2 · Analysis-Workbench P_UX_1–3 · Report-JSON), danach der **Evidence-Datenfluss-Fix** in drei Schichten — `a772a2e` (strukturierte win.eventdata-Felder + Ticket-Feld `commandLine`, JSONB ohne Migration), `4afe2af` (Lazy Schedule-on-Read), `4a96c01` (scriptBlockText im Korrelations-Normalizer + Engine `ce-1→ce-2`). Post-Deploy je grün: `/health {status:ok,db:ok}`, `pg_migrate_done count:45`, pg-boss + Korrelations-Worker sauber, `CONFIG_APPLY_ENABLED` ungesetzt (Apply gesperrt). **Live verifiziert (Prod-DB):** `correlation_results` ce-2 mit `process.commandLine` = echte PowerShell-Command-Line → Analysis-Deck zeigt Commands/Payloads. Kein Prod-Admin-Passwort angefasst.
>
> **Deployed & live-verifiziert auf nexora 2026-06-20 (`41d8d92` via `deploy/release.sh`):** **MFA (TOTP) + Personal Access Tokens aktiviert.** Gefundene + behobene Falle: der Prod-Compose reichte `MFA_ENABLED`/`API_TOKENS_ENABLED` **nicht** an den api-Container durch → Flags hätten ihn nie erreicht; `41d8d92` ergänzt beide im `environment:`-Block (default false). Pre-Deploy-Gates: FF `c9ec072`→`41d8d92`, verschlüsseltes DB-Backup `soc-20260620-045132.sql.gz.enc`, **Migration 038 (`mfa_enrollments`) additiv + idempotent** (`CREATE TABLE IF NOT EXISTS`). Server-`.env.production`: `MFA_ENABLED=true`+`API_TOKENS_ENABLED=true`. Post-Deploy grün: Container-ENV beide `true`, `pg_migrate_done count:38`, keine Boot-Fehler, **Gates offen** (`/v1/mfa/status` + `/v1/tokens` = **401 statt 503** = Beweis). MFA bleibt **opt-in pro User** (keine Bestandsnutzer ausgesperrt); `api_tokens`-Tabelle existiert seit Migration 030. **Mini-Ops:** server-`.env.production` von `664`→`640` gehärtet (Secrets nicht mehr world-readable).
>
> **Deployed & live-verifiziert auf nexora 2026-06-19 abends (`c9ec072` via `deploy/release.sh`):** drei nutzersichtbare Fixes/Features als Batch live — **KI-Cloud-Key-Save** (war 500), **Cloud-LLM-Parser** (Claude/GPT liefern jetzt nutzbare Analysen statt „Keine verwertbare Antwort") und **Audit-Export PDF**. Pre-Deploy-Gates: Fast-Forward `f15bb19`→`c9ec072`, verschlüsseltes DB-Backup `soc-20260619-182006.sql.gz.enc`, **kein Migrations-Schritt** (reiner Code → risikoarm). Post-Deploy grün: `/health {status:ok,db:ok}`, HEAD=`c9ec072`. Verifikation rein über Health + Routen-Verhalten; kein Prod-Admin-Passwort angefasst. (Der KI-Save-Fix war vorab separat als `f15bb19` deployt, Backup `soc-20260619-164407`.) **Hinweis:** vor dem Parser-Fix erzeugte „pending"-Cloud-Vorschläge bleiben leer (so in der DB) — **neue** Analysen liefern strukturierte Karten.
>
> **Deployed & live-verifiziert auf nexora 2026-06-19 (`3370fcc` via SSH + `deploy/release.sh`):** **P_PROVISION_SECURITY_1** (Credential-Lifecycle: Admin-Revoke + Node-Retire + Rate-Limits) und **P_NIS2_2** (Incident-Evidence-Verknüpfung + Management-Readiness-Report) sind jetzt **live**. Pre-Deploy-Gates: FF `5e009c3`→`3370fcc`, verschlüsseltes DB-Backup `soc-20260619-152422.sql.gz.enc` vor der Migration, **Migration 037 additiv** (FK `node_credentials.node_id → installed_nodes.id`, `NOT VALID` + `ON DELETE CASCADE`, idempotent). Post-Deploy grün: `/health {status:ok,db:ok}`, die neuen Routen `nis2/report` + `provisioning/nodes/:id/retire` liefern jetzt **401** (vorher 404 = Beweis), FK `fk_node_credentials_node` in der Prod-DB vorhanden (`\d node_credentials`), Logs ohne Fehler/Secrets (`ncr_`/`enr_` 0×). Verifikation rein über **unauthentifizierte Routen-Codes + DB-Constraint** — kein Prod-Admin-Passwort angefasst.
>
> **E2E-Harness (test-only, nicht deploy-relevant):** die 2026-06-14 committete Playwright-Suite (`42c09b1`) war bit-rotted (3/13 grün, App-Drift). Repariert (Auth-Modell ist jetzt httpOnly-Cookie statt sessionStorage-Bearer; KI-Agent-Seite/Selektoren nachgezogen) und erweitert um **NIS2 (Readiness + Management-Report + Incident-Link), Provisioning (admin-gated), Threat Hunts, Evidence** → **8 Specs / 34 Tests grün** (mocked-API, Chromium; ein Strict-Mode-Flake im Hunt-Test gefunden+gefixt). `origin/main = eb49407`. Schritt 2 der „Basis"-Roadmap erledigt.
>
> **Deployed & live-verifiziert auf nexora 2026-06-19 (`5e009c3` via `deploy/release.sh`):** Die gesamte Control-Plane- + NIS2-Kette ist jetzt live. Pre-Deploy-Gates: Fast-Forward `f2705b3`→`5e009c3`, frisches verschlüsseltes DB-Backup vor den Migrationen, Migrationen 033–036 additiv (`CREATE … IF NOT EXISTS`, abwärtskompatibel). Post-Deploy grün: `/health {status:ok,db:ok}`, alle 8 neuen Tabellen in der Prod-DB, `provisioning_repository_selected`+`nis2_repository_selected`=postgres, SPA 200, NIS2/Provisioning-Routen live + 401-auth-gated, ehrlicher Disclaimer im ausgelieferten Bundle, Logs ohne Secrets/Fehler. **Live-Smoke (echte Prod-Instanz, API):** read viewer+ (10 Controls, kein Compliance-Claim) · non-admin Schreibversuch → 403 · Admin: `PUT incident_handling`→in_progress+Owner+Due (200), `POST evidence` „Incident Runbook" (201), Reload-Persistenz in Prod-Postgres, Audit `NIS2_ASSESSMENT_CREATED/EVIDENCE_LINKED/STATUS_CHANGED` mit Redaction (Evidence-URL **0×** im Audit). Visueller Screenshot über identischen Build (`5e009c3`). Kein Wazuh-/OPNsense-/Indexer-Write, kein Agent-/Host-Install, kein Enrollment-Token-Mint in Prod.
>
> **Ops (separat):** `wazuh-indexer` (VM 177) war seit der Lab-Recovery `failed (timeout)` → Port 9200 tot → keine Dashboard-Telemetrie. Per `systemctl restart wazuh-indexer` (RAM nun gesund) wieder `active`, `:9200` erreichbar (nexora→Indexer 000→401), Dashboard-Charts + Agent-Buffer-KPI wieder live. Offen: optionales `TimeoutStartSec`-Härten gegen erneutes Start-Timeout beim Reboot.

### Added
- **Self-hosted Mailserver (docker-mailserver) — `deploy/mailserver/` (ADR-037):** Compose + README + `.gitignore` für einen CLI-/datei-konfigurierten Mailserver (Postfix+Dovecot+OpenDKIM), voll headless aufsetzbar (kein Web-Wizard). LIVE auf CT 108. Liefert SMTP (Notification-Outbound) + IMAP-Postfach (Phishing-Ingest). Stalwart→DMS-Wechsel begründet (wizard-first, nicht automatisierbar). Externe Zustellung (Smarthost+SSL) + IMAP-Passthrough offen.
- **Analyst-Workflow-Controls verdrahtet (Verdrahtungs-Audit Phase B/C1/C2) _(lokal)_:** Vier bislang inerte Analyse-Deck-Buttons an vorhandenes Backend angeschlossen, alle TDD: **Create Follow-up Ticket** (verknüpft via `Ticket.parentId`, `buildFollowUpTicket`), **Add as Note** (KI-Verdict+Assessment → Ticket-Notizen mit auditierbarer Herkunftszeile, `appendNote`/`buildKiNoteText`), **Mark as Important** (`priority='high'`, nie herabstufend, `markImportantPriority`), **Needs More Context** (Re-Propose mit Analyst-Hinweis — additiver optionaler `note`-Durchstich Route→`AgentService.propose`→geteilter Prompt-Builder, wirkt für alle LLM-Provider, Schema unverändert, 2000-Zeichen-Cap). **16 neue Unit-Tests**; Regression grün (453 Vitest + 51 Backend), tsc sauber.
- **C3-UI: Test-Benachrichtigung senden _(lokal)_:** `POST /api/v1/notifications/test` (admin) → `deliverOutbound(buildTestNotification())`, Antwort nur Kanal-IDs/skip-Grund (Secret-Leak-Test). NotificationsPanel-Button + `formatTestResult` (rein). Verifiziert Outbound-Kanäle (u.a. den neuen E-Mail-Kanal) aus der UI. **+12 Tests** (7 BE, 5 FE). Kanal-**Konfiguration** bleibt bewusst ENV (ADR-037, keine Secrets in DB).
- **Verdrahtungs-Audit + Abarbeitungsplan (`docs/00-overview/abarbeitungsplan-2026-06-27.md`) _(lokal)_:** System-weiter Read-only-Audit (4 parallele Agents): keine der 29 Seiten ist Attrappe, keine der 37 Routen ein toter Stub, 0 tote FE→BE-Calls. Geordneter Plan (baubar-jetzt / braucht-Entscheidung / Architektur). Doku-Korrekturen: WebAuthn = Fehlalarm (voll verdrahtet), `/config` bewusst backend-only, `conntrackCollector` ist wählbarer COLLECTOR_KIND (kein Dead-Code), `updateTicketStatus`/Export-Route überholt (implementiert).
- **Internal Pull-Collector-Hub LIVE + Daten-/Artefakt-Inventar (ADR-036, `docs/00-overview/dataplane-inventar-2026-06-25.md`):** Migration Push→Pull abgeschlossen — Kollektoren laufen jetzt **intern** im gebündelten `collector-hub` (nexora) und **pullen** read-only per SSH-`tail` von den Quellen (`cowrie.json` + `eve.json`); auf dem Honeypot **kein Collector-Code/Credential/Agent** mehr (nur Cowrie- + Suricata-Sensoren). conntrack abgelöst durch Suricata-`flow`. Neue Module: `pullSource` · `remoteTailSource` · `sshTail` · `collectorHub` · `collectorHubMain` (Config→Factories, `intervalMs` sek→ms, Self-Healing, AbortSignal). **Inventar** klassifiziert Quellen/Artefakte/Code als gebraucht / abgelöst (Push-Artefakte `deploy/vps-{conntrack,cowrie}` + Suricata-Push-Teile = überflüssig; Suricata-Sensor bleibt) + Untracked-Triage. Operator-Details/Rollback: `docs/_private/INFRA-CHANGELOG-2026-06-25.md`.
- **Data-Plane VPS-Collector-Artefakte (`deploy/vps-cowrie/` + `deploy/vps-suricata/`):** reproduzierbarer Rollout der zweiten/dritten Cross-Domain-Quelle analog zu `deploy/vps-conntrack/` — systemd-Unit-Vorlagen (non-root, gehärtet), schlanke Suricata-Regel (`nexora.rules`, kein ET-Ruleset), Seed-SQL (Pro-Collector-Identität, nur SHA-256-Hash) + READMEs mit Rollout/Rollback. **Repo-sicher per Platzhalter** (`<HONEYPOT_PUBLIC_IP>`/`<INTAKE_TUNNEL_IP>`/`<CAPTURE_IFACE>` etc.), echte Werte nur operator-privat. Damit ist der ganze 3-Domänen-Rollout aus dem Repo nachbaubar.
- **Cowrie-SIEM-Collector + A4-Verdikt-Upgrade (`dataplane/src/collector/cowrieCollector.js`, `backend/.../verdictEscalation.js`):** Cowrie-`eventid`→`detection` (severity/MITRE), `dstIp` auf Honeypot-IP verankert → selbes IP-Paar wie conntrack/Suricata; A4 stuft bestehende Vorfälle bei echtem Verdikt-Anstieg hoch (kein Downgrade, Analyst-Urteile bleiben). TDD: +18 Tests (11 Collector inkl. Cross-Domain-Nachweis, 7 Eskalation/Ingress). Siehe `dataplane/CHANGELOG.md`.
- **Suricata-Flow-Index — Review-Vorlagen (`deploy/suricata-flows/`) _(lokal, nicht aktiv)_:** reviewfähige Artefakte für einen **separaten, gefilterten** Suricata-Flow-Telemetrie-Index `suricata-flows-*`, **getrennt** vom `wazuh-alerts-*`-Alert-Pfad: Sensor-Filebeat-Vorlage (`eve.json` → 3-Schritt-Filter → Indexer), OpenSearch-Index-Template + ISM-Policy (Rollover 1d/5gb, Retention 14d, 0 Replicas, 30s Refresh). **Phase-1-Filter bewusst eng** (Honeypot + kritische Ports + externe Gegenstellen; ganzes Server-VLAN erst nach Volumen-Messung). **Rohes** Suricata-Schema (top-level `src_ip`/`dest_ip`/`flow.*`, kein `data.*`) → später eigener Nexora-Suricata-Index-Adapter (Step 5). **Repo-sicher per Platzhalter** (`${HONEYPOT_IP}` etc.), echte Config lokal außerhalb des Repos (`/etc/nexora-suricata-flows/filebeat.yml`). Recon-Befund (read-only): Filebeat nur am Manager, `eve.json` am Sensor, keine ISM-Policies vorhanden. **Kein Apply** — Mirror/User/Index folgen im Wartungsfenster. Grundlage: ADR-034 + Suricata-Recon.
- **Suricata-Flow-Normalizer (S1) _(lokal)_:** `flowNormalizer` kennt jetzt den Quelltyp `suricata` — gemappt aus den **echten** eve-Feldern (am Live-Indexer verifiziert): 5-Tuple aus `data.src_ip`/`data.dest_ip` (**dest**, nicht dst!)/`src_port`/`dest_port`, `protocol` aus `data.proto`, **echte Bytes/Pakete** aus `data.flow.bytes_toserver/toclient` + `pkts_toserver/toclient` (toserver = sent), `flowStart` aus `data.flow.start`, `durationMs` aus `start/end` bzw. `age` (sonst `field_missing`), `connectionState` aus `data.flow.state`. Additive Metadaten **nur wenn vorhanden**: `appProtocol` (`data.app_proto`), `flowId`, `communityId`. **Ehrlich:** `direction` wird NICHT aus `to_server` geraten; NAT/Firewall/Interface/Prozess → `source_provides_none`; kein GeoIP/ASN/Reputation. Damit zeigen Suricata-Flows echte Bytes/Dauer in Top Conversations + Flow Statistics. **9 neue BE-Tests + 2 FE-Smoke**; Korrelation 23 Suiten/210 grün, FE networkModel 17 grün, tsc grün. **Keine Suricata-Konfiguration geändert** — read-only Recon (landen `flow`-Events schon im Indexer?) folgt separat.
- **Correlated Exposure Path — UI (Slice 3c) _(lokal)_:** Neue dezente Sektion „Correlated Exposure Path" im Network-&-NAT-Tab — getrennt von Flows/Sessions, **nur** wenn Einträge existieren (kein Kandidat → **keine** Sektion). Pro Eintrag: Remote Source (Angreifer-IP), Firewall-Ziel/Port + Protokoll + Action, Firewall-Event-Zeit, Confidence-Badge (`high`/`medium`/`none`); bei `none` ehrlicher Mehrdeutigkeits-Hinweis statt erfundenem Ziel. Fixer Disclaimer „Korreliert aus Firewall- und Honeypot-Evidence · **Keine bestätigte NAT-Translation**". Reines Modell `deriveExposureCorrelations` (Passthrough + Sortierung high→medium→none; **kein** Umschreiben von `natVerified`/`provenance`). **5 neue FE-Tests** (2 Modell + 3 Component); FE network 4 Dateien/31 grün, tsc grün. **Schließt Slice 3** (Engine 3a + Fetch/Wiring 3b + UI 3c).
- **Exposure-Stitching: Firewall-Fetch + Route-Wiring (Slice 3b) _(lokal)_:** `WazuhIndexerClient.ticketFirewallFlows({srcIp, firstSeen, lastSeen})` holt **read-only** die Firewall-5-Tuple-Events **derselben externen IP** im Session-Fenster (±5 min, Obergrenze 1000) und liefert **engine-fertige** Flows (`sourceType:'firewall'` + `eventId`); fehlende `src_ip`/Fenster → leeres Ergebnis mit Grund, **keine breite Suche**. Reiner Orchestrator `buildExposureCorrelations({honeypotSessions, fetchFirewallFlows})` leitet distinct Angreifer-IPs + Fenster aus den Sessions ab, holt je IP die Firewall-Kandidaten (Soft-Fail pro IP) und ruft `correlateHoneypotExposure` → `network.exposureCorrelations`. Die Timeline-Route verdrahtet beides **defensiv** (Fehler → leeres Array, Route bleibt 200). **9 neue BE-Tests** (5 Fetch + 4 Orchestrator); Korrelation+Indexer 23 Suiten/226 grün. UI folgt in 3c.
- **Correlated Exposure Stitching — reine Engine (Slice 3a) _(lokal)_:** Neues reines Modul `honeypotExposureCorrelation.js` (`correlateHoneypotExposure(cowrieSessions, firewallFlows, options)`) verbindet eine `honeypot_session`/einen partiellen Cowrie-Flow mit einem OPNsense-Firewall-Event — **nur bei eindeutiger Plausibilität** (gleiche externe Source-IP + TCP + exakter Cowrie-Port bzw. Service-Mapping `ssh→22/2222` + enges Zeitfenster ±120 s). Ergebnis = **„correlated exposure path"**, **keine** behauptete NAT-Translation: jeder Eintrag trägt `natVerified:false`, `provenance:"correlated"`, `correlationType:"firewall_to_honeypot"` (additiver Block `network.exposureCorrelations`). Confidence (≠ Severity): `high` (exakter Cowrie-Port + sehr kleine Zeitdiff), `medium` (Port nur via Service-Mapping), `none` + `missingReason:"no_unique_firewall_match"` bei Mehrdeutigkeit (ohne FW-Felder); **kein Kandidat → kein Eintrag** (keine künstliche Kette). Identische FW-Events (gleiches 5-Tuple) zählen als EIN Kandidat; Online-VPS-Honeypot → Angreifer-IP nicht in OPNsense → ehrlich kein Match. Grundlage: **ADR-034** (Indexer-Befund: OPNsense liefert nur das 5-Tuple, NAT-/Interface-/Byte-Felder doc_count 0). **11 BE-Tests**; Korrelation 22 Suiten/197 grün. **Keine Route/DB/UI/Fetch** — 3b (Firewall-Kandidaten-Fetch + Wiring) und 3c (UI) folgen separat.
- **Cowrie-Realdaten: session-derived partielle Flows + Gate-Korrektur (Slice 2b.4) _(lokal)_:** Live-Smoke-Befund am echten Indexer: dort liegen NUR `login.success/failed`, `command.input`, `client.version` (mit `src_ip`/`session`/`protocol`) — **kein** `session.connect/closed`, **kein** `dst_ip/dst_port`. Folgen-Fix: **(1) flowNormalizer** erkennt jedes `cowrie.*`-Event mit `src_ip` als (ggf. partielle) Netzwerkbeziehung; Ziel-IP/Ports bleiben `null` mit `missingReason: source_does_not_provide_5_tuple`, der Flow trägt `flowCompleteness: 'partial'` (bzw. `'full'`, wenn ein 5-Tuple vorliegt). **(2) buildNetworkCorrelation** dedupliziert auf **EINE** Cowrie-Beziehung pro `sessionId` (bevorzugt die mit Ziel-IP). **(3) 2b.2-Gate korrigiert:** gatet nicht mehr auf Cowrie-`network_flows`, sondern auf echte Cowrie-**Quellereignisse** (`eventid startsWith cowrie.` + `src_ip` + eindeutiger `agent.id`); Angreifer-IP/Fenster/Session werden daraus abgeleitet (nie `agent.ip`, nie `ticket.srcIp`). **(4) ticketFlows** Flow-Relevanz auf Präfix `cowrie.`. **(5) Frontend:** `flowCompleteness` im Typ + ehrlicher Hinweis „Session-basierte Verbindung — Ziel/Port von Cowrie nicht geliefert" (keine vollständige 5-Tuple-/NAT-Behauptung). **Tests:** Anker login/command + partial-Markierung, Dedup je Session, Gate auf Quellereignisse (agent.ip nie Quelle, mehrere IPs), Frontend-Partial-Hinweis; BE Korrelation+Indexer 22 Suiten/206 grün, FE network 3 Dateien/26 grün, tsc grün.
- **Honeypot-Sessions im Network-&-NAT-Tab (Slice 2b.3) _(lokal)_:** Neue **eigene Sektion** „Honeypot Sessions" — klar getrennt von `network.flows`. Reines Ableitungs-Modell `honeypotSessionsModel.ts` (`deriveHoneypotSessions`) liest `network.honeypotSessions`: pro Session die externe **Angreifer-IP** (eindeutig beschriftet „Remote Source / Angreifer-IP", weil ausschließlich aus Cowrie `src_ip`), internes Honeypot-Ziel + Service/Port, Start/Ende/Dauer/Session-ID, Login-Status (Versuche/Erfolg/Fehlschlag + `authSuccess`-Badge), beobachtete Usernamen (bounded), Commands mit Zeitstempel + „+ N weitere Commands"-Hinweis, Downloads/Fingerprint nur bei echten Daten. **Passwörter werden nie angezeigt** (Whitelist-View → nur „Passwort beobachtet: ja/nein (N)"). Flow-Verknüpfung über `relatedFlowSessionId`: bei vorhandenem Cowrie-Flow Hinweis auf den zugehörigen Netzwerkflow, sonst ehrlicher „kein zugehöriger Flow"-Hinweis (keine künstliche Verbindung). **Kein Geo/ASN/Reputation/NAT** in dieser Ansicht. Empty-State: „Keine Honeypot-Sessions für diesen Ticket-Kontext gefunden." **10 neue FE-Tests** (6 Modell inkl. „Passwort nie durchgereicht"/more-commands/Flow-Link + 4 Component inkl. Empty-State); FE `tsc` grün, Analysis-Suite 31 Dateien/279 grün.
- **Saubere IP-Semantik: Quelle ≠ Angreifer ≠ Sensor (Slice 2b.0) _(lokal)_:** Neues reines Modul `networkSourceIp.js` trennt drei Rollen — `extractNetworkSourceIp` (echte Netzwerkquelle: Cowrie `src_ip` → Firewall `srcip` → Sysmon `sourceIp`, **nie** `agent.ip`), `extractHoneypotAttackerIp` (**nur** Cowrie `src_ip` = externe Gegenstelle) und `extractSensorIp` (`agent.ip` = „wer hat gemeldet"). **Bug behoben:** `wazuhMapper` mappte `srcIp = data.srcip || agent.ip` → bei Cowrie-Tickets stand die **Honeypot-Agent-IP** statt der Angreifer-IP im Ticket; jetzt `srcIp` **ohne** `agent.ip`-Fallback, plus neue Ticketfelder `attackerIp` (nur Honeypot-Inbound) und `sensorIp` (agent.ip). Host-Case setzt `agent.ip` nicht mehr als `srcIp`, sondern als `sensorIp` (MAC-Auflösung zieht den Hint entsprechend nach). Felder additiv in der `network`-JSONB-Gruppe — **keine Migration**. So bleibt für UI/Threat-Intel/Korrelation klar, welche IP welche Rolle hat. **Tests:** 12 neue Extraktor-Tests + erweiterte Mapper-Vertragstests (alte `agent.ip→srcIp`-Erwartung auf die neue Semantik umgestellt); BE 83 Suiten/1061 grün (integrations/domain/repositories/correlation).
- **Honeypot-Sessions in der Timeline-Response (Slice 2b.2) _(lokal)_:** Die Timeline-Route ergänzt einen **separaten** Block `network.honeypotSessions` (nie in `network.flows` gemischt). Reiner Orchestrator `buildHoneypotSessions`: Gate auf echte Cowrie-`network_flow`s, **`agentId` nur aus belegtem Cowrie-Event** (`_source.agent.id`, eindeutig — **NIE** aus `offenseId`/Ticket), `sourceIp` + Zeitfenster aus den Cowrie-Flows (umgeht den `ticket.srcIp`-Agent-Fallback) → `ticketHoneypotSessions()` je distinct Angreifer-IP → `aggregateHoneypotSessions()`. **Soft-Fail:** kein Cowrie-Flow / kein belegter Agent → **kein Fetch** + `honeypotSessions: []`; Fetch-Fehler → Route bleibt 200, leeres Array; `network.flows` unverändert. `ticketFlows` projiziert zusätzlich `agent.id`. **8 neue BE-Tests** (7 Orchestrator: Cowrie-Flow→Sessions · kein Flow→kein Fetch · kein/mehrdeutiger Agent→kein Fetch · Fetch-Fehler→[] · mehrere IPs→Fetch je IP · flows unmutiert; +1 Projektion); Korrelation+Indexer 20 Suiten/186 grün. **Keine UI** (Slice 2b.3), keine Migration.
- **Cowrie-Session-Events: session-bezogene Indexer-Abfrage (Slice 2b.1) _(lokal)_:** `WazuhIndexerClient.ticketHoneypotSessions()` holt **read-only** die Cowrie-Events EINES Tickets — eng begrenzt über `agent.id` (Honeypot) + `data.src_ip` (Angreifer) + **enges Zeitfenster** (`firstSeen/lastSeen ±15 min`), damit wiederkehrende Scans desselben Angreifers keine fremden Sessions ins Ticket ziehen; optionale `data.session` verengt zusätzlich (keine Voraussetzung). **`data.password` wird NIE projiziert** (auch nicht maskiert) — Datensparsamkeit an der Quelle; geholt werden nur `username/input/url/outfile/destfile/filename/shasum/hassh/version` + 5-Tuple/Zeit. Fehlt Agent/Source-IP/Zeitfenster → leeres Ergebnis mit Grund (`missing_agent|missing_src_ip|missing_time_window`), **keine breite Suche**. `size` hart auf 1000 gekappt. Reines `_search` — **keine Route/UI/Migration**. **7 neue BE-Tests** (Query/Fenster/Projektion-ohne-password/optionale Session/Voraussetzungen/Size-Cap/Mapping); Indexer+Korrelation 19 Suiten/179 grün.
- **Cowrie-Events zu `honeypot_session` aggregiert (Slice 2) _(lokal)_:** Reines Aggregations-Modul `honeypotSessionNormalizer.js` baut **ein `honeypot_session` je `sessionId`** aus rohen Cowrie-Events — Login-Status (`loginAttempts/Succeeded/Failed`, `authSuccess` = null/false/true), **begrenzte** Commands (`maxCommands`/`maxCommandLen` + `commandsTruncated`, Zähler bleibt vollständig), Downloads (`url/filename/hash`, nur real vorhandene Felder, kein Leereintrag) und optionale Client-Fingerprints (`hassh`/`version`). **Passwörter werden niemals gespeichert** — nur `passwordObserved` + `passwordAttempts` (datensparsam). Usernamen nur, wenn im Event vorhanden (dedupliziert, bounded). Jede Session trägt `relatedFlowSessionId === sessionId` → eindeutige Verknüpfung mit dem Cowrie-`network_flow` aus Slice 1. **Kein Geo/ASN/Reputation/NAT/TLS** (ADR-009, nichts erfunden). **Keine DB-, API- oder Frontend-Änderung** in diesem Slice — bewusst reines, getestetes Modell vor dem Wiring. **14 neue BE-Tests** (vollständige Session · Command-Bounding · mehrere Sessions + authSuccess-Varianten · Robustheit: out-of-order/Nicht-Cowrie/ohne-Session/leere Downloads); Korrelations-Suite 18 Suiten/159 grün.
- **Cowrie-Honeypot-Sessions als `network_flow` (Slice 1) _(lokal)_:** Cowrie `session.connect`/`session.closed` werden als **eingehende `network_flow`-Records** normalisiert und erscheinen im Network-&-NAT-Tab — bis zur Correlation Engine durchverdrahtet, nicht nur ein isolierter Normalizer. **(1) Flow-Normalizer** (`flowNormalizer.js`) kennt den Quelltyp `cowrie`: 5-Tuple in **ehrlicher Post-DNAT-Sicht** (interne Honeypot-IP als Ziel), `protocol=tcp` (SSH/Telnet definitionsgemäß, als `derived:` markiert — nicht erfunden), `service` (ssh/telnet), `direction=inbound`, `flowStart`/`flowEnd`, `durationMs` (s→ms aus `closed`), `connectionState`, `sessionId`, `sensorId` + volle `provenance`/`missingReason`. **(2) Engine-Wiring** (`WazuhIndexerClient.ticketFlows`): die `_source`-Projektion holt die Cowrie-Felder (sonst kämen sie **feld-leer** beim Normalizer an) und der Host-Case-Flow-Relevanz-Filter lässt `cowrie.session.*` zu (`data.src_ip` mit Unterstrich ≠ Firewall-`srcip`); `buildNetworkCorrelation` reicht sie unverändert durch. **(3) Frontend** (`analysisModel.ts`): `FlowSourceType` um `cowrie` + optionale Honeypot-Felder erweitert; `networkModel` rendert Cowrie-Flows in Conversations/Flow-Statistik. **Bewusst `null`** (ADR-009): NAT-/`postNat`-/öffentliche-Ziel-/Firewall-/Interface-/Byte-/Prozessfelder = `source_provides_none` (kann der Honeypot nicht sehen → kommt erst aus OPNsense-Stitching, Slice 3). **Keine** Credentials im Flow (→ Slice 2 `honeypot_session`, maskiert), **keine** Geo-/ASN-/Reputation-Daten. **Strikt additiv** — bestehende Sysmon-/OPNsense-Flow-Pfade unverändert. **Neue Tests:** 14 BE (Cowrie-Mapping-Vertrag) + 1 BE (Indexer-Wiring) + 3 FE (Network-Modell-Smoke); BE-Korrelation 18 Suiten/158 grün, FE networkModel 15 grün, FE `tsc` sauber.
- **Evidence-Datenfluss zum Analysis-Deck repariert (Wazuh) — 3 Schichten:** Der Deck blieb bei Wazuh-Tickets leer (Commands/Payloads/Entities), obwohl der Roh-Alert die Daten enthält. Ursache + Fix: **(1) Lazy Schedule-on-Read** — `GET /tickets/:id/evidence` plante bei Status `unavailable`/`superseded` keinen Korrelations-Job (Scheduling lief nur bei Mutationen, nie bei Ticket-Erstellung) → frische Tickets fielen auf den sparsamen Frontend-Parser zurück. Jetzt plant der Read idempotent + defensiv einen Job (`pending`), das Polling holt das reiche, materialisierte Resultat. **(2) PowerShell ScriptBlock** — `wazuhEvidenceNormalizer.buildProcess` extrahiert jetzt auch `win.scriptBlockText` (Event 4104, z.B. Rule 91809) nach `process.commandLine` (vorher nur `commandLine`/`processCommandLine`). **(3) Cache-Invalidation** — `CORRELATION_ENGINE_VERSION ce-1 → ce-2` invalidiert alte (scriptBlock-blinde) Results → Neuberechnung. Die Korrelations-Engine (`normalizeWazuhEvidence`) parst den vollen Roh-Alert aus `ticket.logs` und ist die Primärquelle des Decks. **9 neue BE-Tests** (Lazy-Schedule 3 · scriptBlock-Normalizer 1 · buildEventFields 6); live auf nexora verifiziert.
- **Strukturierte win.eventdata-Felder ins Ticket (Wazuh) + neues Feld `commandLine`:** `WazuhProcessor.buildEventFields` mappt `win.eventdata` → dedizierte Ticketfelder (process/commandLine/user/protocol/port/hash, inkl. `scriptBlockText`), gekappt auf Joi-Limits, fehlende bleiben weg (ADR-009, keine Fake-Daten). Neues Ticket-Feld `commandLine` durch Domain + Joi + Postgres-`asset`-JSONB-Gruppe — **keine DB-Migration** (JSONB nimmt den Key auf). `buildEvidence` mappt `t.commandLine → ev.process.commandLine`. Verbessert den Frontend-Fallback + flache Felder für Liste/Suche. **8 neue Tests** (FE 2 + BE 6).
- **Report JSON-Export (P_REPORTS_3) _(lokal)_:** der Analysis-Report-Tab kann den Incident-Report jetzt zusätzlich als **strukturiertes JSON** exportieren (maschinenlesbar für SOAR-/Ticket-Ingestion) — neben den vorhandenen Wegen (Incident-/Kunden-PDF, Markdown-Copy/Export, Text/Print, Send-to-Ticket). Schließt die Phase-2-Definition „Markdown/**JSON**/PDF" wörtlich. Neues reines, getestetes Modul `reportJson.ts` (`buildReportJsonEnvelope`/`renderReportJson`/`reportJsonFilename`) leitet **verlustfrei** vom gemeinsamen `ReportDoc` ab (keine eigene Mapping-Logik, gleiche Single Source wie Text/Print/PDF) mit stabilem Schema-Marker `nexora.report.v1`; deterministisch, kein Timestamp im reinen Pfad → testbar. ADR-009 bleibt gültig (nichts erfunden — der Envelope serialisiert nur, was der Report enthält); der Kunden-Report bleibt auch als JSON nicht-technisch (kein IP/MITRE-Leak). **7 neue FE-Tests** (Dateiname/Determinismus/Traceability erhalten/Kunden-Report nicht-technisch/leere Daten gefahrlos); FE tsc grün.
- **Persistente Queue-Grundlage: pg-boss v12-Adapter (P_CORR_0) _(lokal)_:** Fundament für die asynchrone, materialisierte Korrelation (P_CORR_1). Der bestehende `PgBossQueueService` war gegen **pg-boss v12 kaputt** (v12: `PgBoss` ist named ESM-export ohne default; `createQueue` ist Pflicht; `work()` liefert ein Job-**Array**; `teamSize/teamConcurrency` entfernt; `expireInHours`→`expireInSeconds`). Modernisiert: **lazy ESM-require** (die CommonJS-Jest-Suite lädt pg-boss nie), `createQueue` + **Dead-Letter-Queue** idempotent (Retry-Policy auf der Queue), `work` mit `batchSize:1`+`includeMetadata` und Array-Normalisierung, **Handler-Fehler werden weitergeworfen** (kein stiller Erfolg → pg-boss retry/dead-letter), `stats()` aus `getQueueStats` (depth/running) + Prozess-Zählern (enqueued/completed/failed/retried), `policy`/`singletonKey`-pass-through als **Idempotenz-Grundlage** für P_CORR_1a. **Metriken** ergänzt: `soc_integration_queue_failed_total` + `soc_integration_queue_retry_total`. **9 Mock-Unit-Tests** (ohne DB) grün. **Integrations-Harness** (`test-integration/`): wegwerfbares Postgres (Docker Compose, tmpfs) + `node --test`-Suite (enqueue · atomisches Claiming/kein Doppel-Processing · Retry/Backoff · Dead-Letter · Recovery nach Worker-Neustart), Lauf via `npm run test:queue:integration`. **Live-Gate GESCHLOSSEN (2026-06-21):** der echte Integrationslauf gegen **pg-boss 12.18.2 + PostgreSQL 16.14 + Docker 29.5.3** ist **4/4 grün** — enqueue · atomisches Claiming (kein Doppel-Processing) · Ack · Retry/Backoff · Dead-Letter · **Recovery nach Worker-Neustart** (Details: `test-integration/RESULTS.md`). Dabei gefunden+behoben: ein falscher `expireInSeconds`-Default (86400 = 24 h) trippte pg-bosss „expiration cannot exceed 24 hours"; `expireInSeconds` (Active-Timeout) wird jetzt nur bei explizitem Wunsch durchgereicht. Die bounded InMemory-Queue bleibt Dev-/Test-Fallback; die Produktiv-Verdrahtung folgt mit dem Correlation-Worker (P_CORR_1b).
- **Correlation Job/Result-Datenmodell (P_CORR_1a) _(lokal)_:** Datenmodell für die asynchrone, materialisierte Korrelation (Pipeline `Ticket/Evidence/Flow geändert → correlation_jobs → Worker → correlation_results → UI liest Resultat + Status`). Neu: reine Domäne `correlationJobDomain.js` — `CorrelationJob` (Status `pending|running|completed|retrying|failed` mit validierten Übergängen; **jeder ungültige Übergang wirft** = kein stiller Fehlzustand; `retryCount`/`failureReason` sichtbar) + `CorrelationResult` (materialisierte korrelierte Evidence + **vollständiger Rückverweis** auf die beitragenden Quell-Tickets/Evidence, **bounded** auf 500 Refs) + deterministischer **`input_hash`** (Ticket + `source_revision` + Engine-Version → Idempotenz: gleicher Input ⇒ kein Doppeljob). Migration `042_correlation.sql` (3 Tabellen, additiv `IF NOT EXISTS`) mit **Partial-Unique-Index** `WHERE status IN (pending/running/retrying)` als DB-Idempotenz-Backstop (auch bei Races). InMemory- **und** Postgres-Repo (Parität; `saveResult` **atomar in einer Transaktion** → kein Teil-Result; Unique-Violation → `ACTIVE_INPUT_CONFLICT`) + Factory. **41 neue BE-Tests** (Domain 17 + InMemory-Vertrag + Postgres-Mapping/Konflikt/Transaktion + Factory). Die bestehende pure `CorrelationEngine` bleibt unverändert; die Verdrahtung kommt in P_CORR_1b (Worker) + 1c (Trigger/Read-Pfad). Voraussetzung für 1b: der noch offene Live-pg-Queue-Gate aus P_CORR_0.
- **Correlation Worker (P_CORR_1b) _(lokal)_:** Asynchrone Worker-Orchestrierung (noch **keine** Route/UI): `Queue-Job {correlationJobId} → Job laden → bounded Input (Ticket + `findChildren` ≤200) → pure CorrelationEngine → source_revision-Recheck → atomar `saveResult` → Job completed → ack`. Pflichtregeln: Job wird **erst nach erfolgreichem atomarem `saveResult`** abgeschlossen; Fehler werden **nicht geschluckt**, sondern an die Queue zurückgeworfen (pg-boss retry/dead-letter); `source_revision` vor dem Speichern erneut geprüft → bei Änderung **kein veraltetes Resultat** (kontrolliert superseded); das Resultat trägt immer `engine_version`/`input_hash`/Evidence-Refs/Zeitpunkte; Input bounded; explizites `start()`/`stop()`; Idempotenz (vorhandenes Result für `inputHash` → kein Recompute; terminaler/fehlender Job → idempotenter ack). Neuer **`queueServiceFactory`**: bei `DB_ENABLED=true` **kein stiller InMemory-Fallback** (persistente Queue oder sichtbarer Fehler beim Start). **12 BE-Tests** (Erfolg · Engine-Fehler→Retry · `saveResult`-Fehler→kein Ack · veraltete Revision · gleicher Input→kein Doppelresultat · start/stop · Queue-Wiring · Factory-Selektion). Die `CorrelationEngine` bleibt unverändert; Trigger + Read-Pfad folgen in P_CORR_1c.
- **Correlation-Trigger / Scheduling-Service (P_CORR_1c.1) _(lokal)_:** Zentraler `CorrelationSchedulingService` — der **eine** Eintrittspunkt, über den relevante Datenänderungen einen Korrelations-Job auslösen (kein verstreutes `queue.enqueue` in Routen). **Idempotent** (gleicher Input → kein Doppeljob via `findActiveJobByInputHash` + `input_hash`; Race → `ACTIVE_INPUT_CONFLICT` nutzt den bestehenden Job). **Relevanz-Filter** `isRelevantTicketChange`: reine Workflow-Änderungen (analyst/status/notes/priority/…) lösen **keine** Korrelation aus, engine-relevante Felder schon. **Resiliente Queue-Benachrichtigung:** der **persistente Job ist die Wahrheit** — scheitert das Enqueue, bleibt er `pending` (kein Rollback, **kein Fake-Erfolg** → `enqueued:false`), Fehler wird geloggt + über einen Metrik-Hook erfasst; `reconcile()` reiht `pending`/`retrying`-Jobs später erneut ein. Neue bounded Repo-Methode `findSchedulableJobs` (InMemory **und** Postgres). **Composition Root (1c.1a):** `correlationRuntime` baut **genau eine** Queue- + Repo-Instanz, geteilt von Scheduler **und** Worker (verhindert den „Scheduler → Queue A, Worker → Queue B"-Fehler); `server.js` startet sie (bei `DB_ENABLED=true` → persistente pg-boss-Queue; ein Startfehler scheitert **sichtbar**, **kein** stiller InMemory-Fallback) und stoppt sie im Graceful Shutdown vor den DB-Pools. **Mutation-Wiring (1c.1b):** relevante Ticket-Updates (`PUT /tickets/:id`) und Evidence-Create (`POST /evidence`) rufen den **einen** zentralen Scheduler — **defensiv** (Mutation nie rückgängig, Scheduling-Fehler nur sichtbar geloggt). **13 neue BE-Tests** (9 Scheduling: idempotenter Job · kein Doppeljob · irrelevante Änderung→kein Job · Enqueue-Fehler verliert Job nicht · reconcile · Relevanz-Helper; 4 Runtime: **geteilte Queue-/Repo-Instanz** · **kein Fallback bei Queue-Start-Fehler** · **Evidence-Mutation end-to-end über DIESELBE Queue** · **reconcile über die Runtime-Queue**) + Postgres-Query-Test. **Transaktionales Mutation-Wiring (1c.1b → CorrelationMutationService):** Evidence-Create läuft jetzt atomar in einer Transaktion (`BEGIN → evidence insert → ticket.updatedAt touch → correlation_job insert → COMMIT → queue notify nach Commit`); ein **Job-Persistenzfehler rollt die gesamte Mutation zurück** (keine inkonsistenten Daten), ein Queue-Enqueue-Fehler **nach** Commit lässt Mutation + pending Job bestehen (über reconcile() recoverable). Lazy `require('../db/pool')` verhindert pg.Pool-Erstellung im Test-Modus ohne DB → verhindert open-handle-Hänger in der Jest-Suite. 3 neue transaktionale BE-Tests (atomic sequence · Rollback bei Job-Fehler · Queue-Fehler nach Commit). **Materialisierter Read-Pfad (1c.2):** `GET /tickets/:id/evidence` ruft `CorrelationEngine.correlate()` **nicht mehr synchron** auf — statisch per Guard-Test erzwungen. Stattdessen: materialisiertes Result + Status aus dem Repo. Status-Logik: **`current`** (Result vorhanden, `inputHash` stimmt) · **`pending/running/retrying`** (aktiver Job) · **`superseded`** (Result veraltet, neueres Ticket) · **`unavailable`** (kein Result, kein Job). Response: `{ data: result|null, correlation: { status, result, resultCreatedAt, sourceRevision, lastFailureReason } }`. **236 BE-Suiten / 3166 Tests grün** (Vollsuite + detectOpenHandles, exit 0).
- **Correlation Status UI (P_CORR_1c.3) _(lokal)_:** Analyst-Deck spiegelt den persistenten Job-Zustand — **kein** synchrones `correlate()` im FE, **keine** zweite Korrelationsanzeige. Drei neue Module: `correlationStatusView.ts` (`extractCorrMeta` defensiv ohne Blind-Cast; `CorrProvenanceRender` diskriminiertes Union `{kind: 'meta'|'loading'|'failed_no_result'|'superseded'|'unavailable'|'none'}`; `deriveCorrProvenance()` reine Funktion); `CorrelationStatusBanner.tsx` (7-Zustands-Rendering: `current`/`pending`/`running`/`retrying+stale`/`failed+stale`/`failed_no_result`/`superseded`/`loading`/`unavailable`; `role="status"` für Screen-Reader; kein altes Resultat ohne Zeitstempel als aktuell); `useCorrelationPolling.ts` (Intent-API `{ status, result, resultCreatedAt, … }`, Polling nur bei aktivem Job, exponentielles Backoff, Cleanup bei Unmount, `correlationStatus` State für `AnalysisPage`). `AnalysisPage` verdrahtet Polling-State auf Banner. **37 neue FE-Tests** (correlationStatusView ~15 + Banner ~10 + polling ~12); FE tsc grün.
- **Overview rendert exklusiv aus materialisertem `correlationStatus.result` (P_CORR_1c.4) _(lokal)_:** `OverviewSection` rendert die Korrelations-Provenienz (`Korreliert aus N Events …`) **ausschließlich** aus `correlationStatus.result` — `ev.correlation` wird im Provenienz-Block **nicht mehr gelesen** (statisch durch Test erzwungen). `extractCorrMeta` schützt gegen unerwartete Formen (`result=null`/unbekanntes Objekt/primitiver Wert → kein Crash, neutraler Zustand). `ev.correlation` mit alten Werten + `result=null` → `GhostSource` erscheint **nicht** (Fallback-Trap geschlossen). `correlationStatus?: CorrelationStatusInfo`-Prop in `OverviewSection`; `AnalysisPage` reicht `correlationStatus` weiter. **13 FE-Tests** (7 Zustände + 3 Edge-Cases); FE tsc grün. **Schließt P_CORR_1 technisch ab** — vollständiger Weg: Mutation → persistenter Job → Queue → Worker → atomares Resultat → materialisierter Read-Pfad → Status-/Polling-UI → Overview aus `correlationStatus.result`.
- **Auto-Response / Notfall-Maßnahme — Rechtsgrundlage-Pflicht bei der Freigabe (Betriebsrat / Notfall):** privilegierte Response-Aktionen (Host isolieren / Isolation aufheben / privilegierter Command) bleiben **human-authorized, kein Auto-Exec** — und können jetzt **NUR mit dokumentierter Grundlage** freigegeben werden. `ResponseAction.approve(approverId, authorizationBasis)` verlangt eine nicht-leere `authorizationBasis` (z.B. „Betriebsrat-Zustimmung BR-2026-… / Notfall-Freigabe") zusätzlich zum bestehenden **Vier-Augen-Prinzip** (Genehmiger ≠ Anforderer); ohne Beleg → 400. Die Grundlage wird **auditiert** (der Befugnis-Nachweis), persistiert (Migration `041`, Postgres+InMemory). Frontend: der `ResponseActionsPanel`-Genehmigen-Button ist **deaktiviert, bis die Rechtsgrundlage eingetragen ist**; die Grundlage erscheint in der erledigten Karte. **Es wird weiterhin NICHTS real ausgeführt** (kein Agent, no-touch) — die echte Infrastruktur-Ausführung bliebe ein eigener, explizit freizugebender Slice. Passt zur Positionierung („keine *automatische* Bedrohungsentfernung"). 16 BE-Tests (Domain + Service, inkl. „ohne Grundlage → 400, bleibt requested") + FE 1005/tsc grün.
- **Bulk-Delete für Tickets (P_STABILITY_1 · Task 2) _(lokal)_:** echter admin-geschützter Sammel-Lösch-Endpunkt `POST /tickets/bulk-delete` — **EIN** Request + **EIN** atomares `DELETE … WHERE id = ANY($1::uuid[]) RETURNING id` statt N Einzel-Deletes (ein Round-Trip, transaktional). **Bounded** (max 100, jede ID UUID-validiert → schützt zugleich den Postgres-Cast → kein unbounded Delete), strikte **RBAC** (admin; analyst → 403), **idempotent** (zweiter Lauf `deleted:0/missing:N`, kein Fehler), **nachvollziehbares** Ergebnis `{requested, deleted, missing, deletedIds}` (kein Fake-Erfolg) + **EIN** Sammel-Audit-Eintrag `TICKET_BULK_DELETE` (Anzahl + gelöschte interne UUIDs, kein PII; kein Einzel-`TICKET_DELETE`-Spam). `deleteMany` in InMemory- **und** Postgres-Repo (Parität gewahrt). 10 BE-Tests (Erfolg/403/Teilmenge/Sammel-Audit/Dedup/Idempotenz/leer/Max-101/Nicht-UUID/fehlend); volle BE-Suite **207 Suiten / 3007 Tests grün**. **Offen:** Frontend-Wiring (Block 2b: Bulk-Auswahl → ein Request, Reload erst nach Antwort, sichtbarer Fehler statt Toast-only).
- **Bulk-Delete Frontend-Wiring (P_STABILITY_1 · Task 2b) _(lokal)_:** die Tickets-Liste nutzt den Sammel-Endpunkt — bei Mehrfach-Auswahl **ein** `POST /tickets/bulk-delete` (kein Delete-Loop, **kein** Reload pro Ticket), eigenes Bestätigungs-Modal, Buttons gesperrt + „Wird gelöscht …" während des Laufs, **danach genau einmal** `load()` (das leert auch die Auswahl). Ehrliche Ergebnis-Anzeige (`role="status"`): „X gelöscht" bzw. „X von Y gelöscht — Z nicht gefunden (bereits entfernt)" — **kein** Erfolgswording für nicht gelöschte Tickets. Bei API-/Netzwerkfehler: sichtbare Meldung im Modal (`role="alert"`), **Auswahl bleibt erhalten**, kein Reload, **kein** Fake-Erfolg. Einzel-Löschen unverändert (keine Regression). Neu: reines `bulkDeleteModel.ts` (`formatBulkDeleteResult`) + `ticketApi.bulkDelete`. 10 FE-Tests (Ergebnis-Modell + API-Vertrag + 5 Component-Verhaltenstests); **FE-Suite 91/1015 grün, tsc + Vite-Build sauber**.
- **DB-Pool-Härtung gegen festhängende Queries & Sättigung (P_STABILITY_1 · Task 3a) _(lokal)_:** der pg-Pool trägt jetzt harte Grenzen — `statement_timeout` (15 s, Postgres bricht serverseitig ab) + `query_timeout` (20 s, node-postgres clientseitig als Fallback) + `connectionTimeoutMillis` (3 s) → **keine Query blockiert unbegrenzt**, kein endloses Warten auf eine Verbindung. Pool-Config ist rein + ENV-überschreibbar (`buildPoolConfig`, eine Quelle, ohne Seiteneffekte → testbar). Neuer reiner `poolStats`-Helfer loggt strukturiert `pg_pool_saturated` (nur Zähler total/idle/waiting/max, **keine** Secrets) **bevor** die nächste Query blockiert — kein stiller Ausfall. 13 BE-Tests (Config-Defaults/ENV/SSL + Sättigungs-Logik).
- **Health vom API-Pool entkoppelt (P_STABILITY_1 · Task 3b) _(lokal)_:** `/api/v1/health` prüft die DB jetzt über einen **eigenen kleinen Health-Pool** (max 2, schnelle 2-s-Timeouts) statt über den API-Pool → ein gesättigter API-Pool kippt den Health-Status **nicht mehr fälschlich** auf `error`. Reiner, fehlersicherer Checker (`createDbHealthChecker`): **TTL-Cache** (viele /health-Aufrufe lösen nicht je einen DB-Ping aus), **Single-Flight** (gleichzeitige Aufrufe teilen einen laufenden Ping), **withTimeout** (hängender Ping → `error` statt Hänger); `check()` wirft nie. 7 BE-Tests (Cache/TTL/Fehler/Timeout/Single-Flight + defaultWithTimeout). Health-Route-Vertrag unverändert (`db: ok|error|not_configured`).
- **Observability-Baseline — wenige klare Stabilitäts-Signale (P_STABILITY_1 · Task 1) _(lokal)_:** das vorhandene `/metrics` (Prometheus, IP-gated) trägt jetzt die Werte, die beim nächsten Lastproblem **sofort den Engpass zeigen** — CPU/Event-Loop, RAM/Heap, DB-Pool, Queue oder Route. **Node-Runtime:** RSS · Heap used/total · external · uptime · `soc_event_loop_lag_seconds` (injizierbarer, `unref`'d Sampler) · Node-Version-Info. **HTTP:** `soc_http_requests_in_flight` (+ bestehende total/duration; Route normalisiert → **keine** UUID/Querystring/PII-Labels; Fehlerquote aus `status_code` ableitbar). **DB-Pool:** `soc_db_pool_connections{pool,state}` für API- **und** Health-Pool getrennt + `soc_db_pool_max` + Counter `soc_db_pool_saturation_warnings_total` (aus Task 3) + `soc_db_query_timeouts_total`. **Hintergrundarbeit:** `soc_integration_jobs_processed_total{result}` · `_in_flight` · `_last_success_timestamp_seconds` (über reinen `instrumentJob`-Wrapper; Queue-Verhalten unberührt). Werte werden **beim Scrape** gelesen (kein Dauer-Timer). Operator-Doku mit Schwellen + erster Maßnahme je Signal: `docs/07-operations/observability.md`. **18 neue BE-Tests** (eventLoopLag/runtimeMetrics/poolMetrics/instrumentJob/metricsMiddleware + Endpoint-Vertrag); volle Backend-Suite grün. **Befund (separat):** die Integration-Queue ist die synchrone In-Memory-Queue (pg-boss vorhanden, **unverdrahtet**); `InMemoryQueueService._jobs` wächst unbounded → Follow-up für P_STABILITY_2.
- **Container-Limits, Node-Heap-Grenze & Graceful Shutdown (P_STABILITY_1 · Task 4) _(lokal — Limits vorbereitet, NICHT ausgerollt)_:** schließt P_STABILITY_1 technisch ab. **Shutdown:** reiner `createGracefulShutdown` (fehler-isoliert, zeit­begrenzt via `SHUTDOWN_TIMEOUT_MS`, idempotent) fährt bei SIGTERM/SIGINT **alles geordnet** herunter — HTTP-Server → Poller (IMAP/CrowdSec) → Integration-Worker/Queue (neu: `stopWorker`) → DB-Pools (**API + Health**) → Event-Loop-Sampler; hängt ein Schritt → Force-Exit. **Limits (`deploy/docker-compose.prod.yml`, ENV-parametrisiert):** `deploy.resources.limits` für api/postgres/web + `stop_grace_period: 30s` + `NODE_OPTIONS=--max-old-space-size` — der **Node-Heap (Default 384 MB) liegt bewusst unter dem Container-RAM (Default 512 MB)**, damit Node sich bei Speicherdruck kontrolliert beendet (Heap-OOM) statt vom **Host-OOM-Killer** getroffen zu werden. **Keine Blind-Werte:** Operator-Doku `docs/07-operations/container-limits.md` mit Heap-≤-75 %-Regel, VM120-Mess-Anleitung („erst messen") und Tier-Tabelle. 6 neue BE-Tests (gracefulShutdown 4 + stopWorker 2); `server.js` per `node --check` geprüft (Composition Root, nicht test-abgedeckt); volle Backend-Suite grün. **Kein Push, kein Deploy.**
- **Bounded In-Memory-Queue + Queue-Metriken (P_STABILITY_2 · 3.1a) _(lokal)_:** der gefundene Memory-Leak ist geschlossen — `InMemoryQueueService._jobs` ist jetzt ein **bounded Ring** (Default 1000, Drop-oldest) statt unbegrenzt zu wachsen; monotone Zähler (enqueued/completed/failed) bleiben bound-unabhängig korrekt. Neu: `queue.stats()` (depth/running/…/oldestQueuedAgeMs/retained) im Queue-Interface (benigner 0-Default → der Metrik-Collector crasht nie) + `metrics/queueMetrics.js` → `soc_integration_queue_depth` / `_running` / `_oldest_age_seconds` (beim Scrape aus `integrationService.queueStats()`, fehler-sicher). 8 neue BE-Tests; bestehende Queue-Tests grün. **Ehrlicher Hinweis:** der produktive Pfad nutzt aktuell die (jetzt **bounded**) In-Memory-Queue; das Verdrahten der persistenten Queue ist Folgeblock **3.1b** — die vorhandene `PgBossQueueService` zielt auf eine **ältere pg-boss-API** (pg-boss ist `^12`) und braucht einen v12-Adapter (Batch-Handler/`createQueue`) **+ Live-DB-Verifikation** (Hard-Gate: erfordert Live-Postgres).
- **Poller-Overlap-Schutz (P_STABILITY_2 · 3.2) _(lokal)_:** neuer wiederverwendbarer `createPollLoop` — **Overlap-Guard** (läuft ein Poll noch, wird der nächste Tick übersprungen → **kein paralleles Anwachsen**), **Timeout** (hängender Lauf hart begrenzt, Default 2 min), **exponentieller Backoff** nach Fehlern (gedeckelt 5 min), **sichtbarer Status** (running/inFlight/lastSuccessAt/lastErrorAt/runs/failures/skipsOverlap/timeouts via `poller.status()`), **kein stiller Fehler** (jeder Fehlschlag geloggt + gezählt). `ImapPoller` + `CrowdsecPoller` ziehen ihn ein (`pollOnce` fachlich unverändert); der saubere Stop beim Shutdown ist bereits über Task 4 verdrahtet. 5 neue BE-Tests (Overlap/Timeout/Backoff/idempotent/Stop); bestehende Poller-Tests grün.
- **SOC-Metriken serverseitig aggregierbar (P_STABILITY_2 · 3.3) _(lokal)_:** der Risikopfad „große Ticketmengen in Node laden + mehrfach auswerten" ist gekapselt — die reine Aggregation liegt jetzt in `domain/socMetricsAggregate` (verbatim extrahiert, getestet); `SocMetricsService.getMetrics()` **delegiert an `repo.aggregateMetrics()`**. **Postgres** aggregiert in **SQL** (mehrere kleine GROUP-BY/`percentile_cont`-Queries statt Ticket-Vollscan → kein großer Heap-Load), **InMemory** bleibt der bounded Pfad (Dev/Test). Gleiche fachliche KPIs: die **32 Bestandstests laufen jetzt durch den Aggregations-Pfad** (Paritätsprobe). 8 neue BE-Tests (reines Modul + Delegation/Fallback). **⚠️ Live-Gate:** die Postgres-SQL-Aggregation ist gegen realistische Daten via **EXPLAIN + Parität zur InMemory-Referenz** zu verifizieren (kein lokaler DB-Test möglich); **keine voreiligen Indizes** (erst belegter Bedarf). _ADR folgt mit den größeren Architektur-Blöcken (P_CORR_1/P_DATA_1); `docs/adr/decisions.md` trägt unverwandte lokale Änderungen und wird hier bewusst nicht mit-committet._
- **Reproduzierbarer lokaler Lasttest (P_STABILITY_2 · 3.4) _(lokal)_:** `backend/scripts/loadtest/bulkDeleteLoad.js` — 300 Tickets seeden, dann **gleichzeitig** 100er-Bulk-Delete + 50 parallele Ticket-/SOC-Metrik-/Health-Requests; misst **echte** Werte (Latenz p50/p90/p99, Fehlerquote, Event-Loop-Lag, Heap/RSS, Queue-Stats, Health). **Gemessen (InMemory):** Fehlerquote **0**, Health bleibt **`ok`**, Heap 41→47 MB (**kein Leak**), Queue **bounded** (`maxRetained` 1000). Ergebnisse + ehrliche Caveats (kein DB-Pool im InMemory-Lauf · Lag-Sampling-Intervall · Rate-Limiter-Bypass nur für die Messung) in `docs/07-operations/loadtest-results.md`. **DB-Pool-Waiting/Sättigung** gehören in den **Pre-Deploy-Lasttest gegen echtes Postgres** (Live-Gate).

### Changed
- **Analysis-Tabs auf die verbindlichen High-Fidelity-Mockups gehoben (P_UX_3 · Mockup-Serie) _(lokal, 2026-06-23, HEAD `6105ad7`)_:** alle 12 Analysis-Tabs an die gelieferten Mockups angeglichen — pro Tab ein reines, **getestetes** Mapping-/Ableitungs-Modul + ehrliche Empty-/„nicht verfügbar"-Zustände, **keine erfundenen Daten, keine Backend-Änderung** (ADR-009). Jeweils tsc 0 + Vitest grün + Live-Preview gegen echtes Dev-Ticket **INC000006** (keine Konsolenfehler). Neue Feature-Module unter `features/analysis/{timeline,network,payloads,commands,entities,ki,notes,iocs,export,history,playbooks}/` (je Modell + Tests + View); inline Tab-Views + toter Code aus `AnalysisPage.tsx` entfernt.
  - **Overview** (`5ed7aec`): 2-spaltiges Preview-Dashboard (Evidence Preview · Event Preview · Top Conversations · Communication Map · Payload Preview mit Normalized/Parsed/Raw-Tabs · Event Timeline). Rail mit MITRE-/Confidence-Chips; **Decision Panel entfernt** (lebt im IoCs-Tab); 3 Nicht-Mockup-Karten raus; `GRID_3→GRID_2`.
  - **Timeline** (`649c8ff`): gruppierte Ermittlungs-Event-Timeline (Process/Script/File/Detection/Network/DNS) mit aufklappbaren Sub-Events + Quellen-Labels + Toolbar (Filter/Source/Type/Expand-all); reines `timelineModel.buildTimelineGroups`. Aus `AnalysisPage` in `features/analysis/timeline/` extrahiert (alte inline `TimelineTabView` + Helfer entfernt).
  - **Network & NAT** (`a91c3cb`): Communication Map (Source→Dest + External IPs + Metrik-Strip) · Top Conversations (Flows→bytes/lastSeen) · NAT Translation (Pre→Post, Passthrough) · Flow Statistics · Geolocation/Reputation · DNS; reines `networkModel`.
  - **Payloads** (`156750b`): Normalized Payload · Parsed Payload Fields · Indicators Found · Raw Event Snippet · Decoded Script/Extracted Strings (Tabs) · Payload Relationships; `payloadsModel` extrahiert URLs/Pfade/Run-Key deterministisch aus decoded/command.
  - **Commands** (`ad1bdd8`): Commands-Tabelle (Severity/Confidence qualitativ aus realen Signalen) · Execution Chain (Process Tree) · LOLBins (Namens-Matching→MITRE) · Interpreters · PowerShell Insights · Command Highlights; `commandsModel`.
  - **Entities** (`f5b317a`): deterministischer Relationship-Graph (SVG, observed vs inferred + Legende) · 6 Entity-Tabellen · MITRE-Linked Entities · Entities of Interest; `entitiesModel` (Confidence/Evidence aus Beobachtungstiefe, kein Verdict). NAT/Relationship-Altfunktionen entfernt (NAT lebt im Network-Tab).
  - **KI Analyse** (`9534ba5`): 9-Abfragen-Raster (`agentApi.propose`, echte kinds) · Ergebnis-Karten (AI Verdict · Evidence-backed Reasoning + MITRE · Confidence & Recommendation) · Extracted IOCs & Entities (Tabs) · Traceability · Analyst-Approval-Bar; `kiModel.buildKiIocRows`. KI-Disclaimer + Human-in-the-loop bleiben.
  - **Notes** (`2c27f06`, _Nutzerentscheid: frontend-only_): Notiz-Timeline + Editor (Typ Triage/Investigation/Internal/Customer, Markdown-Toolbar, Tags) + Recent Notes + Checkliste. Es gibt **kein Notes-Backend** → `notesModel` serialisiert jede Notiz als lesbaren, parsbaren Block ins bestehende `ticket.notes`-Feld (Autor=angemeldeter Analyst, Typ/Tags/Zeit real), rückwärtskompatibel mit Freitext/Customer-/Case-Note. `customerNotes`-Plumbing aus `AnalysisPage` entfernt (Customer = Notiz-Typ). Speicherfehler sichtbar (`role=alert`, P_TRUST_1).
  - **IoCs & Decision** (`bc624d4`, _Nutzerentscheid: Mockup + kritische Workflows behalten_): Stat-Strip (Counts je Typ + Risk Score) · IoC-Typ-Tabs · Evidence-backed Rationale · Recommended Blocks/Watchlist — die sicherheitsrelevanten **FP-Regel-Erstellung/Exception-Builder/Quick-FP/Wazuh-Tag/Enrich/Querverweise/Command-Deck bleiben erhalten**; `iocsModel` (Confidence aus Reputation). Watchlist vermerkt in Notizen (kein Fake-Block-Backend).
  - **Evidence Export** (`c054662`, _Nutzerentscheid: frontend-only_): Package Builder (Scope-Counts) · Export Options (**PDF/JSON/MD/TXT real**, JSON mit Chain-of-Custody/SHA-256; **CSV/ZIP „geplant"** deaktiviert) · Export Contents · Redaction & Sharing (Redaction deaktiviert; **TLP/Watermark real** in den Report-Header) · Preview/Summary; der Scope **filtert den Report wirklich**; `exportModel`. Save Template/Schedule deaktiviert (kein Backend).
  - **History** (`c70e073`): Case History/Activity Timeline aus dem echten **Audit-Log** + Activity Summary + **Audit-Integrität** (Design-Fakten: append-only · IP gehasht SHA-256 · nur Feldnamen — keine erfundene Tamper-Prüfung) + Revision History + Decision Timeline + **Change Details mit Before/After bewusst „nicht protokolliert"** (DSGVO loggt nur Feldnamen, keine Werte); `historyModel` erweitert. Aus `AnalysisPage` extrahiert.
  - **Playbooks** (`6105ad7`): Recommended Playbooks (echter Katalog, **keine** Fake-Match-%) · Selected Playbook (Affected Systems aus Entities) · Steps-Tabelle (Owner/Updated ehrlich „—") · Playbook Progress · Quick Actions (Export/Print real, Assign deaktiviert); `playbooksModel.playbookProgress`. Aus `AnalysisPage` extrahiert.
  - **Lesbarkeits-Fixes** (`f593b2b`, `0f1db42`): dunkle Codeblöcke (Raw Event Snippet/Decoded/Command Deck) lagen im hellen Workspace dunkel-auf-dunkel (`--bg-terminal #0c1622` + dunkler `--text`) → auf helle Fläche (`--bg-card-soft` + `--border`) umgestellt, hoher Kontrast.
  - **Offen:** **Report**-Tab (noch nicht am Mockup). Noch dunkle Terminal-Blöcke außerhalb der Serie: `EvidenceView`, `deck/OverviewSection` (2×), `WazuhExceptionBuilderModal`.
- **Analysis-Detail-Tabs als echte Ermittlungsansichten (P_UX_2 · Tab-Serie) _(lokal, 2026-06-23, HEAD `64d8137`)_:** alle Haupt-Tabs der Analysis-Workbench auf den hellen Workbench-Stil + echte `ticketEvidence`-Quelle gehoben. **Gemeinsamer Workbench-Branch** `timeline | network | commands | payloads | entities` (geteilter volle-Breite Case Header + Context-Rail + Analyst Notes, nur Hauptinhalt wechselt — DRY); **eigene Branches** für `ki_analysis` (KI-Rail) und `evidence` (4-Zonen). Pro Tab ein reines, getestetes Mapping-Modul + ehrliche Empty-/„Nicht verfügbar"-Zustände, **keine Fakes, keine Backend-Änderung**:
  - **Daten-Hebel `ticketEvidence.ts`:** `buildEvidence` aus reinem Modul extrahiert + angereichert — die API liefert hostname/user/port/protocol/hash/process/postNat… mit, der Frontend-`Ticket`-Typ deklarierte sie nur nicht. Jetzt füllen sich Event Details, Network/NAT, Header-Host/User real. **NAT-Label-Fix:** „Outbound IP (Public)" = echte `postNatSourceIp` statt fälschlich `dstIp`. Wirkt in Overview/Timeline/Network/Commands/Payloads/Entities/KI gleichzeitig.
  - **Network & NAT** (`network/NetworkNatView.tsx`): Connection-Kette als Hero (Internal → Post-NAT/Public → External, NAT-Knoten nur bei echter Post-NAT-IP) + Traffic Summary + aufklappbare Network Events + NAT & Firewall Context.
  - **KI Analyse** (`ki/KiAnalysisView.tsx`): operative Ansicht aus echter `AgentAnalysis` (agentApi) — KI Assessment (bestätigte Fakten vs. KI-Einschätzung, klar markiert) · Investigation Questions · Recommended Actions (Human-in-the-loop Approval) · Evidence used by KI · KI-Rail (Modell/Confidence/Coverage/Approval). Ehrlicher „Analyse starten"-Empty-State.
  - **Commands** (`commands/{commandsModel,CommandsView}`): Command Summary + aufklappbare Command-Liste (Image/CommandLine/Parent/Hash/MITRE, sichere Umbrüche + Copy, Decoded rot), Prozesskette nur bei echtem Parent.
  - **Payloads** (`payloads/{payloadsModel,PayloadsView}`): Artifact Summary + Artefakt-Liste (File/Hash/URL/Domain/Process), Hashes kopierbar, „Keine Reputation verfügbar" (kein TI erfunden), kein Registry-Artefakt (ParsedEvidence trägt keine Registry-Daten).
  - **Entities** (`entities/{entitiesModel,EntitiesView}`): Entity Summary + Hosts & Identities + Network Identities (NAT-Kette) + Processes & Domains + Relationship-Kette (nur reale Knoten), kopierbare Werte.
  - **Evidence** (`evidence/{evidenceProvenance,evidenceRecordsModel,EvidenceView}`): **Master-Detail-Browser** nach verbindlichem Mockup — Filter · Records-Liste · Detail (Overview · Process/Network/File Information · Custody · **Raw JSON nur aufklappbar + Copy**) · Context-Rail. Records vereinheitlicht aus geparstem Primär-Event + gesicherten Snapshots + Timeline-Flows; klare Herkunft (Wazuh/OPNsense/manuell importiert). Löst alte `EvidenceTab` + `StoredEvidenceList` ab.
  - **Aufräumen:** alte Deck-Sektionen entfernt (NetworkNatSection · KiAnalysisSection · CommandsSection · PayloadsSection · EntitiesSection · EvidenceTab · StoredEvidenceList) — kein toter Code. **35 neue Unit-Tests** über die Mapping-Module. **Gesamt: tsc 0 · 184 Analysis-Vitest + 2 E2E · Vite-Build grün.** Dev-Stack-Verifikation an 3 echten Dev-Tickets (INC000004/05/06). **Offen (Reihenfolge):** Report → Notes → IoCs & Decision → Evidence Export → History → Playbooks (liegen noch im alten generischen 340px-Enrichment-Grid).
- **Analysis → Overview als Investigation-Workbench (P_UX_1 · Overview) _(lokal, 2026-06-22)_:** die Analyse-Übersicht komplett neu strukturiert — **globaler Header-Ticket-Switcher** (`ActiveTicketSwitcher` via neuem `HeaderSlot`-Mechanismus: Seite injiziert Inhalt in die globale Topbar, ohne sie für alle Seiten umzubauen) zwischen Suche und rechten Icons: Ticket-ID · Severity · Host/Kontext · Dropdown (Suche + Ticketliste + „Alle Tickets öffnen") · ←/→. **Quelle der Wahrheit bleibt `?ticket=`** (Switcher + AnalysisPage synchron) — die alte linke Ticketliste im Content ist entfernt. Neue **horizontale Analysis-Top-Nav** (alle 14 Tabs, Icons, scrollbar, aktiv = blau + Underline) ersetzt die linke Subnav. Workbench: **Case Header über volle Breite** + **3×3 Investigation-Grid** (Quick Evidence · Event Details · Payload / Communication & Network · Communication Map · Network-NAT / Timeline & Correlation · Correlation Summary · Investigation Context) + rechte **Decision Rail** (Analyst Summary · Decision Panel · Risk & Impact · Threat Intel · Evidence Actions). Layout 78/22. Nur echte Daten + ehrliche `—`/Empty-States; `superseded` ≠ Fehler; nicht vorhandene Aktionen (Mark Important / Follow-up) **disabled** statt fake. Robustheit: `evidence` + `timeline` werden mit Defaults normalisiert, bevor Cards sie lesen → kein Crash bei partieller Server-Antwort. Kleine Komponenten statt Riesen-Datei (`features/analysis/overview/{overviewUi,OverviewCards,OverviewRail,CaseHeader,OverviewWorkbench}.tsx`). **Tests:** 5 neue Overview-Unit-Tests (ehrliche Empty-States · Footer-Link · `superseded` ≠ Fehler) + Playwright-Flow `e2e/analysis-overview.spec.ts` (Switcher · Top-Nav aktiv · Case Header · Grid · Rail · Dropdown). tsc 0 · 149 Analysis-Vitest + 2 E2E grün.
- **Light Investigation Workspace + dunkle Navy-Sidebar (P_UX_1 · Theme) _(lokal, 2026-06-22)_:** verbindliche visuelle Sprache umgesetzt — **heller Main-Workspace** (`--bg #f8fafd`, nahezu weiß mit minimal kühlem Stich), **weiße Cards** (`--bg-card #fff`), feine blaugraue Borders (`--border #d8e0ea`), Nexora-Blue-Akzent (`#2f6bed`), gedeckte Status-Farben (Critical rot · Need-More orange · Open grün), sehr dezente Schatten. **Sidebar bleibt dunkles Navy** — Dark-Tokens nur auf `.sidebar` gescopt (`tokens.css` ist hell für die ganze App, der Rest erbt). Header/Top-Nav weiß. CaseHeader: weiß, rotes Shield + subtile Severity-Akzentlinie (kein dicker Rahmen, kein dunkler Grund). Decision-Panel-Buttons gefüllt (Confirm Suspicious rot · Need More orange), Rest weiß/outline. Keine Neon-/Lila-/Cyan-Card-Borders, keine dunkelblaue Analysis-Fläche. _(Zwischenschritt: eine dunkle „geschichtete" Variante wurde verworfen; helle Referenz ist final.)_ Dashboard als globaler Regressionscheck sauber.
- **Analysis → Timeline als Workbench (P_UX_1 · Timeline) _(lokal, 2026-06-22)_:** Timeline-Seite auf das Workbench-Layout gehoben — **Case Header über volle Breite** (über Timeline + Rail), darunter Grid **`1fr` Timeline (~70 %) + `300px` Context-Rail** (gap 18). Links: breite Investigation Timeline + **Analyst Notes** (am Ticket gespeichert). Rechte Rail: Analyst Summary · Risk & Impact · Evidence & Context · Quick Actions (Collect/Add-Evidence/Export) · Related Cases (Cross-Ref on-demand). `TimelineTabView` aufgewertet: **Filterleiste** (Suche · Typ · Quelle), Events + NetworkConnect-Flows vereinheitlicht/sortiert, **vertikale Zeitachse**, **Load-more**, ehrliche Empty-States (Indexer nicht verbunden → kein Fake). Keine zweite Ticketliste; Ticketwahl bleibt allein im Header-Dropdown. tsc 0 · 149 Vitest + 2 E2E · Vite-Build grün.
- **Sidebar: lange Navigation scrollt intern (P_UX_1 · Fix) _(lokal, 2026-06-22)_:** `.sidebar-nav` bekam `min-height: 0; overflow-y: auto` — bei vielen Nav-Einträgen lief die Liste über die Fensterhöhe hinaus und schob „Profile"/„Sidebar einklappen" in den Footer-Bereich. Jetzt scrollt die Navigation **innerhalb** der Sidebar, der Collapse-Button bleibt unten gepinnt. Reiner CSS-Layout-Fix.
- **Dev-Befund aus dem Real-Ticket-Review (P_UX_1 · Findings, kein Code) _(lokal, 2026-06-22)_:** beim Befüllen von 3 realistischen Dev-Tickets (Host/Sysmon · Firewall-NAT · Web/Exploit) per API + DOM-Auslesung der Card-Felder belegt: (1) **`buildEvidence(ticket)` mappt nur wenige Felder** (Titel/Source/Severity/srcIp/dstIp) → Event Details (Hash/Process), Network-NAT (postNat/extIp) und Header-Host/User bleiben leer, obwohl das Ticket die Daten trägt; (2) **Network/NAT-Summary labelt `dstIp` als „Outbound IP (Public)"** (irreführend, ignoriert echte NAT-Felder); (3) **Timeline/Network-Cards hängen am Wazuh-Indexer** (`source==='wazuh'` + Indexer) → lokal ehrlich leer. Höchster nächster Hebel: `buildEvidence` anreichern + NAT-Label fixen. _Nur dokumentiert, noch nicht umgesetzt._

### Fixed
- **AnalysisPage: Speicherfehler sichtbar statt verschluckt (P_TRUST_1 · A1) _(lokal)_:** die drei Analyse-Saves (`saveAnalysis` / `saveAnalystState` / `saveCustomerNotes`) verschluckten Fehler in `catch { /* weicher Fehler */ }` → **Fake-Erfolg** (UI suggerierte „gespeichert", obwohl der PUT scheiterte). Jetzt setzen sie einen sichtbaren `saveError`, der im Notes- **und** Playbook-Deck als `role="alert"` erscheint („Nicht gespeichert: …") — **kein stiller catch** mehr. Der irreführende Hinweis „Checkliste wird automatisch gespeichert" ist ehrlich gemacht (Speicherfehler erscheinen oben). Der Customer-Notes-Entwurf bleibt bei Fehler im Feld erhalten (kein Datenverlust). `NotesTabView`/`PlaybooksTabView` für den Test exportiert; 3 neue FE-Tests (Fehler sichtbar / kein Fehler ohne / Save-Handler), tsc grün.
- **HuntLibrary: „Hunt starten" startet die Hunt wirklich (P_TRUST_1 · A2) _(lokal)_:** `launch()` rief nur `createSession()` (Draft) und navigierte — `start()` fehlte → die Hunt lief **nie** (Fake-Erfolg, keine Logs/Findings/Status). Orchestrierung in reines `features/hunts/launchHunt.ts` extrahiert: Session anlegen → **`start()`** → navigieren; ohne Session-ID ein klarer Fehler (kein stiller Draft), `start()`-Fehler propagieren in den bereits sichtbaren `launchError`. 3 neue FE-Tests (startet/keine-ID/Fehler-propagiert), tsc grün.
- **HuntConsole: Notes-Vertrag repariert — kein `[object Object]` (P_TRUST_1 · A3) _(lokal)_:** das Backend liefert Notizen als **append-only `HuntNote[]`** (id/content/createdAt), das FE behandelte sie als String (`setNotes(n.data ?? '')`) → `[object Object]` im Textfeld, nach Reload unlesbar. Jetzt korrekt: `huntApi.getNotes` → `HuntNote[]`, `saveNotes` → `HuntNote`; neues `HuntNotesPanel` zeigt die Notizen als **zeitgestempelte, lesbare Liste** + „Notiz hinzufügen" (analyst+, POST → Reload, append-only). `HuntConsolePage`/`HuntConsole` auf `HuntNote[]` umgestellt (Blob-Textarea entfernt). 4 neue FE-Tests (Inhalt lesbar / leer / hinzufügen / viewer-read-only), tsc grün.
- **Evidence-Export: Audit + echter Custody-Zeitpunkt + Actor (P_TRUST_1 · A4) _(lokal)_:** `GET /evidence/export` schrieb **keinen** Audit-Eintrag, und der „Exported"-Schritt der Chain of Custody war hartkodiert `null`. Jetzt protokolliert der Export **pro Item ein `exported`-Custody-Event** (echter Zeitstempel + Actor — `exported` als neue gültige `CUSTODY_ACTION`) und schreibt einen **Audit-Eintrag** `evidence.export` (Actor + Anzahl + Integritäts-Flag, Art. 32 DSGVO). Der FE-Stepper liest jetzt den realen Zeitpunkt (`custodyAt('exported')`) statt `null`. 2 neue BE-Tests (Audit+Custody / 400 ohne ticketId).
- **Evidence-Export jetzt POST statt GET (P_TRUST_1 · A4b) _(lokal)_:** Ein `GET` darf keinen dauerhaften forensischen Zustand erzeugen. Der Export (Custody-Event + Audit aus A4) läuft jetzt über **`POST /evidence/export`** (Body `{ ticketId }`) statt als Seiteneffekt eines GET. FE-Client + beide Aufrufer (Analysis / Evidence-Center) auf POST umgestellt; API-Contract- und Export-Tests angepasst.
- **Autonomy-Policies: CRUD auditiert + Delete-State-Fix (P_TRUST_1 · A5) _(lokal)_:** Create/Update/Delete von Autonomy-Policies (sicherheitskritische Konfiguration, ADR-016) schrieben **keinen** Audit-Eintrag. Jetzt schreibt jede der drei Routen einen Audit-Eintrag (`AUTONOMY_POLICY_CREATED`/`_UPDATED`/`_DELETED`, Actor + Policy-ID + nur **sichere Metadaten** — actionClass/mode bzw. nur Feldnamen, keine Werte). FE: `handleDelete` setzt `deleteBusy` jetzt im **`finally`** zurück (vorher hing der „Löschen …"-Button nach dem Erfolgsfall beim nächsten Modal). 1 neuer BE-Test (CRUD-Audit); bestehende Autonomy-Tests grün.
- **Audit-Log: serverseitige Suche + echte Pagination (P_TRUST_1 · A6a) _(lokal)_:** Die Suche filterte bisher **nur die geladenen 50 Einträge** im Client → forensisch falsche Negativ-Treffer. Jetzt geht die Suche ans Backend: `GET /audit?search=` filtert **serverseitig** über die erlaubten Felder **Actor / Action / Target-Typ / Target-Referenz** (parametrisiertes `LIKE`, kein String-Concat, auf 200 Zeichen gedeckelt) über die **gesamte** Menge. Die Antwort liefert explizite Pagination-Metadaten `total / page / pageSize / hasNext / hasPrevious`; Suche und Filter wirken zusammen. FE: debounced, Offset-Reset bei Suche, Loading-Signal + gedimmte Tabelle (keine veralteten Zeilen als „aktuell"), Export nutzt denselben Server-Filter. Tests: InMemory- **und** Postgres-Repo-Vertrag (parametrisiert) + Route (Server-Filter + Metadaten). Nebenfunde bewusst getrennt → A6b (Action-Filter/targetId-UI), A6c (Export-Limit/Truncation).
- **Threat-Hunts Cancel-RBAC: Doku ehrlich gemacht (P_TRUST_1 · A7) _(lokal, doc-only)_:** Untersuchung ergab: `huntApi.cancel` ist **in keiner UI verdrahtet** (kein Live-Button → kein analyst-403-Mismatch). Der RBAC-Header in `hunts.js` behauptete fälschlich „analyst → lifecycle auf eigene Sessions"; tatsächlich — und per `tests/api/hunts.test.js` fixiert — gilt: **cancel/fail = admin-only**, **complete = analyst+ ohne Ownership-Prüfung**. Header + api-client-Kommentar an die implementierte, getestete Policy angeglichen (`huntApi.cancel` als admin-only markiert — nicht an `canAct` hängen). **Keine Verhaltens- oder Auth-Änderung**; Ownership-Enforcement bewusst nicht eingebaut (Operator-Entscheidung).
- **Hosts: Heartbeat-Verlauf ehrlich „nicht verfügbar" (P_TRUST_1 · A8) _(lokal, FE-only)_:** Die „Heartbeat (letzte 24h)"-Sparkline bekam **immer `[]`** — `mapAgent` (einzige Quelle echter Hosts) füllt `heartbeatHistory` nie, weil die Wazuh-API nur `lastKeepAlive` (einen Zeitpunkt) liefert, **keine** 24h-Zeitreihe. Statt eines leeren Fake-Charts zeigt die `HeartbeatCard` jetzt einen ehrlichen Hinweis („Heartbeat-Verlauf nicht verfügbar — … nur der letzte Check-in …") plus den echten letzten Check-in. Der Sparkline-Pfad bleibt für eine künftige echte Quelle erhalten (kein Dead Code); Typ-Kommentar entsprechend ehrlich gemacht.
- **Silent-Catch-Sweep: verschluckte Fehler sichtbar gemacht (P_TRUST_1 · B) _(lokal, FE-only)_:** Stille `catch { /* weicher Fehler */ }` in nutzer-initiierten Aktionen durch sichtbares Feedback ersetzt — **Analysis** (8 Stellen: Cross-Reference, IoC-/TI-Enrichment, Evidence-Export, Snapshot/TI-Evidence speichern, IoC-Row „Add as Evidence", Command-Output-Evidence) über einen geteilten `role="alert"`-Banner bzw. lokale Meldungen; **Use Case Developer** (Draft öffnen → `setMsg`); **Settings / API-Tokens** (Token-**Revoke** — sicherheitsrelevant — schlägt nicht mehr still fehl); **KI-Agent / Settings** (Provider-Reload → `errMsg`). Bewusst belassen **und dokumentiert**: konservative sichere Degradierung (Wazuh-Exception-Builder deaktiviert `Apply` bei Lade-Fehler — kein blindes Wazuh-Write), legitime Soft-Fails (optionale KI-Metriken, JWT-Profil-Fallback, `reachable=false`-Signal). tsc + volle FE-Suite grün.
- **Audit-Export: Trunkierung sichtbar + Export auditiert (P_TRUST_1.1 · A6c) _(lokal)_:** Der CSV/PDF-Export holte still bis 5000 Einträge — bei mehr wurde **stillschweigend gekürzt** (forensisches Vertrauensproblem). Jetzt: dedizierter **`POST /audit/export`** (analyst+, gedeckelt auf `AUDIT_EXPORT_MAX`, Operator-konfigurierbar via ENV, Default 5000) liefert `truncated / total / returned / exportLimit` **und schreibt einen Audit-Eintrag** `AUDIT_EXPORT` (Actor, Format, Anzahl, `truncated`, Filter-**Präsenz** — kein Suchbegriff/PII). FE zeigt bei Kürzung einen sichtbaren Warn-Banner („Export auf N von M begrenzt …"). Damit belegt auch das immutable Audit-Log selbst jede gekürzte Ausleitung. 6 neue BE-Tests + FE-Contract-Test. **A6b** (Action-Filter/`targetId`-UI) bleibt als kleiner Folge-Block offen.
- **Abmelden / User-Menü oben rechts:** der „user-chip" in der Topbar (Avatar + Name + Chevron) war ein **toter Button** — kein `onClick`, kein Menü → es gab **keinen funktionierenden Logout in der App** (nur Idle-Logout + der erzwungene Passwort-Wechsel-Screen). Jetzt öffnet der Chip ein **Dropdown-Menü** mit **Profil** + **Abmelden** (POST `/auth/logout` → Login-Seite); schließt bei Klick außerhalb + ESC, ARIA-`menu`. _(Befund aus dem Live-Test.)_

### Added
- **MFA-Enrollment: echter QR-Code _(lokal)_:** die TOTP-Einrichtungs-Card (`MfaSecurityCard`) rendert die `otpauth://`-URI jetzt als **scanbaren QR-Code** (`qrcode.react`, SVG, weißer Hintergrund + Quiet-Zone → zuverlässig scanbar trotz Dark-Theme) statt nur Schlüssel/URI zum manuellen Abtippen. Hinweistext ehrlich angepasst („Scanne den QR-Code … oder trage den Schlüssel manuell ein"). Schlüssel + URI bleiben als Fallback (manuelle Eingabe / App-Import). Befund aus dem Live-Test. tsc + 33 mfaView-Tests grün.
- **NIS2-Readiness — Review-Kadenz / Stale-Evidence-Signal `reviewDue` (P_NIS2_3) _(lokal)_:** vertieft die Nachweisführung um **Aktualität**: ein `addressed`-Control **mit** Evidence, dessen letzter Review älter als die Kadenz (Default 365 Tage, pro Service konfigurierbar) ist, gilt als `reviewDue` — der Nachweis ist auditrechtlich nicht mehr belastbar. Konservativ: nur bei **gesetztem** `lastReviewedAt` (kein Fehlalarm für „nie reviewed" — das deckt `needsReview` ab); `addressed` ohne Evidence bleibt `needsReview`, nicht `reviewDue`. In `computeFlags` (rückwärtskompatible optionale Params) + Readiness- und Management-Report-Summary (`reviewDue`-Aggregat). Frontend: `controlSignal`-Badge **„Review fällig"** (nach den dringenderen Signalen) + `reportControlTone` warning. 7 BE-Tests (computeFlags-Matrix + Summary) + 2 FE-View-Tests; NIS2 6 BE-Suiten/70 + FE-compliance 50 grün. **+ Summary-KPI-Card „Review fällig"** in beiden KPI-Sektionen (Readiness + Management-Report) der `Nis2ReadinessPage`.
- **WebAuthn/Passkey — Wiring + Routen + Frontend (Slice 2c/2d) _(lokal, ENV-gated inert)_:** Passkeys end-to-end nutzbar (sobald `WEBAUTHN_ENABLED=true`). **2c (Backend):** `@simplewebauthn/server@13` (lazy require wie jose) verifiziert Attestation/Assertion; `webAuthnInstance.js` adaptiert die Lib (Uint8Array↔base64url) auf die schlanke Service-Shape + verdrahtet geteilte Credential-/User-Repo-Instanzen. Routen-Factory `/auth/webauthn/{status,register/options,register/verify,login/options,login/verify,credentials}` (DI-testbar): Ceremony-Zustand im kurzlebigen signierten httpOnly-Cookie `purpose:webauthn_flow` (sameSite=strict, one-time-use), register-Routen `requireAuth` + Flow-Bindung `flow.userId===req.user.sub`, login pre-session, einheitlicher 401. `app.js`-Mount `/auth/webauthn` (vor `/auth`), `verifyToken` lehnt `webauthn_flow` ab, Migration `040` läuft beim Boot. Compose-Passthrough `WEBAUTHN_*` (+ nachgeholt `NOTIFY_SMTP_*`/`NOTIFY_EMAIL_*`/`OIDC_*`). **2d (Frontend):** `@simplewebauthn/browser`, `webauthnLogin.ts` (status/login/register/list/delete), Passkey-Button in der LoginPage (nur wenn `/status` enabled + Browser-Support), self-gating `WebAuthnCard` in der ProfilePage (Enroll/Liste/Löschen). **Korrektheits-Fix:** `buildRegistrationOptions` kodiert `user.id` als base64url (WebAuthn-JSON-Vertrag). 50 neue Tests (BE 44 inkl. Route + FE 6); BE-Voll-Suite + FE tsc/Vitest grün. **Offen:** Live-Smoke gegen echten Authenticator (nicht headless verifizierbar) nach Aktivierung; SettingsPage:801-Toggle bleibt vorerst Platzhalter (echte UI ist die ProfilePage-Card).
- **WebAuthn/Passkey — Ceremony-Service (Slice 2b) _(lokal, noch nicht verdrahtet/deployt)_:** `webAuthnService.js` orchestriert Registrierung + Anmeldung **netz-/krypto-frei** — die kryptografische Verifikation (`verifyRegistration`/`verifyAuthentication`) ist **injiziert** (Prod-Wiring = `@simplewebauthn/server`), die Options/Challenge baut der reine `webauthnClient` (Slice 1). Gleicher Split wie OIDC (Client + jose). `beginRegistration` (excludeCredentials aus Bestand) → `finishRegistration` (speichert nur bei `verified`) · `beginAuthentication` (usernamelos) → `finishAuthentication` (Credential auflösen → Assertion-Verify → **Counter-Clone-Check** [Zähler muss steigen] → updateCounter → `authService._issueSession`). **Härtung:** einheitlicher, nicht-diskriminierender Fehler für alle Auth-Fehlerpfade (Grund nur serverseitig geloggt), inaktive User abgewiesen. 11 Tests (Register-/Auth-Flow + Clone-/Unknown-/Inactive-/Gate-Pfade + Generic-Error-Leak-Guard). Routen `/auth/webauthn/*` + `@simplewebauthn`-Wiring + Frontend = Slice 2c/2d.
- **WebAuthn/Passkey — Credential-Storage (Slice 2a) _(lokal, noch nicht verdrahtet/deployt)_:** `WebAuthnCredential`-Domain (ein User → mehrere Authenticatoren; `credentialId`/`publicKey` sind per WebAuthn-Design öffentlich, `toPublicJSON` lässt sie für die Listing-Sicht trotzdem weg) + InMemory/Postgres-Repo (Vertrag: `create` [unique credentialId], `findByUserId`, `findByCredentialId`, `updateCounter` [Clone-Erkennung-Zähler + lastUsedAt], `deleteById` **ownership-scoped**) + Factory (`DB_ENABLED`→Postgres) + Migration `040_webauthn_credentials.sql` (additiv/idempotent, FK→users CASCADE, `credential_id` UNIQUE). 11 Tests (Domain + InMemory-Vertrag + Postgres-Row-Mapping). Ceremony-Service (`@simplewebauthn/server`) + Routen + Frontend folgen als Slice 2b/2c.
- **WebAuthn/Passkey-Fundament (FIDO2) — Security-Welle 3, Slice 1 _(lokal, noch nicht verdrahtet/deployt)_:** `backend/src/auth/webauthn/webauthnClient.js` — reine, netz-freie Kern-Logik der Ceremony-„Request-Seite": **Challenge** (base64url, Replay-Schutz) · `buildRegistrationOptions` (PublicKeyCredentialCreationOptions: ES256/-7 + RS256/-257, `attestation:none`, excludeCredentials-Mapping, `authenticatorSelection`) · `buildAuthenticationOptions` (allowCredentials-Mapping, usernamelos-fähig) · **clientData-Prüfung** (`type`/`challenge`/`origin` — Replay-/Phishing-Schutz). ENV-gated `config.webauthn` (`WEBAUTHN_ENABLED` default aus; `rpId`/`origin`/`rpName`/`timeoutMs`). **Bewusst kein Route-/User-/Migration-/UI-Touch** — die kryptografische Attestation-/Assertion-Prüfung (COSE/Counter/RP-ID-Hash) folgt im Wiring-Slice über `@simplewebauthn/server` (injiziert, analog zu jose bei OIDC); ergänzt das vorhandene TOTP-MFA, ersetzt es nicht. 14 Tests. `validateClientDataExpectations` ist bewusst NUR die clientData-Ebene — Signatur zuerst (Wiring-Slice).
- **SSO/OIDC-Fundament (Authorization Code + PKCE) — Security-Welle 3, Slice 1 _(lokal, noch nicht verdrahtet/deployt)_:** `backend/src/auth/oidc/oidcClient.js` — reine, netz-freie Kern-Logik der Login-„Request-Seite": **PKCE** (RFC 7636, Methode S256, base64url) · `state`/`nonce` (CSRF-/Replay-Schutz) · Authorization-URL-Bau (Leerzeichen als `%20` normalisiert für strikte IdPs wie Entra) · **Discovery-Parsing** (erzwingt https-Endpoints — kein TLS-Downgrade) · **ID-Token-Claim-Prüfung** (iss/aud/exp/iat/nonce/sub, Uhren-Drift-Toleranz). ENV-gated `config.oidc` (`OIDC_ENABLED` default aus; Client-Secret strikt backend-only; Default-Rolle `viewer` = PoLA; `allowSignup` default aus → nur Linking bestehender Accounts). **Bewusst kein Route-/User-/Migration-/UI-Touch** — Signatur-Prüfung gegen JWKS (jose) + Token-Tausch + Callback-Routen + Account-Linking folgen als Slice 2, der Passwort-Login bleibt parallel. 20 Tests (PKCE gegen Recompute verifiziert, https-Zwang, Claim-Mismatches). `validateIdTokenClaims` ist bewusst NUR die Claim-Ebene — Signatur zuerst (Slice 2).
- **E-Mail/SMTP-Benachrichtigungskanal:** E-Mail als vierter Outbound-Kanal — baut auf demselben `notificationOutbound`-Dispatcher auf wie Slack/Webhook/Teams. Reiner `buildEmailPayload` (Subject `[SEVERITY] Titel` + Text-Body mit Quelle/Zeit, kein Secret). SMTP-Versand per `nodemailer` (**lazy geladen** → Modul bleibt ohne konfigurierten E-Mail-Kanal inert), 5-s-Timeout, injizierbarer `sendMail` (DI für Tests, kein echter SMTP im Test). `deliverOutbound` auf Versand-Thunks umgebaut, damit Webhook-POST und SMTP denselben best-effort-Loop teilen (ein Kanal-Fehler bricht die anderen nicht; **Creds/URLs nie in Logs oder Rückgabe**). Kanal aktiv nur bei `NOTIFICATIONS_OUTBOUND_ENABLED=true` **und** gesetztem `NOTIFY_SMTP_HOST`+`NOTIFY_EMAIL_TO` (optional `NOTIFY_SMTP_PORT`/`SECURE`/`USER`/`PASS`, `NOTIFY_EMAIL_FROM`). `GET /notifications/channels` meldet `email.configured` (nur Boolean, SMTP bleibt backend-only); Frontend: echte `EmailChannelCard` (aktiv/konfiguriert/nicht-konfiguriert) ersetzt den „geplant"-Platzhalter. 13 BE-Tests (buildEmailPayload + Kanal + Secret-Leak-Guards) + Channels-Route-Test, FE tsc/Vitest grün.
- **Reports-MVP — Incident- + Kunden-Report-Generator mit PDF _(`057f167`)_:** zwei Report-Perspektiven aus denselben Ticket-Daten. **Incident-Report** technisch (Übersicht, Analyst-Zusammenfassung, Entities, Timeline, MITRE, Decision/Empfehlung); **Kunden-Report** nicht-technisch in Kunden-Sprache (Schweregrad/Status), **bewusst OHNE IP/MITRE/IOC/Raw-Leak** (per Test erzwungen). Reine, getestete Modelle (`reportModel.ts`) + A4-PDF-Renderer (`reportPdf.ts`, jsPDF dynamisch geladen → Bundle-Split). Zwei Buttons im Report-Tab. 8 Tests.
- **Microsoft-Teams-Benachrichtigungskanal _(`2291d7d`)_:** Teams als dritter Outbound-Kanal (Legacy MessageCard, Severity→themeColor, Fakten Schweregrad/Quelle/Zeit); `GET /notifications/channels` meldet `teams.configured` (nur Boolean, URL bleibt backend-only). Frontend: echte `TeamsChannelCard` (aktiv/konfiguriert/nicht-konfiguriert) statt „geplant". **Bonus-Fix:** der Prod-Compose reichte die `NOTIFY_*`-Variablen + `NOTIFICATIONS_OUTBOUND_ENABLED` gar nicht durch → Slack/Webhook waren ebenfalls un-deploybar; jetzt alle ergänzt. 11 Tests.
- **Outbound-Status-Sync ServiceNow/OTRS `updateTicketStatus` _(`2b32f0c`)_:** Status eines bereits exportierten Tickets ins externe System spiegeln (ServiceNow PATCH `/table/{sys_id}`, OTRS `TicketUpdate`); Service-Methode `syncStatus` (findet gespeicherten ExternalLink, auditiert Erfolg/Fehler gekapselt) + Route `POST /tickets/:id/export/sync-status`. War zuvor Stub („nicht implementiert P12.4"). 9 Tests.
- **Persistenter ThreatIntel-Postgres-Cache _(`516831c`)_:** `PostgresThreatIntelCache` (lazy `threat_intel_cache`-Tabelle, Upsert + Ablauf-Prüfung) + Factory (`DB_ENABLED` → Postgres, sonst InMemory). TI-Reputation überlebt jetzt Neustarts statt bei jedem Boot neu von den Providern geholt zu werden (Quota/Latenz). War zuvor Stub. 6 Tests.
- **E2E gegen echtes Backend + CI-Ausbau _(`394b22d`)_:** neue Playwright-Konfig (`playwright.real.config.ts`) fährt das Express-Backend im InMemory-Modus (ENV-geseedeter Admin, kein Postgres) + Vite-Proxy und testet die **echten** Auth-/RBAC-Flows (RequireAuth-Redirect, echter Login→Session, echte 401, Cookie-Session über Reload), 4 Tests. CI (`ci.yml`) um `lint` + Job **e2e** (Playwright mocked) + Job **e2e-real** erweitert.
- **Org-weite MFA-Pflicht _(BE `a144e53` · FE `3c6e413`)_:** Admin-Setting `mfaRequired` (Settings → Sicherheit, persistiert) erzwingt org-weit MFA. Wer keine aktive MFA hat, bekommt beim Login **keinen** Session-Token, sondern einen kurzlebigen **Setup-Token** (`purpose:'mfa_setup'`, 15 min) — `verifyToken` lehnt ihn (wie die MFA-Challenge) für geschützte Routen ab. Neue Endpoints `POST /auth/mfa-setup/begin` (Secret/QR) + `/complete` (Code → MFA aktiv → **volle Session** + einmalige Recovery-Codes); LoginPage führt den Enrollment-Schritt direkt durch. Greift **nur wenn `MFA_ENABLED`** (sonst inert), bleibt nach Enrollment der normale 2-Faktor-Challenge-Flow. Einheitliche, nicht-diskriminierende Fehler bei Token-Problemen (kein Leak). 7 Enforcement-Tests + 70 Regression, FE 984 vitest + 42 E2E grün. **Offen:** Aktivierung (Toggle einschalten) + Deploy.
- **Outbound-Ticket-Export-Route _(`3a1738e`)_:** `POST /api/v1/tickets/:id/export` (analyst/admin) verdrahtet den schon gebauten `ExternalTicketService` (ServiceNow/OTRS) end-to-end — vorher gab es Service+Adapter, aber **keine Route** (toter Pfad). Gate `EXTERNAL_TICKET_EXPORT_ENABLED` (default aus), Joi-validiertes `system`, Wiring-Instanz mit Adapter-ENV-Credentials. Härtung: `exportTicket` auditiert mit **Actor-Kontext** und auch **jeden Fehlversuch**, der Audit-Write ist gekapselt (ein Audit-Fehler überlagert nie den Export-Ausgang), externe Fehlertexte werden gekürzt. 35 + 15 (Service/imapPoller) Tests grün.
- **Wiederverwendbarer `ConfirmDialog` + `useConfirm`-Hook _(`26a4abb`)_:** ersetzt `window.confirm()` durch ein konsistentes, barrierearmes Modal (`role=alertdialog`, Fokus-Trap + ESC + Fokus-Rückgabe, `useId`-ARIA). Verschachtelbar (Trap-Stack: nur das oberste Modal reagiert auf ESC). Verdrahtet an Ticket-Löschen (AnalysisPage), Wazuh-FP-Restart/Revert, Passwort-Reset, sowie YARA-Regel-Löschen (Custom-Modal entfernt). 6 Hook-Tests.
- **MFA/PAT-Selbstverwaltung auf der ProfilePage (alle Rollen) _(`8a3da63`)_:** behebt eine echte Zugriffslücke — `MfaSecurityCard` + `ApiTokensCard` lagen nur in den **admin-only** Settings-Tabs, sodass Nicht-Admins ihre **eigene** MFA/PAT nicht einrichten konnten. `GET /v1/profile` liefert jetzt per-User-Feature-Flags `{ mfaEnabled, apiTokensEnabled }` (requireAuth), die ProfilePage gatet damit die echten Karten.
- **CrowdSec WAN-Integration (Slice 1–3a) _(lokal `f86abc7`/`d11ce37`/`1181400`)_:** zieht die externe Angriffsfläche (HTTP-Bruteforce, Scanner, CVE-Probes, Bad Bots) vom **Webserver-CrowdSec** in Nexora — die Fläche, die das interne Wazuh nicht sieht. **Slice 1** `CrowdsecAdapter` (Adapter-Pflicht: Joi-validate → normalize → `toTicketDraft`; Szenario→MITRE/Kategorie/Schwere). **Slice 2** `CrowdsecLapiClient` (LAPI: Machine-JWT via `/v1/watchers/login` → `/v1/alerts` mit Bearer, Token-Reuse + Skew-Refresh, 1×-Re-Login bei 401; injizierter HttpClient, TDD ohne Netz). **Slice 3a** `CrowdsecPoller` (mirror `imapPoller`, ENV-gated default aus, `pollOnce` → je Alert `integrationService.ingest('crowdsec', …)`, per-Alert-Fehler gefangen) + CrowdSec als Quelle in der Integration-Pipeline registriert (erbt Dedup/Normalize/Queue). **48 Tests grün** (Adapter 16 · Client 8 · Poller 7 + Integration-Suite 336 ohne Regression; `ingest('crowdsec')` → accepted verifiziert). Credentials nur aus `.env`, nie im Repo. **Offen (Slice 3b):** `CrowdsecProcessor` (Ticket-Materialisierung) + ENV-Live-Anbindung an den Webserver (Machine-Creds + LAPI-URL).
- **Audit-Export (CSV + PDF):** das Audit-Log lässt sich gefiltert exportieren (Server-Filter + aktuelle Suche, Limit gedeckelt). **CSV** (RFC-4180, **CSV-Injection-Schutz** nach OWASP: führende `= + - @`/Tab/CR werden mit `'` neutralisiert, UTF-8-BOM für Excel) und **PDF** (jsPDF **dynamisch** im Handler geladen → Heavy-Lib bleibt aus dem Haupt-Bundle; paginiertes A4-Quer-Layout mit Kopf + Generiert-Zeitstempel). Reine, getestete Logik-Module (`frontend/src/features/audit/auditExport.ts` + `auditPdf.ts`), gemeinsamer `fetchExportRows` (DRY). Button-Paar „CSV-Export"/„PDF-Export" im Audit-Log. 31 Vitest-Tests (inkl. RFC-4180-Escaping + Mehrseiten-Pagination). **Live** seit `c9ec072`.
- **MFA-Fundament (TOTP, RFC 6238) — Security-Welle 3, Phase 1 _(lokal `bddf051`, noch nicht verdrahtet/deployt)_:** `backend/src/mfa/totp.js` — reine Krypto-Primitive (`generateSecret` · `totpToken` · `verifyToken` mit ±Drift-Toleranz + Konstantzeit-Vergleich · Base32 Encode/Decode · `otpauthUri` für QR) mit Node `crypto`, **keine externe Lib** (supply-chain-arm, konsistent zu `secretsCrypto`/`ApiToken`). **Gegen die offiziellen RFC-6238-Testvektoren verifiziert** (interoperabel mit Google Authenticator/Authy) + bekannter RFC-4648-Base32-Wert. 16 Tests grün. **Bewusst kein DB-/Login-/Route-/UI-Touch** — Enrollment-Domäne, Repos, Login-Challenge + Frontend folgen als eigene Phasen (Auth-kritisch → frische Session).
- **Correlation Engine (CE-1…CE-5):** zentrale Korrelation pro Incident — Quellen-Normalizer-Registry (alle Quellen, nicht nur Wazuh), Host-Case aggregiert Child-Evidence, entitätszentrierte Korrelation **mit Provenance** (Quelle ×N), Windows-EventChannel-Events (`win.system`) sichtbar. Spec: `docs/01-architecture/correlation-data-model.md` (Datenquellen Q1–Q10, `CorrelationResult`, Bau-Reihenfolge CE-1…CE-7).
- **CE-5.2 FqdnResolver (pure):** `resolveFqdn({ ip, candidateName })` forward-confirm (Name → A-Record(s) → enthält die Flow-IP? nur dann FQDN, Confidence high; kein Raten aus nackter IP). Injizierter DNS-Lookup (testbar); `createNodeResolve4` read-only A-Lookup gegen konfigurierbaren DNS-Server. Ehrliche `missingReason`: disabled/no_ip/no_candidate/dns_no_record/dns_unconfirmed/dns_error. Kein Fake.
- **CE-5.1 FQDN-Source-Discovery (read-only):** Quellenmatrix im Lab — Wazuh liefert nur Kurznamen (kein FQDN); AD-DNS-**Forward** ok für AD-gejointe Hosts (DC01/WEC01, IP-verifizierbar), **Reverse PTR fehlt** (keine Zone); LDAP erreichbar (389/636/3268), braucht read-only Bind-Account. Entscheidung: DNS-forward-confirm als erste Live-Quelle, LDAP optional später, Reverse geparkt. Spec: `docs/01-architecture/ce5-fqdn-source-discovery.md`.
- **CE-5.3 DNS-FQDN-Anreicherung (LIVE, Phase 2 aktiv):** neue async Schicht `flowFqdnEnrichment.js` läuft NACH der Inventory-Anreicherung in der Timeline-Route; füllt nur leere `sourceFqdn`/`destinationFqdn` (Event-Computer/Inventory gewinnen, `setIfEmpty`). Kandidatenname = Host-Kurzname + `FQDN_DOMAIN`, **forward-confirm** gegen Flow-IP (Hostname-Validierung gegen Injection). ENV: `FQDN_RESOLVER_ENABLED` (default false), `FQDN_DNS_SERVER`, `FQDN_DOMAIN` — read-only A-Lookup, keine Secrets. `network.gaps` neu berechnet; Miss-Grund auch in `provenance` (gap-sichtbar). Soft-fail. **Zweistufiger Rollout 2026-06-17:** Phase 1 App-only default-aus (`af89847`, kein Regress bewiesen), Phase 2 Resolver aktiviert (`d8d698a`, App/API-Restart). **Live-Smoke:** WEC01 (10.99.99.11) → `WEC01.nexora.example` gesetzt (Provenance `dns_forward_confirm`, resolvedIps `[10.99.99.11]`, nur weil A == Flow-IP); falsche IP → `dns_unconfirmed` (kein Fake); INC000283 behält `DC01.nexora.example` (Event-Computer gewinnt, Provenance `wazuh_indexer`); `opensourcebackup`/`CERBERUS` (nicht AD-gejoint) → `dns_no_record`, ehrlich leer; INC000357 unverändert. Tests-first (Hybrid-Agent-Run, 87 BE-correlation grün). **Deploy-Lektion:** der prod-Compose reicht ENV über einen **expliziten `environment:`-Block** durch (kein `env_file`) → neue prod-ENV muss dort deklariert werden, sonst erreicht sie den Container nicht (`d8d698a`).
- **CE-3 Network/NAT-Flow-Modell:** einheitliches Flow-Modell (Firewall **und** Sysmon Event 3) mit **`provenance` + `missingReason` pro Feld** (`source_provides_none` / `field_missing` / `inventory_not_loaded` / `threat_intel_pending`) — keine erfundenen Werte. UI: „Korrelierte Flows"-Tabelle (Network-Tab), Top-Conversations (Overview), NetworkConnect (Timeline), Flow-Entities (Entities). Firewall/OPNsense-Flows live sichtbar.
- **Sysmon Event 3 → `wazuh-alerts` (Regel 100951, live validiert):** scoped Wazuh-Local-Rule (`if_sid 92101`, powershell/tcp Proof-of-Chain) hebt Sysmon NetworkConnect auf Level 3 → erscheint als `sourceType: sysmon_event3` im Analyse-Deck. Kontrolliert appliziert (Backup/Restart/Live-Test, rollback-fähig), end-to-end bewiesen an DC01. Artefakte + Apply/Rollback-Plan: `deploy/wazuh/`.
- **CE-4.2 Flow-Inventory-Anreicherung (pure):** `buildInventoryLookup` (IP → Agent/MAC/Interface/Host aus Wazuh-Syscollector) + `enrichFlowWithInventory`/`enrichFlowsWithInventory` reichern normalisierte Flows mit Host/MAC/Host-Interface an — immutabel, ADR-009 (kein Wert erfunden: fehlt etwas → `null` + `missingReason` `not_in_inventory`/`inventory_not_loaded`/`field_missing`), bestehende Werte werden nie überschrieben (`setIfEmpty`).
- **CE-4.3 Inventory-Wiring + Host-/Firewall-Interface-Semantik getrennt (LIVE):** Flow-Modell trennt **Host-NIC** (`sourceHostInterface`/`destinationHostInterface`, aus Wazuh-Inventar, Provenance `syscollector.netiface.name`) von **Firewall-Interface** (`firewallInterface`/`firewallIngressInterface`/`firewallEgressInterface`, aus `data.srcintf`/`dstintf`) — `data.srcintf` landet **nicht mehr** in der Host-NIC. `buildNetworkCorrelation({ inventoryLookup })` reichert Flows an, wenn ein Lookup da ist; neuer `inventoryLookupCache` (TTL 5 min, soft-fail → `null`) über die Wazuh-API in der Timeline-Route. UI `NetworkFlowsTable` zeigt Source/Destination (IP:Port · Host · MAC · Host-IF) und Firewall (FW-IF · Action · Rule) **getrennt**; fehlende Felder als „—" + Missing-Reason. **Live-Smoke 2026-06-17:** INC000283 (DC01) `10.99.99.10 → DC01 · bc:24:11:7b:45:69 · Ethernet`, `10.99.99.72 → opensourcebackup · bc:24:11:ed:96:ff · eth0`; INC000357 (OPNsense) `192.168.241.102 → CERBERUS · 9c:6b:00:76:e6:fe · Host-IF Ethernet 2` (firewallInterface getrennt, **nicht** überschrieben). Hinweis: `firewallInterface`/`rule` bleiben live `null`, weil die realen OPNsense-Events im Indexer kein `srcintf`/`rulenum` führen (korrektes „no-fake", Quell-/Decoder-Thema — kein App-Bug). 54 Backend- + 62 Frontend-Tests grün.
- **CE-4.4 FQDN-Enrichment (LIVE):** zwei belegte Quellen, keine Fakes. (1) **Event-Computer** — Sysmon Event 3 setzt `sourceFqdn` aus `data.win.system.computer` nur bei source-seitigem (`initiated=true`) Flow und nur bei echtem FQDN (`isRealFqdn`: Punkt, kein Kurzname/localhost/IP); `destinationFqdn` wird daraus nie abgeleitet. (2) **Inventory** — FQDN nur, wenn `os.hostname` ein echter FQDN ist. Reihenfolge der Wahrheit via `setIfEmpty`: Event-Computer > Inventory > (später DNS/AD); vorhandener FQDN wird nie überschrieben. UI: `FQDN`-Zeile getrennt unter Host (Source + Destination), fehlt er → „—" + Missing-Reason.
- **CE-4.4.1 ticketFlows-Projektion (LIVE, FQDN-Kette geschlossen):** `WazuhIndexerClient.ticketFlows` fordert `data.win.system.computer` + `data.win.eventdata.initiated` in der `_source`-Projektion an — vorher wurden die Felder von der eigenen Indexer-Query gestrippt, sodass der Event-Computer den Normalizer nie erreichte. **Live-Smoke 2026-06-17 (deployt `6c013fa`):** INC000283 zeigt `sourceFqdn = DC01.nexora.example` (Provenance `data.win.system.computer`), dazu MAC `bc:24:11:7b:45:69`/Host-IF `Ethernet` + Ziel `opensourcebackup`/`bc:24:11:ed:96:ff`/`eth0`; INC000357 unverändert (CERBERUS/`9c:6b:00:76:e6:fe`/`Ethernet 2`, Ziel `not_in_inventory`, 50 Flows). **Damit ist die FQDN-Kette für Sysmon Event 3 vollständig:** Sysmon E3 → Wazuh-Alert → ticketFlows-Projektion → flowNormalizer → `CorrelationResult.network.flows` → Network-Tab. Kein Decoder/Wazuh-/Rule-Change.

#### Control-Plane / Provisioning (Backend-administrierbare Plattform, kein Deploy)

> Durchgehende Kette gebaut: **GitOps-Profile/Plan → Provisioning-Domain → PostgreSQL → Enrollment+Heartbeat → Admin-Read-API → Registry-UI → Linux-Installer.** Alles read-only-first; Writes nur mit Capability+RBAC+Audit. Kein Apply-/Remote-/Netz-Kanal in der gesamten Kette (per Test erzwungen).

- **P_PROVISION_1 — Provisioning-Domain-Model (`9693669`):** 6 Domänen-Entities (`ProvisioningProfile` draft→validated→approved→retired · `EnrollmentProfile` · `InstalledNode` pending→enrolled→active→stale→retired · `NodeCapability` read-only allow-list · `NodeHeartbeat` healthy/degraded/offline · `ProvisioningAuditEvent` append-only/redacted) + `InMemoryProvisioningRepository`. Guards: Transition-Blocking, Rollen-/Capability-Validierung, rekursiver Secret-Scan, No-Apply-Safety-Test. 64 Tests.
- **P_PROVISION_2 — Postgres-Persistenz + Repo-Factory (`544161f`):** Migration `033_provisioning.sql` (6 Tabellen, JSONB, **append-only Audit-Trigger** blockt UPDATE/DELETE) + `PostgresProvisioningRepository` (gleicher öffentlicher Vertrag wie InMemory, `_to*`-Mapping snake→camel + jsonb + Date→ISO) + `provisioningRepositoryFactory` (`DB_ENABLED`). Tests ohne DB: Mapping + Methoden-Vertrag(=InMemory) + No-Apply-Safety + Factory-Toggle.
- **P_AGENT_1 — Enrollment-Token + Heartbeat-Backend (`fffbe1c`):** `EnrollmentToken`-Domain (`mint()` gibt Klartext `enr_`+64 hex **genau einmal** zurück, speichert nur SHA-256-Hash; `toJSON()` nie der Hash) + Migration `034_enrollment_tokens.sql` (`token_hash UNIQUE`, nie Klartext) + `EnrollmentTokenService` (mint/authenticate/revoke; Token nie in Audit/Log/Response) + `NodeEnrollmentService` (enroll: Token→Node create/update→enrolled→Caps→Audit; heartbeat: Node muss existieren→record→lastSeen/active→Caps→Audit, Antwort **nur** `accepted/serverTime/desiredProfileId` — keine Commands/Apply) + Routes `/api/v1/provisioning` (admin+JWT: enrollment-profiles + token; node+Token: `/enroll` [Token im Body], `/nodes/:id/heartbeat` [Bearer]). Guards getestet: revoked/expired/falscher Token blockt, Hash-only, Heartbeat unbekannte Node 404 / ohne Token 401, keine apply/exec/ssh/nat/route/firewall/dhcp/sniff-Methode/Route.
- **P_ADMIN_1a — read-only Registry-API (`d2f1aaa`):** `GET /provisioning/nodes` · `/nodes/:id` (node + capabilities + heartbeats + latestHeartbeat) · `/audit` — admin+JWT, rein lesend, Query-Schemas.
- **P_ADMIN_1b — Provisioning-Registry-UI (`c83fb13`):** React-Seite `/provisioning` (admin-gated, Sidebar+Breadcrumb): Enrollment-Profile-Liste + anlegen + **Token-Mint-Modal (Klartext einmalig, Copy)**, Node-Tabelle mit Status/Heartbeat-Frische + Detail-Modal (Capabilities/Heartbeats). `provisioningApi` (Client) + `provisioningView` (reine Status-/Zeit-Logik). **Visual-Smoke 2026-06-18 grün:** Login→Registry→Profil→Token einmalig→Node enroll→Heartbeat→Detail; Token nie in Tabelle/Audit/nach Schließen/nach Reload.
- **P_INSTALL_1 Slice 1 — Linux Bootstrap Installer (`3434632`, bootstrap-only):** `deploy/install/` — `bootstrap.sh` (POSIX sh: Preflight read-only → `/enroll` Token im Body → nodeId → Agent-Setup via systemd/nohup), `nexora-agent.sh` (Heartbeat-Loop, read-only Inventar, **kein Command-/Apply-Kanal**), gehärtete `nexora-agent.service`, README. **Safety-Gate** `backend/tests/install/installerSafety.test.js` scannt jede ausführbare Zeile gegen Forbidden-Regex (ip/dhcp/dns/nat/route/firewall/wazuh/opnsense/sniffing…) → CI rot bei Verstoß. `.gitattributes` erzwingt LF für `*.sh`/`*.service` (`3cd7bed`). **Offenes Gate vor E2E:** der Enrollment-Token wird im Heartbeat noch als Bearer genutzt — **Slice 2** trennt das (eigenes Node-Credential, Enrollment-Token nur einmalig).
- **P_INSTALL_1 Slice 2 — Node-Credential-Handoff (Bootstrap vs. Betrieb getrennt):** neues Domänenobjekt `NodeCredential` (Präfix `ncr_`, 256-bit, SHA-256, `toJSON`/Mapping nie Hash) + Migration `035_node_credentials.sql` (Hash + Präfix + Status/issued/lastUsed/revoked, `UNIQUE` token_hash) + Repo-Methoden in InMemory **und** Postgres (Vertrag identisch) + `NodeCredentialService` (mint beim Enroll · authenticate · revoke). **Enrollment-Token ist jetzt Single-Use:** der Enroll mintet das Node-Credential, verbraucht dann den Token **atomar** (Compare-and-Set `revoke … WHERE revoked=false`, consume **vor** mint → kein zweites Credential bei Parallel-Enroll). Enroll-Antwort liefert `{ nodeId, nodeCredential }` (Klartext genau einmal). **Heartbeat authentifiziert nur noch mit dem Node-Credential** (Enrollment-Token → 401) und prüft die Node-Bindung (`nodeId == :id`, sonst 403). Installer: `bootstrap.sh` persistiert in `agent.env` **nur** Server/NodeId/Node-Credential (nie den Token); Secrets gehen bei `curl` über stdin (`--data-binary @-` / `-K -`) statt argv (ps-/`/proc`-sicher); `nexora-agent.sh` nutzt ausschließlich das Node-Credential. **Tests:** Domain/Repo/Service-Guards + API-Flow (Token einmalig, Heartbeat-Credential, Token-Ablehnung, Bindung) + lokaler E2E gegen das echte InMemory-Backend (`credentialHandoffE2E.test.js`) + Shell-E2E-Harness `deploy/install/test/e2e_local.sh` (fährt `bootstrap.sh` real gegen einen Mock-Server, `systemctl` gestubbt, räumt alles auf). Security-Review (0 CRITICAL/HIGH offen nach Fix der Enroll-Race), `sh -n` grün, Installer-Safety-Scan grün. Kein Deploy, kein echter Host, kein Wazuh-/OPNsense-Touch.
- **P_PROVISION_SECURITY_1 — Credential-Lifecycle, Node-Retirement, Rate-Limits, Admin-Revoke-UI _(live auf nexora seit `3370fcc`, 2026-06-19)_:** schließt den Betriebs-Lifecycle nach dem Node-Credential-Handoff. **Backend:** `NodeCredentialService.revoke` jetzt route-gebunden; `revokeNodeCredential` als **Compare-and-Set** (`… WHERE status='active'`) in InMemory **und** Postgres → idempotent, kein Doppel-Audit; neue read-Methode `listNodeCredentials` (Parität InMemory=Postgres, NIE Hash/Klartext); `NodeEnrollmentService.retireNode` (**revoke-on-retire**: erst alle aktiven Credentials widerrufen, dann terminaler Statuswechsel `retired`, je Credential `NODE_CREDENTIAL_REVOKED`, dazu neue Audit-Action `NODE_RETIRED`); `recordHeartbeat` lehnt einen `retired` Node ab (Defense-in-Depth, 403). **Routen** (alle admin+JWT): `GET /provisioning/nodes/:id/credentials` (nur sichere Felder), `POST …/credentials/:credId/revoke` (Cross-Node-Bindung → 404 bei fremder Node, idempotent), `POST /provisioning/nodes/:id/retire`. **Rate-Limits** gezielt nur auf `/enroll` (pro-Quell-IP, nur fehlgeschlagene Versuche zählen) und `/heartbeat` (Flood **pro nodeId** — NAT-transparent, mehrere Agents hinter einer NAT-IP blockieren sich nicht; Auth-Fehler pro-Quell-IP) — 429 + `RateLimit-Reset`, **kein Token/Credential in der 429-Response**; in Prod immer aktiv (Fail-Secure), im Test nur bei gesetzten `PROV_*`-ENV. **Migration `037_node_credentials_fk.sql`:** additive FK `node_credentials.node_id → installed_nodes.id` (`NOT VALID` → kein Boot-Abbruch bei Altbestand, `ON DELETE CASCADE`, idempotent). **Frontend `/provisioning`:** Node-Detail-Modal zeigt den Credential-Lifecycle (Status-Badges, **nur Präfix**, nie das Credential), Admin-Aktionen „Credential widerrufen" je Credential + „Node stilllegen" mit destruktivem Bestätigungsdialog und klarer Folgenwarnung; Viewer/Nicht-Admin sehen den Status, aber keine Schreibaktion. **Tests-first:** 3 neue Backend-Suiten (Lifecycle Service+API, Rate-Limits) + FE-API/View-Tests; Backend **2701** + Frontend **880** grün, `tsc -b` sauber. **Security-Review:** 0 CRITICAL/0 HIGH; MEDIUM-1 (Rate-Limit-Skip Prod-gehärtet) gefixt; MEDIUM-2 (transaktionaler Retire) als mitigierter Follow-up dokumentiert (Heartbeat-Reject schließt den Pfad). **Lokaler Browser-Smoke:** Revoke→Heartbeat 401, Retire→Node retired+Credential revoked, kein Voll-Credential im DOM/Audit. **Kein Push, kein Deploy, kein Server-/Lab-/Wazuh-/OPNsense-/Netz-Touch.** Offene Follow-ups: transaktionaler Retire (Postgres), Credential-Rotation (bewusst nicht in diesem Block), Rate-Limit-Persistenz (Redis) für Multi-Instanz.

#### Compliance — NIS2 Readiness & Evidence (P_NIS2_1)

> **Ehrliche Positionierung:** Arbeits-/Nachweis-Unterstützung — **kein** Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten. „NIS2 compliant/zertifiziert/rechtssicher" wird nirgends behauptet (per Test erzwungen).

- **NIS2 Control Registry + Assessment + Evidence (P_NIS2_1):** statischer, versionierter Control-Katalog (`backend/src/compliance/nis2/nis2ControlCatalog.js`) mit den **10** Risikomanagement-Maßnahmenbereichen (stabile Keys, deutsche Titel) + Domain `Nis2Assessment` (Status `not_started…addressed/not_applicable`; `not_applicable` braucht Begründung) und `Nis2EvidenceLink` (8 Evidence-Typen). Persistenz InMemory **und** Postgres (Migration `036_nis2.sql`, Assessment eindeutig je Control, Evidence-FK `ON DELETE CASCADE`) über `nis2RepositoryFactory`. `Nis2ReadinessService` führt Katalog ⨝ Assessments ⨝ Evidence zusammen und berechnet ehrliche Signale (`overdue`, `missingEvidence`, `needsReview`) — **`addressed` ohne Evidence ⇒ needsReview** (kein Voll-Nachweis). Routes `/v1/nis2` (Lesen viewer+, Schreiben admin). **Sicherheit:** Evidence-`ref` hart validiert (nur http/https, kein `user:password@`, keine Secret-artigen Query-**oder Fragment**-Keys, kein `javascript:/data:/file:`, keine Steuerzeichen), keine HTML-Injection, **Audit nur sichere Metadaten** (nie notes/URL/Inhalt). Frontend `/compliance/nis2` (neue Sidebar-Gruppe „Compliance"): KPIs (Controls/Coverage/Review/Überfällig) + Control-Registry + Detail-Panel mit Evidence und Admin-Edit (Viewer read-only). Tests-first: 44 Backend + 16 Frontend grün; Security-Review 0 CRITICAL/0 HIGH (2 Funde gefixt: Fragment-Secret-Bypass, Steuerzeichen-in-URL). Lokaler Visual-Smoke grün (Admin-Flow Assessment→Evidence→Secret-URL abgelehnt). Kein Deploy, kein Lab-/Netzwerk-/Wazuh-/OPNsense-Touch, keine regulatorische Meldung. **Live auf nexora seit `5e009c3` (2026-06-19).**
- **P_NIS2_2 — Incident-Evidence & Management-Reporting _(live auf nexora seit `3370fcc`, 2026-06-19)_:** verbindet Incident-Tickets, Evidence, Audit, Control-Zuordnung und ein Management-Readiness-Reporting — weiterhin ehrlich, **kein** Konformitätsnachweis, **keine** automatische Meldung, **kein** Infrastruktur-Touch.
  - **Incident-Verknüpfung:** `POST /v1/nis2/controls/:controlKey/incident-evidence` (admin) validiert über den geteilten `ticketService`, dass das Ticket existiert (sonst 404), und legt einen `ticket`-Evidence-Link an. **Snapshot nur sichere Felder** (INC-Nummer als Ref, sanitisierter Titel [kein `<>`/Steuerzeichen], Priorität, State) — **NIE PII** (email/user/dept/srcIp/notes/logs). Audit `NIS2_EVIDENCE_LINKED` trägt nur `{controlKey, evidenceType:'ticket', ticketRef}` (ticketRef = INC-Nummer, kein PII/Secret).
  - **Management-Readiness-Report:** `GET /v1/nis2/report` (viewer+, rein lesend) — Aggregat über alle Controls: Status-Verteilung (`byStatus`), Evidence-Coverage, **Incident-Nachweis-Zähler**, `addressedWithEvidence`, `needsReview`/`overdue`/`missingEvidence`, plus `meta.generatedAt`/`catalogVersion`/**Disclaimer** („kein Konformitätsnachweis …"). `addressed` ohne Evidence ⇒ weiterhin `needsReview` (ehrlich).
  - **Frontend `/compliance/nis2`:** neuer Tab **„Management-Report"** (KPIs + Status-Verteilung + Incident-Coverage + Per-Control-Tabelle mit Evidence-/Incident-Zählern + Disclaimer + Stand-Datum) und Admin-Aktion **„Incident verknüpfen"** im Control-Detail (Ticket-Picker → verknüpft als Nachweis). Viewer read-only.
  - Tests-first: **19 Backend** (Service + API, inkl. PII-Leak-Asserts für email/user/srcIp und Ehrlichkeits-Check) + **30 Frontend** (nis2Api/nis2View) grün. Backend 2720 + Frontend 912 grün, `tsc -b` sauber.
  - **Security-Review:** 0 CRITICAL / 0 HIGH; gefixt: AbortController-No-op + PII-Hinweis im Incident-Picker. **Offener Follow-up (vorbestehend aus P_NIS2_1, MEDIUM/PoLA):** `actorFrom` schreibt die Admin-E-Mail in `createdBy`/`updatedBy`, die `GET /assessments`(/`:key`) (viewer+) ausliefern → Datenminimierung. Sauberer Fix braucht einen `displayName`-JWT-Claim oder rollenabhängiges Response-Stripping (modulweit) → eigener Härtungsblock. Der neue Management-Report exponiert `createdBy` **nicht**.
- **Nächster NIS2-Folgeblock: P_NIS2_3** (geplant): vertiefte Nachweisführung (z. B. Hunt-Sessions/Audit-Events als typisierte Evidence, periodischer Readiness-Snapshot). Weiterhin ehrlich, **kein** Konformitätsnachweis.

### Fixed
- **Dependency-Sicherheit + Security-CI _(`052015d`)_:** zwei Produktions-High-Vulns gepatcht (`nodemailer` — raw-Option-SSRF/Arbitrary-File-Read via `imapflow`; transitive `form-data`), beide Prod-Audits jetzt 0 high/critical. Neuer `security.yml`-Workflow: `npm audit --omit=dev --audit-level=high` (harte Schranke auf Prod-Deps) + voller Audit-Bericht + **CycloneDX-SBOM** (Artefakt) für backend+frontend, auf push/PR + wöchentlichem Cron. (Verbleibende Lücken = Dev-Tooling vitest/vite, Major-Upgrade als eigener Block.)
- **`useConfirm` Async-Action-Modus + ProvisioningPage-Vereinheitlichung _(`34291c9`)_:** `useConfirm` kann jetzt eine `action()` ausführen, während der Dialog offen+busy bleibt und Fehler inline zeigt (`ConfirmDialog` bekam `error`-Prop) — der einfache Modus ist unverändert. ProvisioningPage-Lösch-/Retire-Dialoge laufen nun über das zentrale `useConfirm` statt eines lokalen Dialogs (DRY + konsistente a11y).
- **Review-Härtung (ECC-Multi-Agent-Review) _(`9307b09`)_:** `RealHttpClient` folgt 3xx-Redirects nicht mehr automatisch (`redirect:'error'`) — node-fetch reichte sonst den `Authorization`-Header an ein servergewähltes Redirect-Ziel weiter (SSRF-/Credential-Vektor). `useReturnFocus` gibt den Fokus jetzt auch bei Unmount zurück (Modals via `{open && <Modal/>}` schalten `isOpen` nie auf false; WCAG 2.4.3). `EXTERNAL_TICKET_EXPORT_*`-Audit-Actions zentral in `AuditService.AUDIT_ACTIONS` registriert (totes `EXPORT_PREPARED` entfernt). ProvisioningPage-Lösch-Dialog umbenannt (Kollision mit dem neuen `ConfirmDialog`) + Fokus-Trap nachgerüstet; TicketsPage-Lösch-Modal Fokus-Trap. BE 2836 + FE 984 Tests grün.
- **KI-Cloud-API-Key-Save (500 → behoben, LIVE `f15bb19`):** `PUT /settings/ki` schrieb unbelegte Modell-Felder (`anthropicModel`/`openaiModel`/`googleModel`) als `undefined` in die `NOT NULL`-Spalte `platform_settings.value` → 500 → **jeder** Cloud-API-Key-Save schlug fehl (das InMemory-Repo tolerierte `undefined`, daher nur die echte Postgres-Prod betroffen und in Tests unentdeckt). Fix in `backend/src/routes/settings.js`: `str()`-Fallback liefert nie `undefined` (→ `''`) + defensive Coercion in der Set-Schleife. Regressionstest (Cloud-Provider ohne Modell → 200 statt 500). **Forensik-Lektion:** Prod-Logs nur via `docker logs soc_api_prod` lesen (nicht `docker compose logs` ohne `--env-file` → kaputter TLS-Volume-Spec killt den Befehl).
- **Cloud-LLM-JSON-Parser (Claude/GPT „Keine verwertbare Antwort" → behoben, LIVE `c9ec072`):** `OllamaLlmProvider._parse` machte striktes `JSON.parse(raw)` — Cloud-Modelle verpacken ihr JSON aber oft in Markdown-Fences (```json …```) oder schreiben Prosa davor → Antwort wurde verworfen, Fallback „kein strukturiertes JSON" (Ollama lieferte dank `format:json` reines JSON, daher nur cloud-seitig sichtbar). Fix: robuste Kandidaten-Extraktion (raw → Fence-Inhalt → erstes `{…letztes }`), **rein additiv** (valider Roh-JSON parst weiter als Kandidat 1; echtes Nicht-JSON fällt wie bisher in den Rohtext-Fallback). 2 Regressionstests (Fence + Prosa-Vorspann), 294 Agent/Provider/Analysis-Tests grün.
- **Host-Case `ticketFlows` flow-only Query (LIVE `f2705b3`):** Host-Case-Query (`offense wazuh:host:<id>`, kein `ruleId`) holte die **50 neuesten** Agent-Events → busy Hosts (DC01: ~50 Events/45 min) verdrängten ältere **Sysmon-E3-Flows** aus dem `size`-Fenster (INC000283 zeigte `flows=0`, Host-Case wurde „blind"). Neuer `flowOnly`-Pfad: `ticketFlows` ergänzt einen **Flow-Relevanz-Filter** (Firewall `src`/`dst`-IP **oder** Sysmon `eventID 3`) **nur für Host-Cases**; rule-scoped Query (z. B. INC000357 rule 87702) unverändert, `size` begrenzt. **Live-Smoke:** INC000283 zeigt wieder den Sysmon-Flow (`DC01.nexora.example` · `bc:24:11:7b:45:69` · Host-IF `Ethernet` · `powershell.exe`). Reine bessere Suchlogik gegen vorhandene Alerts — kein Wazuh-Change.
- **MAC-1 `getNetInterfaces`-`select` (Wazuh, LIVE `76ad485`):** `WazuhApiClient.getNetInterfaces` fragte `/syscollector/{id}/netiface?select=name,mac,ipv4` — `ipv4` ist **kein** netiface-Feld (IPs liegen in `netaddr`) → Wazuh **HTTP 400** → `_resolveAgentMac` soft-fail → `ticket.mac` blieb leer (Source-Panel MAC „—" bei Host-Cases). Fix: `select=name,mac`. Alte Test-Stubs trugen fälschlich `ipv4`, darum unentdeckt → jetzt Regressionstest auf den `select` + realitätsnaher Processor-Test (netiface ohne `ipv4`). Host-Cases ohne MAC heilen beim nächsten Alert (`_findOrCreateCase`).
- **MAC-Anreicherung (Wazuh):** `WazuhProcessor` reichert die Host-MAC aus dem Syscollector-Interface ans Ticket an (Source-Panel zeigte MAC zuvor leer); Host-Case Self-Healing.
- **Windows-EventChannel-Events:** Evidence-Normalizer liest jetzt auch `win.system` (z. B. WMI-Activity) — Deck wirkte für solche Events leer, obwohl das Roh-Event vorlag.

## [0.1.0] — 2026-06-16 — Erstes versioniertes Release

Erster getaggter Stand (`v0.1.0`). **Versionierungs-Policy ab jetzt:** SemVer `vMAJOR.MINOR.PATCH`,
Git-Tag je Release, `/health` meldet die laufende Version (Deploy-Verifikation).

### Added
- **Mehr Entitäten aus Sysmon:** DNS (DnsQuery Event 22) als neue Entity-Karte; Network (NetworkConnect Event 3) mit Source-/Destination-Hostname, verbindendem Prozess und Richtung; Host-Inventar mit getrenntem **OS / OS-Version** + **FQDN**, echte IP aus `/netaddr`.
- **Diagnose-Logging** der Wazuh-Inventar-Anreicherung (`agent_inventory_empty|sparse|enrich_failed`) — kein still verschluckter Fehler mehr (Hard-Rule).
- **KI-Settings Welle 2:** read-only Transparenz der Safety-Guardrails (Evidence-/Benign-Floor, Anti-Halluzination) + Confidence-Schwellen + Human-in-the-Loop-Status; Nutzungs-/Latenz-Metrik-Sidebar (`GET /v1/agent/guardrails` + `/metrics`).
- **Welle 1:** Ticket-Delete-UI (admin), echter PDF-Export (jsPDF), Dashboard „Top Erkennungsquellen" (echte Top-Rules), Profil Sprache/Datumsformat persistent (Migration 032).
- **`/health` meldet `version`**.

### Fixed
- **Security/Funktion:** `requireAuth` fehlte vor `requireRole` in `POST /hosts/:id/collect` — Route lieferte jedem 401. + Regressionstest.
- **Unbounded `findAll()`** in 6 Repos paginiert (abwärtskompatibel).

> Ebenfalls Teil von 0.1.0 (Detail in den folgenden Blöcken): Repo-Cleanup & Audit-Fixes,
> Enterprise-Security-Härtung, Multi-LLM-Provider & KI-Settings-Redesign W1.

## [0.1.0] — 2026-06-16 · Repo-Cleanup & Audit-Fixes

Schwerpunkt: **Repo produktreif/übersichtlich machen** (W1–W3) + **echte Backend-Audit-Fixes**.

### Added
- `.github/`: Issue-Forms (Bug/Feature), PR-Template (mit Hardrules-Checkliste), **CI-Workflow** (Jest + Vitest + tsc + Build auf push/PR).
- `docs/` in **nummerierte Struktur** (`00-overview … 08-roadmap` + `adr/`) mit Ordner-Index-READMEs; `docs/assets/screenshots/` mit Anleitung.
- **Pagination** (`{ limit, offset }`, Default-Cap) für alle bisher unbegrenzten `findAll()` — 6 Repos (User/UseCase/AnalysisTemplate/WazuhFpException/AgentSuggestion/Yara) + Test.

### Changed
- **README zur Produktseite** (Tech-Badges, Inhaltsverzeichnis, Screenshots-Ablage); **Mission + „Warum" auf vorsichtigen Human-in-the-loop-Ton** — „reduziert … ohne Kontrolle aus der Hand zu geben" statt „übernimmt/Autopilot".
- **ROADMAP** gekürzt (216→112 Z.) + Zielbild auf HITL-Ton.
- Frontend: `components/analysis/` → `features/analysis/components/` (Backend bleibt bewusst layered).
- **`.gitignore` gehärtet**; `.claude/`, Design-Mockups (`toolDesign/`/`SettingsDesign/`/`qradar-analyst-deck/`), Legacy `index.html` und große ZIPs aus dem Tracking genommen.

### Fixed
- **Security/Funktion:** `requireAuth` fehlte vor `requireRole` in `POST /hosts/:id/collect` → `req.user` nie gesetzt → Route lieferte **jedem** 401 (faktisch tot). + Regressionstest. (`e83a253`)
- **Unbounded `findAll()`** (Audit HIGH) in 6 Repos paginiert — abwärtskompatibel, Array-Vertrag bleibt.
- Doku-Links nach docs-Reorg durchgängig repariert (**0 tote Links**); Lab-Doku-Generator (`70-docs.sh`) auf neuen Pfad nachgezogen.
- Verifiziert als **Nicht-Probleme**: Settings-Tabelle (lazy `CREATE TABLE IF NOT EXISTS`), notifications/apiTokens (bereits 7/4 Test-Suiten) — Audit-Funde waren überholt.

### Removed
- **Git-History bereinigt** (`git filter-repo`): alte Design-Blobs aus der gesamten History → **`.git` 64 MB → 3 MB** (force-push; alte Klone müssen neu klonen).

### Verifikation
- Backend **146 Suiten / 2279 Tests** grün · Frontend **70 Suiten / 766 Tests** grün · `tsc` 0. Regressionstest rot→grün bestätigt.

---

## [0.1.0] — 2026-06-16 · Security-Härtung & Multi-LLM

Schwerpunkt: **Enterprise-Security-Härtung (Roadmap Phase 4)** + **Multi-LLM-Provider & KI-Settings-Redesign (Phase 1)**.
Alle neuen Security-/Cloud-Kontrollen sind **default-AUS** → sicher deploybar, kein Verhaltenswechsel ohne Admin-Aktivierung.

### Added
- **Cloud-LLM-Provider** Anthropic (Claude), OpenAI (GPT), Google AI (Gemini) neben Ollama/Stub. Erben Prompt/Parse/Evidence-Floors, überschreiben nur den API-Call. (ADR-018)
- **API-Keys im Backend/UI** einstellbar (statt nur ENV), **AES-256-GCM-verschlüsselt at-rest**; nie im Klartext im GET. `POST /settings/ki/test` (Verbindungstest), `GET /settings/ki/providers` (Status). (ADR-018)
- **Primär + Fallback-Kette** für LLM-Provider (`FallbackLlmProvider`) — Auto-Failover bei Ausfall/Timeout/Auth-Fehler.
- **Modell-Parameter** (Temperatur/TopP/MaxTokens) UI-konfigurierbar, in alle Provider durchgereicht.
- **Account-Lockout** (Postgres-persistent), **Passwort-History** (Wiederverwendungssperre, Migration 031), **Passwort-Ablauf** (+ Zwangswechsel-Gate), **Mehrfach-Sitzungen-Limit**, **Inaktivitäts-Timeout**, **TLS-erzwingen**, **IP-Allowlist** — alle serverseitig erzwungen, default aus. (ADR-019)
- **CSRF Double-Submit** (`csrfGuard`) für Cookie-Sessions. (ADR-017)
- Settings: echte **Lizenz/Nutzungs-Zahlen** aus `/system/stats`.

### Changed
- **Auth auf Cookie-only** umgestellt: kein JWT mehr im `sessionStorage` (XSS-Härtung); httpOnly-Cookie + CSRF. Bearer bleibt für API-Clients/PAT. (ADR-017)
- **KI-Einstellungen-Seite** redesignt (W1): Provider-Kacheln mit Status, Key-Eingabe (maskiert) + Test, Modell-Konfig, Fallback-Selects, Datenschutz-Warnung.
- Doku auf echten Stand: ROADMAP/feature-status/arc42 (Testzahlen real ~2273 BE / 766 FE).

### Fixed
- `GET /settings/ki` gab via `getAll()` den gesamten KV-Store zurück → KI-Whitelist (CRITICAL).
- Guard-`/health`-Ausnahme: exakter Segment-Match statt `includes` (z.B. `/tickets/health-check` nicht mehr befreit).
- `ipAllowlistCidrs` Joi-validiert (IPv4/CIDR).
- `coverage/` aus Git entfernt + `.gitignore` ergänzt.

### Removed
- **P20 (Monitoring/Ops)** als geplante Phase gestrichen (Funktion teils schon vorhanden) — ersetzt durch die neue Phasen-Roadmap.

### Security / Datenschutz
- ⚠ **Cloud-Provider opt-in:** bei Aktivierung verlassen Ticket-/Alert-Daten (ggf. PII) das interne Netz → vorher DSGVO/AVV absichern.
- Mehrperspektiven-Audit durchgeführt (🟢→🟡); offene Funde dokumentiert (s. unten / Memory).

### Verifikation
- Backend 145 Suiten / 2273 Tests grün · Frontend 766 Vitest grün · tsc 0 · eslint 0 Errors. Jeder Schritt live deployed + Smoke-getestet.

### Bekannt offen (nächste Session)
- KI-Settings **Welle 2** (Prompt-Templates, Confidence-Thresholds, Human-in-the-loop-Regeln, Logging/Audit-Toggles, Guardrails, Datenquellen, Metrik-Sidebar Usage/Kosten/Latenz).
- Audit-Reste: `schema_migrations`-Tracking, ~91 a11y-Warnings. (unbounded `findAll()` + hosts.js-Auth inzwischen erledigt — s. oberer Block.)
- MFA/TOTP, SSO/OIDC, PAT live; Phase 0 (KI-FP-Preview-Bug, Wazuh-Rauschen).
