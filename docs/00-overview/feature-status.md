# Feature Status Matrix — Nexora SOC Orchestrator

> **Kanonische Status-Quelle.** Bei Widerspruch gilt dieses Dokument + der Code, nicht ältere Notizen.

**Status:** Production (Roadmap Phase 4 weit, Phase 1/3 verdrahtet, CE-5 FQDN-Enrichment aktiv; Control-Plane/Provisioning + NIS2 Readiness live; CI/E2E/SBOM in GitHub Actions)  
**Last Updated:** 2026-07-06 (kanonischer Stand mit Live-Hinweisen zu Dataplane-Rebuild, Frontend-CSP-Nachtrag und ehrlicher Last-/Container-Bewertung; ältere Einzel-Deploy-Details bleiben unten als Verlauf erhalten)

> **Realitäts-Hinweis (2026-06-23):** Mehrere früher als „offen" geführte Punkte sind tatsächlich erledigt — **CI** (`ci.yml`, 4 Jobs) · **E2E mocked + real** · **SBOM + npm-audit** (`security.yml`) · **MFA/TOTP + PAT** (deployt) · **OIDC-Backend**. Wirklich offen ist die Liste am Ende dieses Dokuments (Known Limitations).

> **Update 2026-06-28 (Standpruefung `p-phase0-close`):** PR #1 (`p-phase0-close → main`, `5b3042c`) ist **live deployt**; die früher als lokal markierten Blöcke (**P_PROVISION_SECURITY_1**, **P_NIS2_2**, **P_CORR_1-Frontend**) sind produktiv auf nexora. Außerdem läuft die **Data Plane / Pull-Collector-Hub** produktiv (s. eigene Sektion). **Offene Release-Schuld:** lokaler Branch `p-phase0-close` stand zu diesem Prüfpunkt vor `origin/p-phase0-close` und deutlich vor `main`; den aktuellen Abstand immer per `git status --branch` / `git log` prüfen statt aus dieser Notiz zu übernehmen.

> **Update 2026-07-06 (Live-Betrieb):** Der Dataplane-/Collector-Stack musste auf dem Live-Host erneut rekonstruiert werden (Runtime-Scaffold, Intake-Seed, Collector-Hub). Der Stack läuft wieder produktiv. Gleichzeitig gilt: dokumentierte Container-Limits und der vorhandene Lasttest sind **noch kein harter Produktionsnachweis für hohe Postgres-Last**, weil der referenzierte Hauptlasttest weiterhin auf InMemory basiert.

> **Data Plane / Cross-Domain (2026-06-25) — PRODUKTIV ✅:** Eigenständige Korrelations-Pipeline live auf nexora: VPS-Kollektoren **conntrack (ids) · Cowrie (siem) · Suricata (ids)** → WireGuard → Intake (Postgres+Outbox) → Outbox-Worker (Cross-Domain-Fusion, IP-Paar+Sliding-Window) → **A4-Ingress** in `soc_api_prod` (HMAC, idempotent + Verdikt-Upgrade) → priorisierte Prod-Tickets. Verdikt-Stufung live belegt: `observed → suspicious → confirmed_malicious` (flow+siem+ids). Kollektoren non-root. Repro-Artefakte: `deploy/vps-{conntrack,cowrie,suricata}/`; Tests in `dataplane/` + `backend/tests/dataplane*`. Operator-Details: `docs/_private/INFRA-CHANGELOG-2026-06-25.md`.

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ | Complete & tested |
| 🔶 | Partial or in progress |
| ❌ | Not implemented |
| 🔧 | Stub / Mock implementation |
| ⚠️ | Known issues or limitations |

---

## Core Features

### Authentication & Authorization

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Login (JWT) | ✅ | ✅ | ✅ | ✅ | 24h TTL, bcrypt(12) |
| Logout (JTI blacklist) | ✅ | ✅ | ✅ | ✅ | Invalidates token immediately |
| Change password | ✅ | ✅ | ✅ | ✅ | Requires old password |
| Role-based access (RBAC) | ✅ | ✅ | ✅ | ✅ | admin > engineer > analyst > viewer |
| Session persistence (Cookie-only) | ✅ | ✅ | ✅ | ✅ | **httpOnly-Cookie `soc_token`** (kein JWT mehr im localStorage, XSS-Härtung); Bearer bleibt für API-Clients/PAT (ADR-017) |
| CSRF-Schutz (Double-Submit) | ✅ | ✅ | ✅ | ✅ | `csrfGuard` für Cookie-Sessions (ADR-017) |
| Account-Lockout (Postgres-persistent) | ✅ | ✅ | ✅ | ✅ | Settings → Sicherheit; `lockoutMaxAttempts` (0 = aus) + `lockoutMinutes`, serverseitig erzwungen |
| Passwort-History (Wiederverwendungssperre) | ✅ | ✅ | ✅ | ✅ | Migration 031; default aus (ADR-019) |
| Passwort-Ablauf + Zwangswechsel-Gate | ✅ | ✅ | ✅ | ✅ | serverseitig erzwungen, default aus (ADR-019) |
| Mehrfach-Sitzungen-Limit | ✅ | ✅ | ✅ | ✅ | Settings → Sicherheit, default aus (ADR-019) |
| Inaktivitäts-Timeout | ✅ | ✅ | ✅ | ✅ | Settings → Sicherheit, default aus (ADR-019) |

---

## Ticket Management

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Create ticket (manual) | ✅ | ✅ | ✅ | ✅ | Full field validation |
| Read tickets (list + detail) | ✅ | ✅ | ✅ | ✅ | Pagination, filters, search |
| Update ticket | ✅ | ✅ | ✅ | ✅ | State, status, notes, assign |
| Close ticket (with reason) | ✅ | ✅ | ✅ | ✅ | Reasons: resolved, FP, benign, dup |
| Delete ticket (admin) | ✅ | ✅ | ✅ | ✅ | Admin-Button + Confirm-Modal in der Ticket-Liste |
| Ticket deduplication | ✅ | — | ✅ | ✅ | Source + offenseId + hash |
| Ticket numbering (INC000001) | ✅ | ✅ | ✅ | ✅ | PostgreSQL sequence |
| Ticket audit trail | ✅ | ✅ | ✅ | ✅ | All changes logged append-only |
| Ticket export (PDF) | ✅ | ✅ | ✅ | ✅ | Echter PDF-Download (jsPDF), Analysis Deck + Evidence-Export |
| Host-case linking (parent_id) | ✅ | ✅ | ✅ | ✅ | Automatic for Wazuh events |
| Related tickets (host-based) | ✅ | ✅ | ✅ | ✅ | Shows tickets from same host |

---

## Threat Hunting

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Hunt catalog (one-click) | ✅ | ✅ | ✅ | ✅ | 10 hunts available |
| Hunt session creation | ✅ | ✅ | ✅ | ✅ | Status: RUNNING → COMPLETED |
| Hunt runner (async) | ✅ | 🔧 | ✅ | ✅ | Wazuh API + YARA |
| Live hunt console | ✅ | ✅ | ✅ | ✅ | Shows findings in real-time |
| Hunt findings → ticket | ✅ | ✅ | ✅ | ✅ | Create new or add to existing |
| Hunt findings → evidence | ✅ | ✅ | ✅ | ✅ | Attaches to ticket |
| Hunt catalog metadata | ✅ | ✅ | ✅ | ✅ | MITRE ATT&CK, duration, config |

---

## KI-Agent (Copilot)

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Proposal generation | ✅ | ✅ | ✅ | ✅ | Types: fp_rule, escalate, corr., mitig. |
| Ollama integration | ✅ | — | ✅ | ✅ | llama3.2:3b on 192.168.240.78 |
| Cloud-LLM-Provider (Anthropic/OpenAI/Google) | ✅ | ✅ | ✅ | ✅ | Opt-in; Keys nur via ENV; Provider live in UI wählbar; ⚠ Daten verlassen das Netz |
| Provider live switch (DynamicLlmProvider) | ✅ | ✅ | ✅ | ✅ | Settings-Auswahl wirkt zur Laufzeit, ENV-Fallback |
| Stub LLM provider | ✅ | — | ✅ | ✅ | For testing without Ollama |
| Evidence bundling | ✅ | — | ✅ | ✅ | Wazuh events + TI + MITRE |
| Entity-Extraktion (Normalizer) | ✅ | ✅ | ✅ | ✅ | Host(FQDN/OS/OS-Version/MAC via Syscollector)/User/Process/File/Registry/Network(Sysmon E3: Hostnames/Prozess/Richtung)/**DNS** (Sysmon E22); FQDN-Quellen: Event-Computer > Inventory > DNS-forward-confirm (CE-5.3) |
| Strukturierte Analyse (analysis JSONB) | ✅ | ✅ | ✅ | ✅ | snake→camelCase, native Entity-Karten (AnalysisCards) |
| Evidence-Floor (VT anhebend) | ✅ | — | ✅ | ✅ | ≥1/≥5 Engines → suspicious/confirmed |
| Benign-Floor (Scanner-Fehler) | ✅ | — | ✅ | ✅ | clamd-Selbstfehler → false_positive (ADR-014) |
| Anti-Halluzination Guardrails | ✅ | — | ✅ | ✅ | confirmed_facts nur belegt, FP-Konsistenz-Guard |
| Proposal approval workflow | ✅ | ✅ | ✅ | ✅ | pending → approved → audit |
| Proposal rejection | ✅ | ✅ | ✅ | ✅ | With optional reason |
| FP-rule auto-apply (Wazuh) | ✅ | ✅ | ✅ | ⚠️ | Behind WAZUH_FP_APPLY_ENABLED flag |
| RAG knowledge base (Qdrant) | ✅ | ✅ | ✅ | ✅ | mitre_attack (697 Techniken) + hunt_catalog (17) live; past_incidents füllt sich aus geschlossenen High/Crit-Tickets |

---

## Detection & YARA

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| YARA rule CRUD | ✅ | ✅ | ✅ | ✅ | Create, read, update, delete |
| YARA pattern validation | ✅ | ✅ | ✅ | ✅ | ReDoS protection, input caps |
| YARA scan (against input) | ✅ | ✅ | ✅ | ✅ | Matches rules against text |
| YARA enable/disable | ✅ | ✅ | ✅ | ✅ | Toggle active rules |
| Wazuh detection rules (read) | ✅ | ✅ | ✅ | ✅ | Read-only proxy from API |
| Detection search & filter | ✅ | ✅ | ✅ | ✅ | By group, level, keywords |
| Custom detection rule creation | ✅ | ✅ | ✅ | ✅ | UI live: „Neue Regel"-Modal in `DetectionLibraryPage` → `POST /detections/custom` → `nexora-custom-detections.xml` (ID 100500–109999) |
| Hunt-Pause | ✅(501) | ✅ | ✅ | ⛔ bewusst | Runner ist **synchron** (active→completed in einem Lauf) → `/pause` gibt absichtlich `501 NOT_SUPPORTED`. Echte Pause = Runner-Re-Architektur (async/resumable), eigener großer Block — kein Stub |
| Agent-Commands (Analysis) | ❌ | ❌ | — | ⛔ scope | „Coming Soon"-Badge; braucht Remote-Command-Kanal (per Agent-Read-only-Regel out of scope) |
| Hosts-Enrollment (Add Host) | ⚠️ | ❌ | — | ⛔ scope | Button „via Wazuh" = Wazuh-Agent-**Registrierung** (Wazuh-write); no-touch-Entscheidung nötig |

---

## Asynchrone Korrelations-Engine (P_CORR_1)

> Materialisierte asynchrone Korrelation — **keine** synchrone `correlate()`-Berechnung im GET-Read-Pfad. Persistente Jobs + Worker + materialisiertes Resultat + Status-UI. **Deployt + live auf nexora (2026-06-23, `5b3042c`).** Erweitert um **Lazy Schedule-on-Read** + scriptBlock-Extraktion + Engine `ce-2` (Evidence-Datenfluss-Fix, ADR-033) — der Deck zeigt jetzt die reiche Evidence (Commands/Payloads) aus `ticket.logs`.

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| pg-boss v12-Adapter + Dead-Letter-Queue | ✅ | — | ✅ | ✅ | Idle lokaler Live-Gate-Test: pg-boss 12.18.2 + Postgres 16.14 · 4/4 grün |
| Job/Result-Datenmodell + Status-Machine | ✅ | — | ✅ | ✅ | `pending→running→completed`; Idempotenz via `input_hash` + Partial-Unique-Index |
| Migration `042_correlation.sql` (3 Tabellen) | ✅ | — | ✅ | ✅ | Additiv, `IF NOT EXISTS` |
| InMemory- + Postgres-Repo + Factory | ✅ | — | ✅ | ✅ | Parität; `saveResult` atomar |
| CorrelationWorker (Job→Engine→atomar) | ✅ | — | ✅ | ✅ | ack erst nach `saveResult`; Fehler → Queue-Retry; source_revision-Recheck |
| CorrelationSchedulingService | ✅ | — | ✅ | ✅ | Idempotent; Relevanz-Filter; `reconcile()` für pending Jobs |
| CorrelationMutationService (transaktional) | ✅ | — | ✅ | ✅ | `BEGIN` Ticket/Evidence + Job `COMMIT`, queue notify nach Commit |
| Composition Root (correlationRuntime) | ✅ | — | ✅ | ✅ | Geteilte Queue-+Repo-Instanz; kein stiller InMemory-Fallback bei DB_ENABLED |
| Materialisierter Read-Pfad (`GET /evidence`) | ✅ | — | ✅ | ✅ | kein `correlate()` im GET (statisch per Test erzwungen); status: current/pending/superseded/unavailable |
| Correlation Status Banner | — | ✅ | ✅ | 🔶 | `p-corr-1` **live** (PR #1). 7-Zustands-Rendering; stale/superseded nie als aktuell |
| Correlation Polling Hook | — | ✅ | ✅ | 🔶 | `p-corr-1` **live** (PR #1). Nur bei aktivem Job, Backoff, Cleanup |
| Overview exklusiv aus `correlationStatus.result` | — | ✅ | ✅ | 🔶 | `p-corr-1` **live** (PR #1). `ev.correlation` nie als aktuelles Resultat |
| Pre-Deploy-Gates | — | — | — | ⏳ | SQL EXPLAIN · DB-Pool-Last · PgBoss-Start/NOTIFY in Compose · Queue-Integrationstest gegen Ziel-Postgres |

---

## Data Plane / Pull-Collector-Hub (ADR-036)

> Eigenständige Korrelations-Pipeline, **produktiv** auf nexora (2026-06-25/26). Interne Pull-Kollektoren
> holen read-only von den Quellen → EventEnvelopeV1 → Intake (Postgres+Outbox) → Outbox-Worker
> (Cross-Domain-Fusion) → A4-Ingress in `soc_api_prod` → priorisierte Prod-Tickets. Auf den Quellen läuft
> **kein** Collector-Code/Credential/Agent (nur Sensoren). Erweiterbar per Config-Eintrag. Tests: `dataplane/` (~170) + `backend/tests/dataplane*`.

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Intake (HTTP, Auth, Idempotenz, Rate-Limit) | ✅ | — | ✅ | ✅ | EventEnvelopeV1-Contract, Postgres + Transactional Outbox |
| Cross-Domain-Fusion (IP-Paar + Sliding-Window) | ✅ | — | ✅ | ✅ | Verdikt `observed→suspicious→confirmed_malicious` |
| A4-Ingress-Adapter (HMAC, idempotent) | ✅ | — | ✅ | ✅ | FusedIncident → Ticket; **Verdikt-Upgrade** bei neuem Signal |
| Outbox-Worker (claim/fusion/emit) | ✅ | — | ✅ | ✅ | SKIP LOCKED, Window-Re-Fusion, Backoff |
| Collector-Hub (intern, Pull, N nebenläufig) | ✅ | — | ✅ | ✅ | `collectorHubMain`/`buildHubFromConfig`; Config-driven, Self-Healing |
| Pull-Transporte (SSH-tail / Poll+Cursor) | ✅ | — | ✅ | ✅ | `remoteTailSource`/`sshTail`/`pullSource`; `intervalMs` sek→ms |
| Quellen live: Cowrie (siem) · Suricata (ids) · Wazuh (siem) | ✅ | — | ✅ | ✅ | command-restricted Keys, least-privilege |
| OPNsense-Firewall als Pull-Quelle | ✅(Collector+Filter) | — | ✅ | 🔶 | **pausiert** — quellseitiger `filter` gebaut (`tail\|grep`), live gemessen: `filter=block` = reines LAN-Broadcast/Multicast-Rauschen (`192.168.x→.255`, `224.0.0.22`). Braucht WAN/extern-Scope + Broadcast-Ausschluss (multi-grep / Collector-Action-Gate) |
| Update-Pull / Desired-State (Config/Version aus Nexora) | ❌ | ❌ | — | ❌ | Zielbild ADR-036; eigenes ADR + Security (signiert/Approval/Audit) |
| **Hub↔Backend-Status-Brücke** | ✅ | — | ✅ | ✅ | **live deployt (2026-06-30, PR #8/#9).** Knoten pusht Live-Status (Collector-Hub + echte Intake-/Outbox-Zähler) per HMAC → `POST /dataplane/status` (upsert je nodeId, Migration 046); fail-honest stale≠available. Push-Job ENV-gated im `collectorHubMain` (default AUS), live aktiv für `nexora-collector-hub-1` |
| **Data-Plane-UI in Nexora (`/dataplane`)** | ✅ | ✅ | ✅ | ✅ | **live deployt (2026-06-30, PR #8).** `GET /collectors/pipeline` → Seite mit KPIs + pro-Knoten Collector-Tabelle + Intake/Outbox-Zähler; ehrlicher Banner ohne frischen Snapshot. `collectors/activity.liveProcessStatus` jetzt ehrlich `available=true` bei frischem Push |

---

## Evidence & Threat Intelligence

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Evidence model (raw + parsed) | ✅ | ✅ | ✅ | ✅ | JSONB for flexibility |
| IOC extraction (IP, domain, hash) | ✅ | ✅ | ✅ | ✅ | Auto-detected from text |
| VirusTotal enrichment | ✅ | ✅ | ✅ | ✅ | Hash/IP/domain reputation |
| AbuseIPDB enrichment | ✅ | ✅ | ✅ | ✅ | IP-only, abuse score |
| Threat Intel scoring | ✅ | ✅ | ✅ | ✅ | Verdict: benign, suspicious, malicious |
| IOC dashboard | ✅ | ✅ | ✅ | ✅ | Shows reputation per IOC |
| Wazuh event evidence | ✅ | ✅ | ✅ | ✅ | Normalized from raw alert |
| Evidence history | ✅ | ✅ | ✅ | ✅ | Audit trail per evidence |

---

## Hosts & Inventory

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Wazuh agent list | ✅ | ✅ | ✅ | ✅ | Status, IP, OS |
| Agent heartbeat | ✅ | ✅ | ✅ | ✅ | Last keepalive timestamp |
| Agent syscollector (inventory) | ✅ | ✅ | ✅ | ✅ | OS, hardware, network, packages |
| Agent SCA (security compliance) | ✅ | ✅ | ✅ | ✅ | Failed checks + score |
| Vulnerability data (from indexer) | ✅ | ✅ | ✅ | ⚠️ | Soft fail if indexer offline |
| Host risk score | ✅ | ✅ | ✅ | ✅ | Based on SCA + CVE |

---

## SIEM Integration

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| **Wazuh** | | | | |
| Webhook intake (HTTP POST) | ✅ | — | ✅ | ✅ | HMAC-signed, replay-protected |
| Wazuh processor (Alert → Ticket) | ✅ | — | ✅ | ✅ | Dedup on rule + agent |
| Wazuh Manager API (read) | ✅ | — | ✅ | ✅ | Agents, inventory, SCA; MAC via `getNetInterfaces` (select fix MAC-1: nur `name,mac` — kein HTTP 400 mehr) |
| Wazuh Indexer (OpenSearch read) | ✅ | — | ✅ | ✅ | Aggregations, searches |
| Wazuh FP-exception builder | ✅ | ✅ | ✅ | ✅ | Rule XML generation |
| Wazuh FP-exception apply | ✅ | ✅ | ✅ | ⚠️ | Requires WAZUH_FP_APPLY_ENABLED |
| **QRadar** | | | | |
| QRadar adapter (inbound) | ✅ | — | ✅ | ✅ | Offense → Ticket |
| QRadar API client (mock) | ✅ | — | ✅ | 🔧 | Stub for testing |
| QRadar field mapping | ✅ | — | ✅ | ✅ | Normalizes QRadar fields |
| **Splunk** | | | | |
| Splunk adapter (inbound) | ✅ | — | ✅ | ✅ | Notable → Ticket |
| Splunk field mapping | ✅ | — | ✅ | ✅ | coalesce() pattern |
| **Generic Webhooks** | | | | |
| Webhook validation (HMAC) | ✅ | — | ✅ | ✅ | HMAC-SHA256 signature |
| Replay protection (nonce) | ✅ | — | ✅ | ✅ | De-dups within 5 min |

---

## User Management

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| User CRUD (admin) | ✅ | ✅ | ✅ | ✅ | Create, read, update, delete |
| Role assignment | ✅ | ✅ | ✅ | ✅ | Admin can set user roles |
| Password reset (admin) | ✅ | ✅ | ✅ | ✅ | UI live: `KeyRound`-Button je Benutzerzeile (`UsersPanel.tsx`), zeigt neues Passwort |
| User list (admin) | ✅ | ✅ | ✅ | ✅ | All users, filterable |

---

## Control-Plane / Provisioning

> Backend-administrierbare Node-/Agent-Registry. **Kein Apply-/Remote-/Netz-Kanal** in der gesamten Kette (per Test erzwungen) — Server sendet nur Status zurück, nie ausführbare Befehle. Kern live auf nexora seit `5e009c3` (2026-06-19).

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Enrollment-Profile (CRUD lite) | ✅ | ✅ | ✅ | ✅ | admin; Rolle + read-only Capabilities |
| Enrollment-Token mint | ✅ | ✅ | ✅ | ✅ | Klartext `enr_` **einmalig**, nur SHA-256-Hash gespeichert |
| Node enroll | ✅ | — | ✅ | ✅ | Token im Body (kein CSRF), Single-Use (consume-vor-mint) |
| Node-Credential-Handoff | ✅ | — | ✅ | ✅ | Betriebs-Credential `ncr_` einmalig; Heartbeat nur damit |
| Heartbeat (Node-Credential) | ✅ | — | ✅ | ✅ | Node-Bindung (`nodeId==:id` → 403); Antwort ohne Commands |
| Registry-UI `/provisioning` | ✅ | ✅ | ✅ | ✅ | admin-gated; Nodes + Profile + Detail-Modal |
| Postgres-Persistenz + Factory | ✅ | — | ✅ | ✅ | Migrationen 033–035; append-only Audit-Trigger |
| **Credential-Revoke (admin)** | ✅ | ✅ | ✅ | ✅ | **P_PROVISION_SECURITY_1 live deployt (PR #1, 2026-06-23).** CAS-idempotent; widerrufenes Credential → Heartbeat 401 |
| **Node-Retirement (admin)** | ✅ | ✅ | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** revoke-on-retire; retired Node → Heartbeat 403 |
| **Credential-Lifecycle-UI** | — | ✅ | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** Status-Badges (nur Präfix), Confirm-Dialog; Viewer read-only |
| **Rate-Limits /enroll + /heartbeat** | ✅ | — | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** Enroll pro-IP (nur Fehlversuche), Heartbeat pro-nodeId (NAT-sicher); kein Secret in 429 |
| FK node_credentials→installed_nodes | ✅ | — | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** Migration 037 (`NOT VALID`, idempotent) |
| Linux Bootstrap-Installer | ✅ | — | ✅ | ✅ | `deploy/install/`; bootstrap-only, Safety-Scan gegen Netz-/Apply-Befehle |
| Credential-Rotation | ❌ | ❌ | — | ❌ | Bewusst Folgeblock (neues Credential + Übergangsfenster) |

---

## Deployment Center — Network as Code (ADR-041)

> **Infra-schreibender Kanal:** vorkonfigurierte Appliances (OPNsense) deklarativ als VM auf Proxmox
> deployen (IP/VLAN/DNS/Ressourcen). Vertikaler Schnitt #1 „OPNsense → Proxmox", TDD, gebaut am
> bestehenden Apply-Kanal-Muster. **Status: lokal auf `p-phase0-close`, INERT** (`DEPLOY_ENABLED`
> default AUS), **nicht deployt/gemergt.** Runbook: `docs/01-architecture/deployment-center-runbook.md`.

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Domäne + Kataloge (Spec/Run/Module/Connector) | ✅ | — | ✅ | ✅ | immutabler secret-freier Spec-Hash; fail-closed State-Machine; Code-Allowlists (opnsense/proxmox) |
| paramSchema-Validierung | ✅ | — | ✅ | ✅ | Joi aus Modul-Schema (IPv4/CIDR/VLAN/DNS + Interface-Regex); `adminPassword` hart abgelehnt |
| Proxmox-Connector (Fake + REST) | ✅ | — | ✅ | ✅ | InMemory-Fake (CI, Fehler-Injektion) + REST (PVEAPIToken); **SSRF-Allowlist** (IPv4-only) + Metadata-deny |
| Deploy-Orchestrator + Gates | ✅ | — | ✅ | ✅ | Lifecycle + Rollback(`destroy`) + Safe-Stop(globale Sperre); Gates Kill-Switch→4-Augen→Reauth→Single-flight→Replay |
| Repository (InMemory + Postgres) | ✅ | — | ✅ 🔧 | ✅ | Factory; Migration **051/052**; Single-flight/Replay-Indizes; append-only Audit-Trigger (Postgres-Repo nur `node --check`) |
| OPNsense config.xml-Applier | ✅ | — | ✅ | 🔶 | Renderer XML-escaped + Applier (Retry/Idempotenz). **`deliver`-Kanal in den Gast fehlt** → Default fail-safe (wirft → Rollback) |
| Routen `/api/v1/deploy` (admin) | ✅ | — | ✅ | ✅ | modules/connectors/specs/plan/approve/apply/audit; `X-Reauth-Token` + `DEPLOY_ENABLED`-Gate + validateEnv-Fail-fast |
| deploy_reauth (One-Shot) | ✅ | — | ✅ | ✅ | `POST /auth/deploy-reauth` admin + Rate-Limit; jti-Konsum (kein Replay); getrennt von `apply_reauth` |
| Vier-Augen auf stabile User-ID | ✅ | ✅ | ✅ | ✅ | ID (sub) hat Vorrang vor E-Mail-Label (Case/IdP-Varianz); Migration 052 |
| UI `/deploy` (admin) | — | ✅ | ✅ | ✅ | Connector anlegen · Plan→Approve→Apply mit Passwort-Reauth; ehrliche Disabled-Zustände; **live im Browser verifiziert (kein Token-Leak)** |
| Live-Smoke auf Proxmox | — | — | — | ⏳ | braucht Golden-Template + API-Token + VLAN-Bridge (Operator/Hardware) |
| agent-install (Linux-/Windows-Client, Wazuh-Agent per SSH) | ✅ | ✅ | ✅ | ✅ | **live auf CT120 via lokale Gitea**; `sshExecRunner` (ssh2, In-Memory-Key, Host-Key-Pinning, scriptId-Allowlist); `ssh-systemd`/`ssh-powershell`; inert hinter `DEPLOY_ENABLED` |
| Windows-Server vm-clone → permanenter managed Node | ✅ | ✅ | ✅ | ✅ | Auto-Register in der Provisioning-Registry beim `deployed`; Host-Key Option-1-Auto-Capture (best-effort) |
| Platform-Deploy-Keypair (Auth-Modell A) + Host-Key-Pinning | ✅ | ✅ | ✅ | ✅ | ed25519, Private-Key AES-256-GCM at-rest (nie herausgegeben); Pin = SHA-256, **kein TOFU**; Option 2 Arm-Confirm; Migration 055 |
| Node-Update („updatebar", Windows + Linux) | ✅ | ✅ | ✅ | ✅ | `nodeUpdateService` OS→Skript/User; gated (`NODE_UPDATE_ENABLED` default AUS) + Reauth + fail-closed; `ManagedNodesPanel`-UI; **security-reviewed** (kein CRIT/HIGH); inert bis Scharfschaltung |
| Node-Update Live-Smoke | — | — | — | ⏳ | braucht Golden-Template + `NODE_UPDATE_ENABLED` + Deploy-Pubkey im Host + GO. Runbook: `deployment-center-node-update-runbook.md` |
| Weitere Module / ESXi-Connector | ❌ | ❌ | — | ❌ | bewusst später (YAGNI); Erweiterung nach Modul-/Connector-Vertrag |

---

## Compliance — NIS2 Readiness (P_NIS2_1)

> **Ehrlich: kein Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten** (per Test erzwungen). Arbeits-/Nachweis-Unterstützung. Live auf nexora seit `5e009c3` (2026-06-19).

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Control-Katalog (10 Maßnahmenbereiche) | ✅ | ✅ | ✅ | ✅ | Statisch/versioniert, stabile Keys |
| Assessment (Status je Control) | ✅ | ✅ | ✅ | ✅ | `not_started…addressed/not_applicable` (n/a braucht Begründung) |
| Evidence-Links (8 Typen) | ✅ | ✅ | ✅ | ✅ | `ref` hart validiert (http/https, keine Secret-Query/Fragment-Keys) |
| Readiness-Signale | ✅ | ✅ | ✅ | ✅ | overdue / missingEvidence / needsReview (addressed ohne Evidence ⇒ review) |
| Registry-UI `/compliance/nis2` | ✅ | ✅ | ✅ | ✅ | KPIs + Detail-Panel; Admin-Edit, Viewer read-only |
| Audit-Redaction | ✅ | — | ✅ | ✅ | nur sichere Metadaten, nie notes/URL |
| Incident-Evidence-Verknüpfung (P_NIS2_2) | ✅ | ✅ | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** `POST /controls/:key/incident-evidence` (admin); Ticket validiert, nur sichere Snapshot-Felder, kein PII |
| Management-Readiness-Report (P_NIS2_2) | ✅ | ✅ | ✅ | ✅ | **live deployt (PR #1, 2026-06-23).** `GET /report` (viewer+); Status-Verteilung + Evidence-/Incident-Coverage + Disclaimer; kein Konformitäts-Claim |
| P_NIS2_3 (vertiefte Nachweisführung) | ❌ | ❌ | — | ❌ | Nächster NIS2-Folgeblock (geplant) |

---

## System & Monitoring

| Feature | Backend | Frontend | Tests | Status | Notes |
|---------|---------|----------|-------|--------|-------|
| Health endpoint (/health) | ✅ | — | ✅ | ✅ | DB status, uptime |
| Prometheus metrics (/metrics) | ✅ | — | ✅ | ✅ | HTTP latency, errors, etc. |
| Audit logging | ✅ | — | ✅ | ✅ | Append-only, all actions |
| Audit log query | ✅ | ✅ | ✅ | ✅ | By action, actor, resource |
| Audit-Export (CSV) | — | ✅ | ✅ | ✅ | „CSV-Export"-Button in `AuditLogPage`; reine `auditEntriesToCsv` (RFC-4180 + CSV-Injection-Schutz), gefilterte Einträge, UTF-8-BOM. PDF offen |
| Request tracing (RequestID) | ✅ | — | ✅ | ✅ | Unique per request |
| Error handling | ✅ | ✅ | ✅ | ✅ | Global handler, structured errors |
| Input validation (Joi) | ✅ | — | ✅ | ✅ | All routes validated |
| Rate limiting | ✅ | — | ✅ | ✅ | Global + webhook-specific |
| CORS | ✅ | — | ✅ | ✅ | Configurable origins |
| Security headers (Helmet / API) | ✅ | — | ✅ | ✅ | Für die JSON-API via `helmet` aktiv |
| Frontend CSP via nginx | 🔶 | — | — | 🔶 | Header ist jetzt im nginx-Repo-Stand ergänzt; produktiv erst bestanden, wenn Live-Header + UI/Docs-Rendering verifiziert sind |
| TLS erzwingen (App-Guard) | ✅ | ✅ | ✅ | ✅ | Settings → Sicherheit; lehnt HTTP ab (default aus), /health frei |
| IP-Allowlist (App-Guard) | ✅ | ✅ | ✅ | ✅ | Settings → Sicherheit; IPv4/CIDR, fail-safe (default aus, leere Liste = alle), /health frei |

---

## Frontend-Specific

| Feature | Status | Notes |
|---------|--------|-------|
| Dark/Light theme | ✅ | Toggle in header |
| Responsive layout | ✅ | Works on 320–2560px |
| Component library | ✅ | Buttons, cards, badges, modals |
| Table pagination | ✅ | Limit + offset |
| Search / filter UI | ✅ | Real-time filtering |
| Form validation | ✅ | Client-side feedback |
| Loading states | ✅ | Spinners, skeletons |
| Error messages | ✅ | User-friendly + structured |
| Accessibility (ARIA) | 🔶 | Partial (focus management, labels) |
| Keyboard shortcuts | ❌ | Not implemented |

---

## Deployment & Infrastructure

| Feature | Status | Notes |
|--------|--------|-------|
| Docker multi-stage build | ✅ | Backend + frontend |
| docker-compose.dev | ✅ | Full stack with hot-reload |
| docker-compose.prod | ✅ | Nginx + TLS + multi-container |
| Nginx reverse proxy | ✅ | Port 443 (TLS), 80 (redirect) |
| PostgreSQL migrations | ✅ | Auto-run on startup |
| Environment variables | ✅ | Comprehensive .env.example |
| Health checks | ✅ | Docker + K8s ready |
| Logging (structured) | ✅ | JSON format |
| Backup automation | ✅ | `deploy/backup-db.sh` + Cron 03:30 auf nexora, Restore dokumentiert |

---

## Documentation

| Type | Status | Link |
|------|--------|------|
| API Reference | ✅ | `docs/04-developer-guide/api-reference.md` |
| Developer Guide | ✅ | `docs/04-developer-guide/developer-guide.md` |
| User Guide | ✅ | `docs/02-user-guide/user-guide.md` |
| Architecture (Arc42) | ✅ | `docs/01-architecture/arc42.md` |
| Architecture Decisions (ADRs) | ✅ | `docs/adr/decisions.md` |
| Roadmap | ✅ | `ROADMAP.md` |
| Changelog | ✅ | `CHANGELOG.md` (Keep-a-Changelog) |
| Contributing Guidelines | ✅ | `CONTRIBUTING.md` |
| Security Policy | ✅ | `SECURITY.md` (Responsible Disclosure) |
| Technischer Review (2026-08-04) | ✅ | `docs/00-overview/technical-review-2026-08-04.md` |
| Architektur-Reifegrad | ✅ | `docs/01-architecture/architecture-maturity.md` |
| CCD-Wertesystem — Grad-Einstufung | ✅ | `docs/00-overview/ccd-assessment-2026-08-04.md` |

---

## Testing Coverage

| Component | Test Count | Coverage | Status |
|-----------|-----------|----------|--------|
| Backend (Jest) | 278 Suiten / 3562 Tests | Windows-Vollsuite grün mit test-only bcrypt-Rounds; Prod-Audit 0 high/critical | ✅ |
| Frontend (Vitest) | 126 Dateien / 1333 Tests | typecheck grün · eslint 0 Errors · Vite-Build grün | ✅ |
| Data Plane (Node test) | 178 Tests | 176 passed / 2 skipped (`DATAPLANE_TEST_DB_URL` fehlt lokal) | ✅ |
| E2E (Playwright) | 12 Specs | mocked-API **+ echtes Backend (InMemory)**, Chromium — **in CI verdrahtet** (`ci.yml`: `e2e` + `e2e-real`) | ✅ |

---

## Known Limitations & TODOs

### Short-term (Next Sprint) — verifiziert via Audit 2026-06-16

- [x] ~~**`requireAuth` vor `requireRole`** in `hosts.js`~~ **erledigt** (Bug: Route lieferte jedem 401; + Regressionstest) — `e83a253`
- [x] ~~**Unbounded `findAll()` paginieren**~~ **erledigt** für alle 6 Repos (User/UseCase/AnalysisTemplate/WazuhFpException/AgentSuggestion/Yara): `{ limit=1000, offset=0 }` Default-Cap, abwärtskompatibel, + Test — `82cb2f8` + `84f0143`
- [x] ~~**Ticket-Delete-UI** (admin-Trash-Button in `/tickets`)~~ **erledigt**
- [x] ~~**Echter PDF-Export**~~ **erledigt** — jsPDF-Download statt Browser-Print
- [x] ~~Dashboard „Top Erkennungsquellen"~~ **erledigt** — echte Top-Rules (engineer/admin), sonst ehrlicher Hinweis
- [x] ~~Profil Sprache/Datumsformat~~ **erledigt** — persistent (Migration 032, Self-Service)

**Audit-Funde als Nicht-Probleme verifiziert (kein Handlungsbedarf):**
- Settings-Tabelle: wird per `CREATE TABLE IF NOT EXISTS platform_settings` beim ersten Zugriff angelegt — kein Boot-Risiko (kein eigenes Migrations-SQL nötig).
- `notifications.js` + `apiTokens.js`: **umfassend getestet** (7 bzw. 4 Suiten — Route/Domain/Repo/Service) — Audit-Fund war veraltet.

### Medium-term

- [x] ~~Security-Welle 2: Lockout→Postgres · Passwort-Ablauf/History · Inaktivitäts-Timeout · Mehrfach-Sitzungen~~ **erledigt (ADR-019)**
- [x] ~~Security-Welle 3 (Kern)~~ **weitgehend erledigt:** **MFA/TOTP ✅ live** (Migration 038, deployt) · **PAT live ✅** (`API_TOKENS_ENABLED`, deployt) · **Audit-Export CSV ✅ + PDF ✅** · **SBOM (CycloneDX) + npm-audit-Gate ✅ in CI** (`security.yml`, wöchentlich) · **SSO/OIDC: Backend vorhanden** (`auth/oidc/*`, Migration 039) — *offen nur noch: In-UI-Admin-Konfig + SAML (OIDC-Login-UI ist live)*
- [x] ~~KI-Settings W2: Guardrails/Confidence/HITL + Metrik-Sidebar~~ **erledigt** — read-only Transparenz der echten Floors + Nutzungs-/Latenz-Metriken (`GET /v1/agent/guardrails` + `/metrics`)
- [x] ~~E2E-Tests (Playwright)~~ **erledigt + in CI:** 12 Specs (Auth · Navigation · Tickets · KI-Agent · NIS2 · Provisioning · Threat Hunts · Evidence · Analysis-Overview · Correlators · MFA · Report) laufen in `ci.yml` als **`e2e` (mocked)** UND **`e2e-real` (echtes Backend, InMemory)**. *Optional offen: echter-Backend-Smoke gegen Postgres statt InMemory*
- [x] ~~Auto-response actions (isolate host, etc.)~~ **Real-Exec gebaut + holistisch security-reviewed (APPROVE), INERT (ADR-042):** menschlich ausgelöste (kein Auto), gated Host-Isolation für genehmigte Containment-Aktionen — Kill-Switch `HUNT_RESPONSE_REAL_EXEC_ENABLED` (default AUS) + Circuit-Breaker + Reauth + Vier-Augen/Drei-Parteien + nur umkehrbares Paar `isolate_host`/`release_isolation` + Host-Key-Pinning (kein TOFU) + Mgmt-Preservation (Selbst-Aussperr-Schutz). Linux (nftables) + Windows (Firewall) über den gehärteten `sshExecRunner`. Mock-Pfad (`HUNT_RESPONSE_AUTO_EXECUTE_MOCK`) bleibt getrennt. *Offen: Operator-Lab-Smoke vor erstem Live-Arming; M-2 (verteilter Lock) vor Multi-Instanz.* Runbook: `docs/01-architecture/adr-042-containment-runbook.md`.
- [ ] Multi-SIEM unified dashboard
- [ ] P19c/d — lokales Modell + kontinuierliches Lernen (Vollausbau)
- [ ] Echter Postgres-Go-Live-Lasttest mit dokumentiertem Nachweis fuer Pool-Saettigung, Query-Timeouts und Dataplane-Rueckstau
- [ ] Live-Verifikation der nginx-CSP gegen Frontend, Wiki-Seiten und eingebettete Dokumentationsansichten

### Long-term (P22+)

- [ ] Mobile app (iOS/Android)
- [ ] Machine learning model training - MLE-Track vorbereitet (`ADR-039`, `docs/01-architecture/ml-training-plan.md`); Label-Contract vorhanden (`docs/01-architecture/ml-label-contract.md`); erste Backend-Schritte umgesetzt: redigierter Eval-Snapshot-Export `POST /api/v1/ml/eval/export`, Offline-Report mit fail-closed Routing-Gate (`npm run ml:eval-report`), referenzierbares Dataset-Packaging (`npm run ml:dataset-pack`), deterministische `train/validation/test`-Splits (`npm run ml:dataset-split`), Run-Initialisierung via `baseline-run.json` (`npm run ml:run-init`), fail-closed Baseline-Evaluation (`npm run ml:run-eval`), ein Readiness-/Gap-Report (`npm run ml:readiness`), ein Gold-Seed-/Merge-Workflow (`npm run ml:gold-merge`), eine End-to-End-Gold-Pipeline (`npm run ml:gold-pipeline`), ein Threshold-Vergleichslauf (`npm run ml:run-compare`) und ein Policy-Vergleichslauf (`npm run ml:run-policy-compare`); ein deploybares Routing-Policy-Artefakt (`npm run ml:policy-export` → `recommended-routing-policy.json`, Schema `nexora.ml.routing-policy.v1`); der belegte Threshold wirkt jetzt **advisory** in der KI-Triage (`routing`-Feld an Agent-Suggestions via `ML_ROUTING_POLICY_PATH`, ENV-gated, fail-safe, kein Auto-Handeln — `ADR-040`); read-only Admin-Seite `/ml-eval` + `GET /api/v1/ml/eval/status`; spaeter optional echtes Training/Fine-Tuning.
- [ ] SOAR integration (full bidirectional)
- [ ] Multi-tenancy support
- [ ] Zero-trust access (Twingate/Tailscale) - Architektur-/Security-Track vorbereitet (`ADR-038`, `docs/05-security/zero-trust-access-plan.md`); Produkt-/Provider-Entscheidung und Umsetzung offen.

---

## Phase Completion Status

| Phase | Name | Status | Completion |
|-------|------|--------|-----------|
| **S1** | Frontend Security | ✅ | 100% |
| **S2** | Test Basis | ✅ | 100% |
| **P3–P9** | Backend Skeleton | ✅ | 100% |
| **P10–P12** | Adapters (QRadar, Splunk, SN) | ✅ | 100% |
| **P13** | Threat Hunting | ✅ | 100% |
| **P13.UI** | System Frontend (React+TS) | ✅ | 100% |
| **P14** | DB Full Persistence | ✅ | 100% |
| **P15** | Proxmox Deploy | ✅ | 100% |
| **P15.UI–W5** | Analysis Deck + SIEM Dashboard | ✅ | 100% |
| **P16** | Evidence Collector | ✅ | 100% — Wazuh-basiert (FIM/Inventory), auto bei Wazuh-Ticket + `POST /tickets/:id/collect-evidence` |
| **P17** | Threat Intel Service | ✅ | 100% |
| **P18** | YARA Engine | ✅ | 100% |
| **P19** | KI-Agent | ✅ | 100% |
| **P19a** | Ollama Local LLM | ✅ | 100% |
| **P19b** | RAG Knowledge Base | ✅ | 100% |
| **P19c/d** | Local-model switch + continuous learning | 🔶 | 55% |

---

## How to Read This Matrix

**Example:** Ticket creation
```
Create ticket (manual)
├─ Backend: ✅ (Route + service + validation implemented)
├─ Frontend: ✅ (UI modal + form)
├─ Tests: ✅ (Unit + integration tests)
└─ Status: ✅ (PRODUCTION READY)
   └─ Notes: Full field validation
```

This tells you:
- All code is written
- All tests pass
- It's ready to use in production
- There are no known issues

---

## Last Updated

- **Stand:** 2026-07-06 (Dataplane-Live-Stack rekonstruiert; Security-/Ops-Doku nachgeschaerft; produktive Last-/CSP-Verifikation weiter als Pflicht offen).
- **Live-Branch:** `p-phase0-close` (lokal `5859e4e1`, 10 Commits vor `origin/p-phase0-close`, 164 Commits vor `main` — Push-/Merge-Strategie ausstehend).
- **Backend tests:** Vollsuite grün: 278 Suiten / 3562 Tests (`npx jest --runInBand --no-cache --silent`, `LOG_LEVEL=error`). Fix 2026-06-28: `NODE_ENV=test` nutzt bcrypt 4 Rounds, Produktion bleibt bei mindestens 12; `provisioningRateLimit.test.js` behält wegen App-Load ein explizites 30s-Timeout.
- **Frontend tests:** 126 Vitest-Dateien / 1333 Tests; typecheck, eslint und Vite-Build grün.
- **Data Plane tests:** 178 Tests, 176 passed / 2 skipped (`DATAPLANE_TEST_DB_URL` lokal nicht gesetzt).
- **E2E (Playwright):** 12 Specs mocked + echtes Backend (InMemory) in CI; lokaler Stand nicht neu geprüft.
- **Migrations:** bis 045 (Postgres, `pg_migrate_done count:45` live verifiziert)
- **Production deployment:** Live on nexora.example (10.99.99.75); letzter dokumentierter Live-Stand: interne Mailserver-/Notification-Kette am 2026-06-27 verifiziert.
- **Wazuh integration:** 4.14.5, fully functional
- **KI-Agent:** Live on Ollama (llama3.2:3b); Cloud-Provider (Anthropic/OpenAI/Google) opt-in
- **CE-5.3 FQDN-Resolver:** Deployed 2026-06-17 (FQDN_RESOLVER_ENABLED=true auf nexora, forward-confirm gegen 10.99.99.10)
- **Letzter Audit:** 2026-06-16 · **Stand verifiziert:** 2026-06-17
