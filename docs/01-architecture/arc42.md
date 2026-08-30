# Arc42 — Nexora SOC Orchestrator

**Gültig ab:** 2026-06-20  
**Version:** 1.1  
**Status:** Production (`v0.1.0`) — live auf nexora.example (10.99.99.75)

> **Live-Stand (deployt):** `41d8d92` (2026-06-20) — MFA/TOTP + Personal Access Tokens aktiviert.
> Spätere Bausteine (E-Mail/SMTP-Kanal, SSO/OIDC, WebAuthn/Passkey, NIS2-Review-Kadenz) sind
> **lokal gebaut und getestet, aber noch nicht deployt** — im Text als „**lokal**" gekennzeichnet.
> `/health` meldet die laufende Version (Deploy-Verifikation, SemVer-Policy seit `v0.1.0`).

---

## 1. Einführung & Ziele

### 1.1 Was ist Nexora SOC?

Nexora ist ein **Enterprise-SOC-Ticket-Orchestration-System**: Eine Plattform zur Triage, Analyse und Verwaltung von Security-Incidents. Das System:

- **Integriert externe SIEM-/Detection-Quellen** (Wazuh, IBM QRadar, Splunk, CrowdSec-WAN) und sammelt Alerts/Offenses
- **Erstellt Tickets** aus den eingehenden Events, dedupliziert und aggregiert sie
- **Korreliert pro Incident** (Correlation Engine CE-1…CE-5): Quellen-Normalizer, Host-Case-Aggregation, Network/NAT-Flow-Modell, Inventory- + FQDN-Anreicherung — alles mit Provenance, **keine erfundenen Werte**
- **Unterstützt Threat Hunting** mit vorgefertigten, One-Click-Hunts auf lokalen/Remote-Systemen
- **Nutzt lokale KI** (Ollama + Llama 3.2; Cloud-Provider opt-in) zur Vorschlag-Generierung und Analyse
- **Bietet sichere Automation** (Safe Command Console, Approval-Gates, Human-in-the-loop)
- **Verwaltet eine Control-Plane / Node-Registry** (Provisioning, Enrollment, Heartbeats, Linux-Installer) — **read-only, kein Apply-/Remote-/Netz-Kanal**
- **Unterstützt NIS2-Readiness & Evidence** (Control-Katalog, Assessment, Nachweis-Links) — **ehrlich: kein Konformitätsnachweis, keine Zertifizierung**
- **Benachrichtigt nach außen** (Slack/Webhook/Teams/E-Mail) und exportiert Tickets/Reports/Audit (ServiceNow/OTRS, PDF/CSV)
- **Bleibt self-hosted** und kann offline oder in geschlossenen Netzen betrieben werden

**Kern-Workbench:** SOC-Analyst öffnet `/analysis`, sieht Tickets aggregiert nach Host/Case, kann:
1. Ticket öffnen → Evidence/MITRE/IOCs anschauen
2. Hunt starten → Threat-Intelligence sammeln
3. KI-Vorschlag erhalten → approve/reject
4. False-Positive-Regel erzeugen → auf Wazuh deployen
5. Ticket schließen mit Begründung → History trackt alles

### 1.2 Stakeholder

| Rolle | Anliegen | Anforderungen |
|---|---|---|
| **SOC Analyst** (Tier 1–3) | Schnelle Triage, wenig Klicks | Intuitive UI, vorgefertigte Hunts, ein Klick = ein Ergebnis |
| **Security Engineer** | Automation, Reproduzierbarkeit | KI-Regeln, FP-Ausnahmen, Audit-Trail |
| **SOC Lead / Manager** | Metriken, Trends, Compliance | Dashboard, KPIs, Activity-Log, Export |
| **IT-Operations / Deployment** | Stabilität, Monitoring, Scale | Docker, Proxmox, Health-Checks, Prometheus |

### 1.3 Qualitätsziele

| Ziel | Maßnahme |
|---|---|
| **Security** | Keine XSS/CSRF/Injection; CSP + HSTS; Cookie-only-Session (httpOnly `soc_token`) + CSRF-Double-Submit (ADR-017); MFA/TOTP, SSO/OIDC, WebAuthn/Passkey; bcrypt; Audit append-only; SBOM + Dependency-Scan (`security.yml`) |
| **Availability** | Stateless Backend, Postgres, Docker-Compose, Health-Checks, Retry-Mechanismen |
| **Maintainability** | Repository-Pattern, Adapter-Layer, 80%+ Test-Coverage (~2720 BE / ~912 FE), CCD-Grad 2+ |
| **Performance** | Pagination, Indexe, Caching (u. a. persistenter Postgres-TI-Cache), OpenSearch-Aggregationen (Wazuh-Indexer) |
| **Compliance** | Audit-Trail (redaktiert), DSGVO-konform (PII-Hashing), NIS2-Readiness-Unterstützung (kein Konformitätsnachweis), Cloud-LLM nur opt-in |
| **Integrität / „No-Fake"** | Correlation: fehlt ein Wert → `null` + `missingReason` + `provenance`; Control-Plane ohne Apply-/Remote-Kanal (per Test erzwungen) |

---

## 2. Randbedingungen

### 2.1 Technologie-Stack

**Backend:**
- Node.js 20+ / Express.js
- PostgreSQL 14+ (Persistenz, Audit, Dedup-Keys)
- pg-boss (Queue / Worker für Webhooks)
- Joi (Input-Validierung)

**Frontend:**
- React 18 + TypeScript + Vite
- Zustand (State)
- TanStack Query (Server-State)
- Vitest + Playwright (Tests)

**Integrations & KI:**
- Wazuh 4.14.5+ (SIEM, Agent-API, Indexer-OpenSearch)
- Ollama (lokales LLM, CPU-only, llama3.2:3b); Cloud-Provider (Anthropic/OpenAI/Google) **opt-in**, Keys AES-256-GCM at-rest (ADR-018)
- Qdrant (Vector-DB für RAG: MITRE-ATT&CK + Hunt-Katalog + past_incidents)
- Adapter-Pattern (QRadar, Splunk, ServiceNow, OTRS, CrowdSec-WAN)
- nodemailer (SMTP-Versand, lazy geladen, **lokal**); jsPDF (PDF-Reports/-Export, dynamisch geladen)

**Auth-Bausteine (Security-Welle 3):**
- TOTP (RFC 6238, **ohne** externe Lib, Node `crypto`) — MFA **live**
- `@simplewebauthn/server` + `/browser` (FIDO2/Passkey, **lokal**)
- OIDC: PKCE/S256 eigener Client + `jose` (JWKS, **lokal**)

**Infrastruktur:**
- Docker Multi-Stage (dev + prod)
- Nginx 1.25+ (Reverse Proxy, TLS)
- Proxmox 8.x (LXC-Host)
- Ubuntu 24.04 LTS (Runtime)

### 2.2 Betriebliche Anforderungen

- **Single Tenant** (keine Multi-Tenancy, User gehören zu einer Organization)
- **Offline-fähig** (kein Cloud-API für LLM, alles lokal)
- **DSGVO-konform** (PII nicht geloggt, Betroffenenrechte, TOM)
- **Stateless Backend** (Scale horizontal, kein Session-Store)
- **Audit-Pflicht** (jede Änderung wird geloggt, append-only)

### 2.3 Einschränkungen

- **KI standardmäßig lokal** — Ollama on-prem; Cloud-Provider sind **opt-in** und kennzeichnungspflichtig (Daten verlassen das Netz → AVV nötig, ADR-018)
- **Keine Secrets in Code** — `.env` pflichtgemäß; Cloud-Keys at-rest verschlüsselt; `enr_`/`ncr_`-Credentials nur als SHA-256-Hash gespeichert (Klartext genau einmal)
- **Control-Plane ohne Steuerkanal** — Provisioning/Enrollment/Heartbeat liefern **nie** ausführbare Befehle zurück; kein Apply-/Remote-Exec-/Netz-/Wazuh-Write-Kanal (per Test erzwungen)
- **NIS2 = Arbeits-/Nachweis-Unterstützung** — **kein** Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten (per Test erzwungen)
- **Nicht für SOAR-Replacement** — wir sind Triaging/Analysis, nicht breites Automation-Framework
- **Nur echte Incidents** — Demo-Daten entfernt (ADR-009); Correlation erfindet keine Werte (No-Fake)

---

## 3. Kontextabgrenzung

### 3.1 Externe Systeme

```
┌──────────────────────────────────────────────────────────────┐
│  Nexora SOC (Backend 3000 + Frontend 5173, hinter nginx 443) │
├──────────────────────────────────────────────────────────────┤
│  EINGEHEND (Detection/Alerts):                               │
│  ├─ Wazuh Manager (10.99.99.77:55000) ← Alerts/Events        │
│  ├─ Wazuh Indexer (OpenSearch :9200) ← Searches/Aggregat.   │
│  ├─ QRadar / Splunk (optional inbound webhook)              │
│  └─ CrowdSec-LAPI (Webserver-WAN, Poller, Machine-JWT)      │
│  KI / WISSEN:                                               │
│  ├─ Ollama (192.168.240.78:11434) ← LLM-Inference            │
│  ├─ Cloud-LLM (Anthropic/OpenAI/Google, opt-in)            │
│  └─ Qdrant (6333) ← Vector-Embeddings (RAG)                │
│  PERSISTENZ:                                               │
│  └─ PostgreSQL (5432) ← Tickets/Audit/TI-Cache/Provisioning │
│  AUSGEHEND (Export/Notify):                                │
│  ├─ ServiceNow / OTRS (Ticket-Export + Status-Sync)        │
│  └─ Slack / Webhook / Teams / SMTP-Mail (Notifications)    │
│  AUTH (optional, opt-in):                                  │
│  └─ OIDC-IdP (Authorization Code + PKCE) — SSO (lokal)     │
│  CONTROL-PLANE (node-facing, read-only):                  │
│  └─ Installierte Nodes ── enroll (Token) → Heartbeat (ncr_) │
└──────────────────────────────────────────────────────────────┘
```

**Datenfluss:**
1. **Wazuh Alert** → Webhook → `/integrations/wazuh` → Queue → Processor → Ticket + Evidence
2. **CrowdSec-WAN** → Poller (`pollOnce`) → `integrationService.ingest('crowdsec', …)` → Adapter → Dedup/Normalize/Queue → Ticket _(Pipeline lokal end-to-end; Live-ENV offen)_
3. **Correlation** (CE-1…CE-5) → Quellen-Normalizer + Host-Case + Flow-Modell + Inventory- + FQDN-Anreicherung → `CorrelationResult` (Provenance + missingReason)
4. **Threat Hunt** → Runner (lokal) → Findings → Persist
5. **KI-Agent** → EvidenceBundle (normalisierte Entities + Inventory + RAG) → Ollama/Cloud → strukturiertes `analysis`-Objekt → Verdict-Floors (Benign/Evidence) → Approval-Queue (Details: ADR-014, `local-llm-architecture.md`)
6. **False-Positive-Regel** → Wazuh-Adapter → Rule-JSON → Wazuh-API (PUT /rules, hinter Gate)
7. **Outbound** → Ticket-Export (ServiceNow/OTRS) · Notifications (Slack/Webhook/Teams/Mail) · Reports/Audit (PDF/CSV) — alle default-aus, ENV-gated
8. **Control-Plane** → Node enroll (Enrollment-Token im Body) → Node-Credential-Handoff (`ncr_`) → Heartbeat (read-only Inventar); Server-Antwort enthält **nie** Befehle

### 3.2 Benutzer-Interaktion

```
SOC Analyst
    ↓
Login (Cookie-Session soc_token; optional MFA-Challenge / SSO / Passkey)
    ↓
Dashboard / Analysis-Seite
    ├─ Tickets (Filter/Sort, Export, Reports)
    ├─ Threat Hunts (Library + Console)
    ├─ Detection Library (YARA/Rules, Custom-Rules)
    ├─ KI-Agent (Proposals → Approve/Reject)
    ├─ Evidence Center (IoCs, Hashes, IPs)
    ├─ Hosts (Wazuh-Agent-Inventory, Health)
    ├─ Compliance → NIS2 (Readiness + Management-Report)   [viewer+ / admin]
    ├─ Provisioning (Node-/Agent-Registry)                 [admin]
    ├─ Audit-Log (Export CSV/PDF)
    ├─ Profile (MFA/Passkey/PAT-Selbstverwaltung — alle Rollen)
    └─ Settings (Theme, KI-Provider, Sicherheit, Notifications)
    ↓
Close Ticket · Export (PDF/CSV) · Incident-/Kunden-Report
```

---

## 4. Lösungsstrategie

### 4.1 Kernansätze

**Adapter-Pattern:**  
Externe Systeme sind abstrakt hinter `BaseAdapter`. Feldmappings sind lokal; das interne Modell bleibt stabil.

**Repository-Pattern:**  
Datenzugriff ist abstrahiert (InMemoryRepository für Tests, PostgresRepository für Prod).

**Event-Driven:**  
Webhooks → Queue → Worker → Domain Events → Services → Persistierung.

**Human-in-the-Loop:**  
Keine automatische Änderung an Wazuh ohne Approval. KI-Vorschläge müssen bestätigt werden. Autonomie ist ein konfigurierbares, default-ausgeschaltetes, evidenz-gebundenes Gate (ADR-016, inert).

**Local-First (mit Cloud-Opt-in):**  
Ollama läuft lokal; Cloud-LLM nur opt-in (ADR-018). RAG mit Qdrant.

**No-Fake / Provenance-First:**  
Correlation und FQDN-Anreicherung erfinden keine Werte — fehlt etwas, steht `null` + `missingReason` + `provenance` (Quelle ×N). Forward-confirm beim DNS (A-Record muss == Flow-IP).

**Read-only Control-Plane:**  
Die Node-/Agent-Registry verwaltet Zustände, sendet aber **nie** ausführbare Befehle an Nodes — kein Apply-/Remote-/Netz-Kanal (per Test erzwungen).

**Ehrliche Compliance-Position:**  
NIS2-Readiness unterstützt die Nachweisführung, behauptet aber keinen Konformitäts-/Zertifizierungsstatus (per Test erzwungen).

### 4.2 Technische Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Express statt Next.js | Backend-only; Frontend separat (React) → klare Trennung |
| PostgreSQL statt MongoDB | ACID, komplexe Queries (Audit), Normalisierung, Full-Text-Search |
| Ollama (Cloud opt-in) | Offline/DSGVO-Default; Cloud nur bei bewusster Aktivierung (ADR-018) |
| pg-boss statt Bull | PostgreSQL-nativ, nicht Redis-abhängig, Durability |
| Cookie-only + CSRF statt Bearer-im-localStorage | XSS kann den Token nicht mehr stehlen (ADR-017); Bearer/PAT bleiben für API-Clients |
| TOTP/WebAuthn ohne schwere Libs | TOTP per Node `crypto` (RFC 6238), Passkey via `@simplewebauthn` — supply-chain-arm |
| Enrollment-Token ≠ Betriebs-Credential | Single-use `enr_` → `ncr_`-Handoff; nur Hash gespeichert, kein Steuerkanal |

---

## 5. Bausteinsicht

### 5.1 Schicht 1: Externe Schnittstellen

```
┌────────────────────────────────────────────────────────┐
│  Frontend (React, Port 5173)                            │
│  ├─ Auth (LoginPage: Passwort + MFA/SSO/Passkey)        │
│  ├─ Dashboard (KPIs, Recent Activity, Top-Detections)   │
│  ├─ Analysis (Tickets, Filters, Detail, Reports)        │
│  ├─ Threat Hunts (Library + Console)                    │
│  ├─ Detection (YARA, Rules, Custom-Rules)               │
│  ├─ KI-Agent (Proposal Queue, Guardrails-Sidebar)       │
│  ├─ Hosts (Agent Inventory, Health)                     │
│  ├─ Compliance/NIS2 (Readiness + Management-Report)     │
│  ├─ Provisioning (Node-Registry, admin)                 │
│  ├─ Audit-Log (Export CSV/PDF)                          │
│  ├─ Profile (MFA/Passkey/PAT-Selbstverwaltung)          │
│  └─ Settings (KI-Provider, Sicherheit, Notifications)   │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  Backend API (Express, Port 3000)                       │
│  Routes: /v1/{auth, mfa, auth/oidc, auth/webauthn,     │
│           tokens, profile, tickets, hunts, yara,        │
│           detections, agent, evidence, hosts, siem,     │
│           nis2, provisioning, notifications, settings,   │
│           audit, …}; pro Route requireAuth+requireRole │
└────────────────────────────────────────────────────────┘
```

### 5.2 Schicht 2: Anwendungs-Services

```
┌────────────────────────────────────────────────────────┐
│ Application Service Layer                                │
├────────────────────────────────────────────────────────┤
│ Kern:                                                    │
│ • AuthService          (Cookie-Session, Password, CSRF)  │
│ • TicketService        (CRUD, Dedup)                     │
│ • HuntService          (Sessions, Runs)                  │
│ • AgentService         (LLM-Propose, Verdict-Floors)     │
│ • AuditService         (Append-Only, redaktiert)         │
│ • WazuhFpExceptionSvc   (Rule-Builder, Apply-Gate)       │
│ • ThreatIntel (+ Postgres-Cache, überlebt Neustart)     │
│ • YaraService          (Pattern-Match)                   │
│ • EvidenceService      (Chain-of-Custody, SHA-256)       │
│ • AutonomyEvaluator    (Gate, inert/Default-Deny)        │
│ Auth-Welle 3:                                            │
│ • MfaService (TOTP) · oidcService · webAuthnService      │
│ • ApiTokenService (PAT)                                  │
│ Outbound:                                                │
│ • NotificationService + notificationOutbound             │
│   (Slack/Webhook/Teams/E-Mail)                           │
│ • ExternalTicketService (ServiceNow/OTRS Export+Sync)    │
│ Control-Plane:                                           │
│ • EnrollmentTokenService · NodeCredentialService         │
│ • NodeEnrollmentService (enroll/heartbeat/retire)        │
│ Compliance:                                              │
│ • Nis2ReadinessService (Katalog⨝Assessment⨝Evidence)    │
│ Correlation:                                             │
│ • CorrelationEngine (CE-1…CE-5) + fqdnResolver           │
└────────────────────────────────────────────────────────┘
```

Jede Service kapselt Business-Logic und delegiert Persistierung an Repositories.
**Wiring-Hinweis:** Im InMemory-Modus teilen Service-Singletons keinen State über mehrere Factory-Aufrufe — die Provisioning-Route injiziert **eine** geteilte Repo-Instanz in alle drei Control-Plane-Services.

### 5.3 Schicht 3: Domain Model

```
Domain / Entities
├─ Ticket
│  ├─ id, number (fortlaufend)
│  ├─ title, description
│  ├─ source (wazuh | qradar | splunk | manual)
│  ├─ state (OPEN | CLOSED)
│  ├─ status (assigned | in_progress | on_hold | awaiting_customer)
│  ├─ close_reason (resolved | false_positive | benign | duplicate | other)
│  ├─ priority, severity
│  ├─ srcIp, dstIp, port, protocol
│  ├─ assignedTo, owner
│  ├─ parent_id (Host-Case-Link)
│  ├─ created_at, updated_at
│  └─ Relationen
│     ├─ Evidence[]
│     ├─ Comments[]
│     ├─ ExternalLinks[] (externe Systeme)
│     └─ AgentSuggestions[]

├─ Evidence
│  ├─ id, ticketId, source (wazuh_event | hunt_finding | vt | ...)
│  ├─ title, description
│  ├─ severity, confidence
│  ├─ data (JSONB, flexibel)
│  └─ created_at

├─ User
│  ├─ id, email, displayName
│  ├─ role (admin | engineer | analyst | viewer)
│  ├─ password_hash (bcrypt)
│  └─ created_at, last_login

├─ AuditLog (append-only)
│  ├─ id, timestamp
│  ├─ actorUserId, actorLabel
│  ├─ action (CREATE_TICKET | UPDATE_TICKET | ...)
│  ├─ resourceType, resourceId
│  ├─ metadata (Änderungen)
│  ├─ ip (SHA-256)
│  └─ request_id (Traceability)

├─ HuntSession
│  ├─ id, createdBy
│  ├─ hunt_id, config
│  ├─ status (RUNNING | COMPLETED | FAILED)
│  ├─ findings[]
│  └─ created_at, completed_at

├─ AgentSuggestion
│  ├─ id, ticketId, type (fp_rule | escalate | ...)
│  ├─ status (pending | approved | rejected)
│  ├─ proposedBy (KI-Agent)
│  ├─ approvedBy, approvalDate
│  ├─ payload (Rule-JSON, text, etc.)
│  ├─ analysis (JSONB, snake→camel, native Entity-Karten — ADR-014)
│  └─ created_at

├─ Auth-Welle 3 (Security-Welle 3)
│  ├─ MfaEnrollment   (TOTP-Secret, Recovery-Codes; Migration 038) — **live**
│  ├─ ApiToken (PAT)  (Präfix + Hash, scope; Migration 030) — **live**
│  ├─ UserOidcLink    (sub↔userId; Migration 039) — **lokal**
│  └─ WebAuthnCredential (credentialId/publicKey/counter; Migration 040) — **lokal**

├─ Control-Plane / Provisioning (6 Entities + Credentials)
│  ├─ ProvisioningProfile   (draft→validated→approved→retired)
│  ├─ EnrollmentProfile     (Rolle + read-only Capabilities)
│  ├─ InstalledNode         (pending→enrolled→active→stale→retired)
│  ├─ NodeCapability        (read-only Allow-List)
│  ├─ NodeHeartbeat         (healthy | degraded | offline)
│  ├─ ProvisioningAuditEvent (append-only, redaktiert)
│  ├─ EnrollmentToken (`enr_`, **nur SHA-256-Hash**, single-use; Migration 034)
│  └─ NodeCredential  (`ncr_`, **nur SHA-256-Hash**, Heartbeat-Auth; Migration 035, FK 037)

├─ Compliance / NIS2 (Migration 036)
│  ├─ Nis2ControlCatalog (10 Maßnahmenbereiche, statisch/versioniert, stabile Keys)
│  ├─ Nis2Assessment     (not_started…addressed/not_applicable; n/a braucht Begründung)
│  └─ Nis2EvidenceLink   (8 Typen; `ref` hart validiert; addressed ohne Evidence ⇒ needsReview)

├─ AutonomyPolicy (ADR-016, inert; Migration 027)
│  └─ customer × actionClass × mode (advisory|assisted|autonomous), Default-Deny

└─ CorrelationResult (laufzeit-berechnet, nicht persistiert)
   ├─ entities[] (mit provenance, Quelle ×N)
   ├─ network.flows[] (Firewall + Sysmon E3; je Feld provenance + missingReason)
   ├─ sourceHostInterface vs. firewallInterface (getrennt — CE-4.3)
   └─ sourceFqdn/destinationFqdn (Event-Computer > Inventory > DNS-forward-confirm — CE-5.3)
```

### 5.4 Schicht 4: Data Access (Repository Pattern)

```
┌─────────────────────────────────────────┐
│ Repository Interface                    │
├─────────────────────────────────────────┤
│ TicketRepository                        │
│ • findAll(filters) → Ticket[]           │
│ • findById(id) → Ticket                 │
│ • create(data) → Ticket                 │
│ • update(id, data) → Ticket             │
│ • delete(id) → void                     │
│ • findByOffense(source, offenseId)      │
│ • findByParentId(parentId)              │
└─────────────────────────────────────────┘
       ↓ implements ↓
┌──────────────────┬──────────────────┐
│ PostgresRepository    │ InMemoryRepository   │
│ (Prod)                │ (Tests/Dev)          │
└──────────────────┴──────────────────┘
```

Jede Entity hat ein Repository; Tests nutzen InMemory, Prod nutzt Postgres via Query-Builder oder ORM.

### 5.5 Schicht 5: Integration & Adapter

```
┌──────────────────────────────────────────┐
│ Integration Layer                        │
├──────────────────────────────────────────┤
│ Webhook-Intake                           │
│ ├─ HMAC-Verifikation                     │
│ ├─ Replay-Schutz (nonce)                 │
│ └─ Event-Parsing                         │
│                                          │
│ Adapter (Processors)                    │
│ ├─ WazuhProcessor (Alert → Ticket)       │
│ ├─ QRadarProcessor (Offense → Ticket)    │
│ ├─ SplunkProcessor (Notable → Ticket)    │
│ └─ ManualEventProcessor                  │
│                                          │
│ External API Clients                    │
│ ├─ WazuhApiClient (Manager)              │
│ ├─ WazuhIndexerClient (OpenSearch)       │
│ ├─ QRadarClient (REST)                   │
│ ├─ ThreatIntelClient (VT, AbuseIPDB)    │
│ ├─ OllamaClient (LLM)                    │
│ └─ QdrantClient (Vector-DB, opt.)        │
└──────────────────────────────────────────┘
```

### 5.6 Schicht 6: Persistierung & Queue

```
PostgreSQL (Primary) — Migrationsstand bis 040, laufen additiv beim API-Boot
├─ tickets · evidence · evidence_custody · users
├─ audit_logs (append-only)
├─ agent_suggestions (+ analysis JSONB)
├─ hunt_sessions · hunt_findings · hunt_ticket_links
├─ yara_patterns · published_detections
├─ external_ticket_links · fp_exceptions
├─ threat_intel_cache            (persistenter TI-Cache, überlebt Neustart)
├─ autonomy_policies             (027, inert)
├─ notifications (029) · api_tokens (030)
├─ password_aging (031) · user_prefs (032) · user_profile_fields (028)
├─ Control-Plane (033–035, 037):
│  ├─ provisioning_*             (append-only Audit-Trigger blockt UPDATE/DELETE)
│  ├─ enrollment_tokens          (token_hash UNIQUE, nie Klartext)
│  └─ node_credentials           (FK → installed_nodes, NOT VALID + CASCADE)
├─ nis2_* (036)                  (Assessment unique je Control, Evidence-FK CASCADE)
└─ Auth-Welle 3:
   ├─ mfa_enrollments (038)      — live
   ├─ user_oidc_link (039)       — lokal
   └─ webauthn_credentials (040) — lokal

pg-boss (Queue)
└─ Job-Tabelle für Integration Worker
```

> Auth-Hilfstabellen (`jwt_blocklist`/`login_lockouts`/`user_sessions`) sind bewusst Lazy-Init statt Migration (ADR-019, Tech-Debt). `platform_settings` wird per `CREATE TABLE IF NOT EXISTS` beim ersten Zugriff angelegt.

### 5.7 Neue Bausteingruppen (Stand 2026-06-20)

#### Correlation Engine + Async Pipeline (`backend/src/correlation/`)

**Control-Plane-Kernfunktion (P_CORR_1, ADR-032).** Die Korrelation läuft **materialisiert und asynchron** — kein blocking im API-Read-Pfad.

**Pure Engine (unverändert, kein Side-Effect):**
- `evidenceNormalizer` — Quellen-Normalizer-Registry (alle Quellen, nicht nur Wazuh; liest auch `win.system`)
- `entityCorrelation` — entitätszentrierte Korrelation **mit Provenance** (Host/User/Process/File/Registry/Network/DNS, Quelle ×N)
- `flowNormalizer` + `networkCorrelation` — Network/NAT-Flow-Modell (Firewall **und** Sysmon Event 3 via Wazuh-Regel 100951)
- `flowInventoryEnrichment` + `inventoryLookupCache` (TTL 5 min) — Host-NIC **vs.** Firewall-Interface getrennt (CE-4.3), MAC/Host aus Syscollector
- `flowFqdnEnrichment` + `fqdnResolver` — FQDN-Quellen-Reihenfolge: **Event-Computer > Inventory > DNS-forward-confirm** (CE-5.3, **live**); A-Record muss == Flow-IP, sonst `dns_unconfirmed` (kein Fake)
- Invariante: fehlt ein Wert → `null` + `missingReason` + `provenance`. Specs: `correlation-data-model.md`, `ce5-fqdn-source-discovery.md`.

**Async-Pipeline-Subsystem (P_CORR_1, lokal / Pre-Deploy-Gates offen):**

```
Mutation (Ticket-Update / Evidence-Add)
  ─ CorrelationMutationService ─────────────────────────────
  │  BEGIN  ticket.update + ensurePersistentJob  COMMIT
  │  → notifyQueue (best-effort, nach Commit)
  │
  ─ Queue (pg-boss, singletonKey = inputHash) ──────────────
  │
  ─ CorrelationWorker (asynchron) ──────────────────────────
  │  bounded Input (max 200 Children)
  │  pure CorrelationEngine
  │  source_revision re-check  → Abort bei Änderung
  │  saveResult (atomar)
  │  job.complete(resultId) erst NACH saveResult
  │
  ─ Materialisierter Read-Pfad ─────────────────────────────
  │  GET /tickets/:id/evidence → liest nur Repo (kein correlate())
  │  → correlationStatus { status, result, resultCreatedAt }
  │
  ─ Analyst Deck ───────────────────────────────────────────
     CorrelationStatusBanner  +  OverviewSection
     Polling: GET only, AbortController, exponentieller Backoff
```

**Trigger-Matrix (welche Felder lösen Korrelation aus):**

| Änderungstyp | Auslöser | Nicht ausgelöst |
|---|---|---|
| Ticket-Update mit technischem Feld | `srcIp`, `dstIp`, `iocs`, `offenseId`, `title`, `metadata`, … | `analyst`, `status`, `priority`, `notes`, `tags`, `dueDate` |
| Evidence hinzufügen | immer (`POST /evidence`) | — |

**Job-Statusmodell:** `pending → running → completed` · `running → failed` (Fehler oder max. Retries) · `running → failed("superseded")` (source_revision geändert) · failed + retry: `running → retrying` (< maxRetries)

**Resultat-Lebenszyklus:** `inputHash = SHA-256(ticketId + sourceRevision + engineVersion)` — eindeutige Signatur. Ändert sich `sourceRevision`, ist das alte Resultat `superseded`. Ein `current`-Resultat hat denselben `inputHash` wie der aktuelle Ticket-Stand. Keine Resultate werden überschrieben — insert-only.

**API-Read-Vertrag für `correlationStatus`:**
```json
{
  "status": "current | superseded | pending | running | retrying | failed | unavailable",
  "result": { ... } | null,
  "resultCreatedAt": "ISO8601" | null,
  "sourceRevision": "string",
  "lastFailureReason": "string" | null
}
```

**Recovery:** `reconcile()` re-enqueued `pending`/`retrying` Jobs (bounded 100) — kein Datenverlust bei Queue-Neustart.

**Komponenten-Übersicht:**
- `correlationRuntime.js` — Composition Root (Singleton): Runtime + Scheduler + Worker + shared Queue + shared Repo
- `CorrelationSchedulingService.js` — Trigger-Einstiegspunkt für alle Mutations; `ensurePersistentJob` + `notifyQueue`; `reconcile()`
- `CorrelationWorker.js` — Worker: bounded Input + Engine + revision-check + atomares saveResult + ack erst nach Save
- `CorrelationMutationService.js` — transaktionale Mutation (Ticket/Evidence + Job in einer Postgres-Transaktion)
- `correlationJobDomain.js` — Job/Result Domain-Modell + Status-Machine + Idempotenz (`computeInputHash`)
- Repos: `InMemoryCorrelationRepository` (Dev/Tests) / `PostgresCorrelationRepository` (DB_ENABLED), gewählt via Factory

#### Auth-Welle 3 (`backend/src/mfa/`, `backend/src/auth/{oidc,webauthn}/`)
- **MFA/TOTP** (`mfa/totp.js`, RFC 6238, ohne externe Lib) + `MfaService` + Login-Challenge + Recovery-Codes; org-weite Pflicht via Setting `mfaRequired` (Setup-Token-Flow). ENV `MFA_ENABLED`. **live**.
- **SSO/OIDC** (`oidcClient.js` PKCE/S256 + `oidcService.js`, Signaturprüfung gegen JWKS via `jose`); `allowSignup` default aus → nur Account-Linking, Default-Rolle `viewer`. ENV `OIDC_*`. **lokal**.
- **WebAuthn/Passkey** (`webauthnClient.js` Ceremony-Request-Seite + `webAuthnService.js`, Krypto injiziert via `@simplewebauthn/server`); Counter-Clone-Check, einheitlicher nicht-diskriminierender Auth-Fehler. ENV `WEBAUTHN_*`. **lokal**. Ergänzt TOTP, ersetzt es nicht.
- Reine Request-/Claim-/Ceremony-Logik ist von der kryptografischen Verifikation getrennt (gleicher Split wie OIDC↔jose).

#### Control-Plane / Provisioning (`backend/src/provisioning/`, Routes `provisioning.js`)
Kette: GitOps-Profile/Plan → Domain (6 Entities) → Postgres → Enrollment-Token + Node-Credential-Handoff → Heartbeats → read-only Admin-API → Registry-UI → Linux-Installer (`deploy/install/`).
- **Kein Apply-/Remote-/Netz-Kanal** in der gesamten Kette (per Safety-Test erzwungen — Installer-Scan gegen ip/dhcp/dns/nat/route/firewall/wazuh/opnsense/sniff…).
- Node-facing: `/enroll` (Enrollment-Token im Body, CSRF-frei, **single-use** consume-vor-mint), `/nodes/:id/heartbeat` (Bearer Node-Credential, Node-Bindung `nodeId==:id` → 403); Antwort nur `accepted/serverTime/desiredProfileId`.
- **P_PROVISION_SECURITY_1** (**live** `3370fcc`): Credential-Revoke (CAS-idempotent), Node-Retire (revoke-on-retire), Rate-Limits `/enroll` (pro-IP, nur Fehlversuche) + `/heartbeat` (pro-nodeId, NAT-sicher), FK-Migration 037.

#### Compliance / NIS2 (`backend/src/compliance/nis2/`, Routes `nis2.js`)
- Statischer 10-Control-Katalog + `Nis2Assessment` + `Nis2EvidenceLink` (8 Typen) + `Nis2ReadinessService` (Signale `overdue`/`missingEvidence`/`needsReview`, lokal auch `reviewDue`).
- Routen: `/v1/nis2` (Lesen viewer+, Schreiben admin), `/controls/:key/incident-evidence` (admin, Snapshot **nur sichere Felder, kein PII**), `/report` (Management-Readiness mit Disclaimer).
- **Ehrlich: kein Konformitätsnachweis** (per Test). Evidence-`ref` hart validiert (nur http/https, keine Secret-Query/Fragment-Keys, kein `javascript:/data:`). Audit nur sichere Metadaten (nie notes/URL). **live**; `reviewDue` (P_NIS2_3) **lokal**.

#### Outbound (`backend/src/services/notificationOutbound.js`, `integrations/adapters/{servicenow,otrs,email}/`)
- Notifications: Slack · generischer Webhook · Microsoft Teams · E-Mail/SMTP (nodemailer lazy, **lokal**). Default aus via `NOTIFICATIONS_OUTBOUND_ENABLED`; `GET /v1/notifications/channels` meldet nur `.configured`-Booleans (keine URLs/Secrets).
- Ticket-Export: `POST /v1/tickets/:id/export` + `/export/sync-status` (ServiceNow PATCH / OTRS TicketUpdate), Gate `EXTERNAL_TICKET_EXPORT_ENABLED`, jeder Fehlversuch auditiert.
- Reports-MVP: Incident- (technisch) + Kunden-Report (nicht-technisch, **ohne** IP/MITRE/IOC, per Test); PDF via jsPDF (dynamisch).

#### CrowdSec-WAN (`backend/src/integrations/adapters/crowdsec/`)
Adapter + LAPI-Client (Machine-JWT → `/v1/alerts`) + Poller + Processor; zieht externe Angriffsfläche (HTTP-Bruteforce/Scanner/CVE-Probes/Bad Bots) über die Integration-Pipeline in Tickets (erbt Dedup/Normalize/Queue). ENV `CROWDSEC_*`. Pipeline end-to-end **lokal**; Live-ENV-Anbindung offen.

---

## 6. Laufzeitsicht

### 6.1 Login-Flow (Cookie-only + CSRF, optional 2. Faktor — ADR-017)

```
1. Nutzer tippt email + password
2. Frontend POST /auth/login (credentials:'include')
3. Backend: verify password (bcrypt) + Account-Lockout-Check
4a. MFA inaktiv → Session-JWT als httpOnly-Cookie `soc_token` + JS-lesbares
    `csrf_token`-Cookie (sameSite=strict); JSON-Token nur, wenn
    `AUTH_RETURN_TOKEN_JSON=true` explizit aktiviert ist
4b. MFA aktiv → KEINE Session, sondern MFA-Challenge-Token → Schritt 5
4c. mfaRequired + keine MFA → kurzlebiger Setup-Token (purpose:mfa_setup, 15 min)
    → POST /auth/mfa-setup/{begin,complete} → MFA aktiv → volle Session
5. MFA: POST /auth/mfa (TOTP-Code, ±Drift) → bei OK volle Session
6. State-changing Requests: X-CSRF-Token-Header == csrf_token-Cookie (csrfGuard)
7. Middleware requireAuth/requireRole prüft Cookie-Session + Expiry + Blocklist
```

- **Alternativen:** SSO/OIDC (`/auth/oidc/*`, Callback + Account-Linking, **lokal**) und WebAuthn/Passkey (`/auth/webauthn/*`, usernamelos, **lokal**) münden in dieselbe Session.
- **API-Clients:** Bearer + Personal Access Tokens (PAT) bleiben gültig und sind CSRF-immun.
- **Produktions-Default:** Browser-Login ist cookie-only; der Session-JWT wird in Produktion nicht automatisch im JSON-Body ausgeliefert.
- **Fehlerfall:** Login-Fehler wird geloggt (action=LOGIN_FAILED) → Brute-Force-Detection; einheitliche, nicht-diskriminierende Fehler bei MFA/Token-Problemen (kein Leak).

### 6.2 Ticket-Erstellung (Wazuh-Webhook)

```
Wazuh Manager Alert (Rule Match)
    ↓
POST /api/v1/integrations/wazuh
    (mit HMAC-Signature + Payload)
    ↓
Webhook-Handler prüft:
  • HMAC valid?
  • Replay-ID nicht doppelt?
  ↓
  payload → RawEvent in pg-boss.jobs
    ↓
Worker (async):
  1. WazuhProcessor.process(event)
  2. Dedup-Check: source=wazuh + offenseId → schon Ticket?
  3. Nein → TicketService.create(normalized)
  4. Ja → TicketService.update(found.id, { alert_count++ })
  5. Evidence + MITRE + TI anreichern
  6. Audit-Log: action=CREATE_TICKET, source=wazuh
    ↓
Frontend bemerkt Update (auto-refresh oder Poll)
    ↓
SOC Analyst sieht neues Ticket in der Analyse-Seite
```

### 6.3 KI-Agent-Flow

```
Analyst klickt "KI-Vorschlag" auf Ticket
    ↓
Frontend: POST /agent/propose
  (ticketId, type=fp_rule | escalate | ...)
    ↓
Backend AgentService:
  1. Ticket laden
  2. Evidence-Bundle bauen (EvidenceBundleBuilder)
  3. System-Prompt + Bundle → Ollama
  4. Ollama antwortet (text | rule-json)
  5. AgentSuggestion speichern: status=pending
  6. Audit-Log: action=AGENT_SUGGEST
    ↓
Frontend zeigt Proposal-Modal:
  • Vorschlag anzeigen
  • ✅ Approve | ❌ Reject
    ↓
Approve:
  • POST /agent/approve
  • Wenn type=fp_rule → WazuhFpExceptionService.apply()
    (PUT /manager/api/wazuh.api_v1.rules:update)
  • status=approved
  • Audit-Log: action=AGENT_APPROVE, approvedBy=userId
    ↓
Reject:
  • POST /agent/reject
  • status=rejected
  • optional: reason geloggt
```

### 6.3b Threat-Intel-Enrichment (RBAC + Validierung)

```
Analyst/Engineer/Admin klickt "Threat Intel anreichern"
    v
POST /api/v1/threat-intel/enrich
    v
Middleware:
  requireAuth
  requireRole('analyst')  -> Viewer erhalten 403
    v
ThreatIntelService.validateIndicator:
  type allowlist: ip | domain | url | hash
  max. 2048 Zeichen
  IP/Domain/URL/Hash syntaktisch begrenzt
    v
Cache zuerst (Postgres bei DB_ENABLED, sonst InMemory)
    v
Provider nur bei Cache-Miss:
  AbuseIPDB / VirusTotal nur fuer konfigurierte Keys;
  private IPs werden nicht extern abgefragt
    v
Normalisiertes Ergebnis: verdict, score, confidence, provider status
```

Security-Review 2026-06-29: Der Enrichment-Endpunkt ist nicht mehr nur authentifiziert,
sondern Analyst+ beschraenkt. Damit koennen reine Viewer keine externen Provider-Calls,
Quota-Verbrauch oder unnoetige IOC-Datenabfluesse ausloesen.

### 6.4 Threat Hunt-Flow

```
Analyst navigiert zu Threat Hunts
    ↓
Hunt-Katalog laden (GET /hunts/catalog)
  Shows: 10 vorgefertigte Hunts mit Beschreibung
    ↓
Analyst klickt "Run Hunt" auf z.B. "Suspicious PowerShell"
    ↓
HuntService.createSession:
  • session_id erzeugt
  • hunt_id + config (z.B. Host-Filter) speichern
  • status=RUNNING
    ↓
Frontend: WebSocket oder Polling (GET /hunts/:id/session)
    ↓
Backend Runner (async):
  1. Wazuh-API abfragen (PowerShell Events)
  2. Oder lokale Datei-Scan (wenn YARA)
  3. Findings sammeln (title, severity, rawEvent)
  4. Finding speichern in hunt_findings
  5. Session: status=COMPLETED
    ↓
Frontend zeigt Live-Console:
  [Scanning 5 Hosts...]
  ✓ Host-A: 3 findings
  ✓ Host-B: 1 finding
  [All done. 4 findings total.]
    ↓
Analyst kann:
  • "Create Ticket from Finding" → TicketService.create()
  • "Add as Evidence" → zu existierendem Ticket
  • "Export Report"
```

### 6.5 Analysis-Seite (Dashboard)

```
GET /analysis?state=OPEN&sort=updated_at
    ↓
TicketService.findAll(filters):
  SELECT * FROM tickets
    WHERE state='OPEN'
    ORDER BY updated_at DESC
    LIMIT 50
    ↓
  Für jedes Ticket: Enrichment laden
    (Evidence, Parent-Case, Agent-Count, Comment-Count)
    ↓
  Response: { data: Ticket[], total, page, requestId }
    ↓
Frontend zeigt:
  • Tabelle oder Karten-Grid
  • Filter (state, status, priority, assignedTo, sourceSystem)
  • Klick auf Ticket → TicketEditorPage
    (Detail mit Evidence-Tabs, History, Comments, MITRE-Map)
```

### 6.6 Correlation-Flow (CE-1…CE-5, Network/FQDN)

```
Timeline-Route lädt Ticket-Events (Wazuh-Indexer ticketFlows)
    ↓
evidenceNormalizer: Roh-Events → normalisierte Entities (alle Quellen)
    ↓
networkCorrelation: Firewall- + Sysmon-E3-Flows → einheitliches Flow-Modell
    ↓ (async, NACH Inventory)
flowInventoryEnrichment (inventoryLookupCache, TTL 5 min):
  • Host-NIC ≠ Firewall-Interface (getrennt), MAC/Host aus Syscollector
  • fehlt etwas → null + missingReason (not_in_inventory / inventory_not_loaded)
    ↓
flowFqdnEnrichment (ENV FQDN_RESOLVER_ENABLED):
  • Kandidat = Host-Kurzname + FQDN_DOMAIN
  • forward-confirm: A-Record(s) müssen Flow-IP enthalten → FQDN, sonst dns_unconfirmed
  • Reihenfolge der Wahrheit: Event-Computer > Inventory > DNS (setIfEmpty)
    ↓
CorrelationResult (entities + network.flows, je Feld provenance + missingReason)
    ↓
Network-/Entities-/Timeline-Tab im Analyse-Deck (No-Fake: „—" + Missing-Reason)
```

### 6.6b Materialisierte asynchrone Korrelation (P_CORR_1, ADR-032)

**Trigger-Pfad (Mutation):**
```
PUT /tickets/:id  oder  POST /evidence
    ↓
CorrelationMutationService
  BEGIN
    ticket.update / evidence.create + ticket.touch
    ensurePersistentJob (inputHash = SHA-256(ticketId+sourceRevision+engineVersion))
      → idempotent: existiert aktiver Job → kein Doppeljob
  COMMIT
    ↓
  notifyQueue (pg-boss, singletonKey = inputHash, best-effort nach Commit)
    ↓ (asynchon — Request ist bereits beantwortet)
CorrelationWorker
  bounded Input laden (Ticket + max 200 Children)
  pure CorrelationEngine.correlate()  (keine Seiteneffekte)
  source_revision re-check:
    geändert → job.fail("superseded"), KEIN Resultat schreiben, ack
    gleich  → saveResult (atomar)
             → job.complete(resultId)  ERST nach saveResult
             → Queue-Ack (pg-boss)
```

**Read-Pfad (GET):**
```
GET /tickets/:id/evidence
    ↓
  findActiveJobByInputHash(inputHash)   ← read-only
  findLatestResultByTicket(ticketId)    ← read-only
    ↓
  status berechnen:
    activeJob vorhanden          → status = job.status
    kein Job, Resultat vorhanden:
      result.inputHash == current → "current"
      result.inputHash ≠ current  → "superseded"
    weder Job noch Resultat      → "unavailable"
    ↓
  Response: { data: result, correlation: { status, result, resultCreatedAt, ... } }
```

**UI-Polling (Analyst Deck):**
```
useCorrelationPolling (GET only, AbortController)
  pending/running/retrying → poll (2s → exp. Backoff → max 30s)
  current/failed/unavailable → poll stop
    ↓
CorrelationStatusBanner  — Status + stale-Warnung
OverviewSection           — materialisiertes Resultat aus correlationStatus.result
                            (ev.correlation im Provenance-Block NICHT genutzt)
```

**Recovery:**
```
reconcile()  →  findSchedulableJobs (pending|retrying, limit 100)
             →  notifyQueue für jeden Job (idempotent via singletonKey)
```

### 6.7 Node-Enrollment + Heartbeat (Control-Plane, read-only)

```
Admin legt EnrollmentProfile an + mintet Token
  → /provisioning/.../token → Klartext `enr_` EINMALIG (nur Hash gespeichert)
    ↓
Node (Linux-Installer bootstrap.sh):
  POST /v1/provisioning/enroll  (Token im Body, CSRF-frei)
    → consume Token (single-use, consume-VOR-mint) + mint Node-Credential `ncr_`
    → Antwort { nodeId, nodeCredential }  (Klartext EINMALIG)
    ↓
Node-Agent (Heartbeat-Loop):
  POST /v1/provisioning/nodes/:id/heartbeat  (Bearer ncr_)
    → Node-Bindung nodeId==:id (sonst 403); retired Node → 403
    → record Heartbeat + read-only Inventar
    → Antwort NUR { accepted, serverTime, desiredProfileId }  — NIE Befehle
    ↓
Lifecycle (admin): Credential-Revoke (→ Heartbeat 401) · Node-Retire (revoke-on-retire)
Rate-Limits: /enroll pro-IP (nur Fehlversuche), /heartbeat pro-nodeId (NAT-sicher)
```

### 6.8 NIS2 Incident-Evidence (admin, kein PII)

```
Admin: POST /v1/nis2/controls/:key/incident-evidence  (ticketRef)
  → ticketService validiert Ticket existiert (sonst 404)
  → Evidence-Link Typ 'ticket', Snapshot NUR sichere Felder
    (INC-Nummer, sanitisierter Titel, Priorität, State) — NIE email/user/srcIp/notes
  → Audit NIS2_EVIDENCE_LINKED { controlKey, evidenceType, ticketRef }  (kein PII)
    ↓
GET /v1/nis2/report (viewer+): Status-Verteilung + Evidence-/Incident-Coverage
  + Disclaimer „kein Konformitätsnachweis …"
```

---

## 7. Verteilungssicht

### 7.1 Docker-Compose (Production)

```yaml
Services:
├─ api (backend)
│  └─ Port 3000 (intern, hinter nginx)
│     Umgebung: DATABASE_URL, WAZUH_*, OLLAMA_*, FQDN_RESOLVER_*,
│       MFA_ENABLED, API_TOKENS_ENABLED, OIDC_*, WEBAUTHN_*,
│       NOTIFICATIONS_OUTBOUND_ENABLED + NOTIFY_*, EXTERNAL_TICKET_EXPORT_ENABLED,
│       CROWDSEC_*, PROV_* (Rate-Limits), SETTINGS_ENC_KEY, JWT_SECRET, etc.
│     Health-Check: GET /health (meldet laufende Version)
│
├─ web (frontend)
│  └─ Port 5173 (nur in Dev; in Prod via nginx)
│     Build-Output in nginx:/app
│
├─ nginx (reverse proxy)
│  └─ Port 443 (TLS), 80 (redirect)
│     Routes:
│     • / → frontend (SPA)
│     • /api → api:3000
│     • /metrics → api:3000 (IP-gate)
│
├─ postgres
│  └─ Port 5432 (intern)
│     Database: soc_db
│     Volumes: PG-Data persistent
│
└─ (optional) redis
   └─ Caching / Sessions (future)
```

### 7.2 Proxmox-Topologie

```
Proxmox Host (192.168.240.72)
├─ LXC 177 (nexora-soc, Ubuntu 24.04)
│  ├─ IP: 10.99.99.75 (VLAN 10)
│  ├─ CPU: 8 cores
│  ├─ RAM: 16 GB
│  ├─ Disk: 100 GB (NAS / StorageM2)
│  ├─ Docker Engine (multi-container)
│  └─ Networks:
│     ├─ br-manage (10.99.99.75)
│     └─ docker0 (API-Web-DB)
│
├─ LXC 178 (ollama-lm, Ubuntu 24.04)
│  ├─ IP: 192.168.240.78
│  ├─ CPU: 6 cores
│  ├─ RAM: 8 GB (für llama3.2:3b)
│  ├─ Ollama Service
│  └─ Modell: llama3.2:3b (~2 GB)
│
└─ External:
   ├─ Wazuh Manager (10.99.99.77)
   │  ├─ API: 55000
   │  └─ Indexer: 9200 (OpenSearch)
   │
   └─ OPNsense (10.99.99.1)
      └─ Default Gateway
```

### 7.3 Network-Segmentierung

```
VLAN 10 (Management, 10.99.99.0/24):
  • Proxmox (10.99.98.100)
  • Nexora-SOC (10.99.99.75)
  • Wazuh Manager (10.99.99.77)
  • DC01 (10.99.99.10)
  • WEC01 (10.99.99.11)
  → Intern, kein Internet-Zugang

VLAN 1 (User-LAN, 192.168.241.0/24):
  • User-PC (DHCP)
  • OPNsense braucht Routing zu VLAN10

External (WAN, 192.168.240.0/24):
  • FritzBox (192.168.240.1)
  • Ollama-Host (192.168.240.78, separates Subnet für Isolation)
```

---

## 8. Querschnittskonzepte

### 8.1 Authentifizierung & Autorisierung

**JWT-basiert:**
- Token: `{ sub: userId, email, role, exp, jti }`
- Secret: `JWT_SECRET` aus `.env.production`
- TTL: 24 Stunden
- Blacklist (jti-Tracking) bei Logout

**Rollen (RBAC):**
```
admin   > engineer > analyst > viewer
├─ All   ├─ Hunts   ├─ Own   ├─ Read-Only
├─ FP    ├─ Console ├─ Hunts
├─ Users ├─ Rules   └─ Hunts
└─ Audit
```

**Middleware:**
- `requireAuth` — Token present + valid
- `requireRole(role)` — Token + role check

### 8.2 Logging & Audit

**Request-Logging (morgan-style):**
```
[RequestID] [timestamp] [IP] [method] [path] [status] [duration]ms
```

**Audit-Log (append-only):**
```sql
INSERT INTO audit_logs (
  actor_user_id, actor_label, action, resource_type, resource_id,
  metadata, ip, request_id, created_at
) VALUES (...)
```

**Actions:**
- `LOGIN`, `LOGIN_FAILED`, `LOGOUT`
- `CREATE_TICKET`, `UPDATE_TICKET`, `DELETE_TICKET`
- `CREATE_HUNT`, `RUN_HUNT`, `COMPLETE_HUNT`
- `AGENT_SUGGEST`, `AGENT_APPROVE`, `AGENT_REJECT`
- `CREATE_FP_RULE`, `APPLY_FP_RULE`
- `EXPORT_*`, `SYNC_EXTERNAL`

### 8.3 Fehlerbehandlung

**Global Error Handler (Express):**
```javascript
app.use((err, req, res, next) => {
  const { status, code, message } = classifyError(err);
  res.status(status).json({
    error: code,
    message,
    requestId: req.id
  });
});
```

**Fehler-Kategorien:**
- `ValidationError` (400) — Input ungültig
- `AuthenticationError` (401) — Token ungültig
- `ForbiddenError` (403) — Keine Berechtigung
- `NotFoundError` (404) — Ressource nicht gefunden
- `ConflictError` (409) — Dedup-Konflikt
- `RateLimitError` (429) — Zu viele Requests
- `ServiceUnavailableError` (503) — SIEM offline, etc.

### 8.4 Validierung

**Schema-basiert (Joi):**
```javascript
const schema = Joi.object({
  email: Joi.string().email().required(),
  priority: Joi.string().valid('critical', 'high', 'medium', 'low'),
  tags: Joi.array().items(Joi.string()).max(10),
});
```

**Input-Limits:**
- Title: max 200 chars
- Description: max 5000 chars
- Comment: max 2000 chars
- Payload (raw): max 50 KB
- Array-Items: max 100

### 8.5 Caching & Performance

**Query-Optimierung:**
- Indexe auf: `tickets(state, status, created_at)`, `evidence(ticket_id)`, `audit_logs(actor_id)`
- Pagination: LIMIT 50, Cursor-basiert (offset)

**Frontend-Caching (TanStack Query):**
- `staleTime: 5min` für Tickets
- `gcTime: 10min` (Cache-Retention)
- `refetchOnWindowFocus: true` (bei Tab-Return)

**Server-Caching (optional):**
- Redis für TicketRepository-Findall (invalidiert bei Update)
- Session-TTL: 24h

---

## 9. Architekturentscheidungen (ADRs)

### Zusammenfassung

| ADR | Titel | Entscheidung |
|---|---|---|
| ADR-001 | Schrittweise Migration | Security → Tests → Backend → DB |
| ADR-002 | Eigenes internes Ticketmodell | Adapter-Layer zwischen extern + intern |
| ADR-003 | PostgreSQL | ACID, komplexe Queries, Prod-Ready |
| ADR-004 | Queue/Worker | Keine sync Jobs im API-Request |
| ADR-005 | Traceability | external_ticket_links + Audit-Trail |
| ADR-006 | Idempotente Webhooks | Dedup-Key: source + offenseId + hash |
| ADR-007 | State + Status | OPEN/CLOSED + assigned/in_progress/etc. |
| ADR-008 | Analysis-Deck | `/analysis` ist die Kernworkbench |
| ADR-009 | Keine Demo-Daten | Ehrliche Leerzustände, keine Fake-Tickets |
| ADR-010 | SIEM-Dashboard | `/wazuh` auf echten Indexer-Daten (OpenSearch) |

Vollständige Doku: `docs/adr/decisions.md`

---

## 10. Qualitätsanforderungen

### 10.1 Funktional

| Anforderung | Metrik | Ziel |
|---|---|---|
| Ticket-Dedup | Duplikate pro Monat | < 1% |
| Hunt-Success-Rate | Findings pro Run | >= 1 |
| KI-Vorschlag-Accuracy | Approved Proposals | >= 70% |
| SIEM-Integration | Alerts/min | >= 1000 |

### 10.2 Non-Funktional

| Anforderung | Metrik | Ziel |
|---|---|---|
| Availability | Uptime | 99.5% |
| Response-Time | API p95 | < 500ms |
| Search-Latency | Ticket-Liste | < 1s (50 Items) |
| Test-Coverage | Code Coverage | >= 80% |
| Security Scan | OWASP Top 10 | 0 kritisch |

### 10.3 Skalierbarkeit

- **Horizontal:** Stateless Backend, kann repliziert werden (nginx LB)
- **Vertikal:** Postgres kann auf bessere Hardware hochgefahren werden
- **Daten-Wachstum:** Partition audit_logs quartalsweise (alte Logs archivieren)

---

## 11. Risiken & technische Schulden

### 11.1 Offene Risiken

| Risiko | Eintritt | Impact | Mitigation |
|---|---|---|---|
| Wazuh-Manager-Ausfall | Mittel | Hoch (keine neuen Alerts) | Failover-Manager + Backup-Config |
| Ollama OOM | Mittel | Mittel (KI offline) | RAM-Monitoring, Fallback zu Stub-Provider |
| Webhook-Replay | Niedrig | Mittel (Duplizierte Events) | Nonce-Tracking implementiert |
| JWT-Kompromise | Niedrig | Sehr Hoch (Account-Hijack) | Kurze TTL, JTI-Blacklist, HTTPS erzwingen |
| DSGVO-Verletzung | Niedrig | Sehr Hoch (Bußgeld) | Audit-Trail, PII-Hashing, Anonymisierung |

### 11.2 Technische Schulden

| Item | Prio | Aufwand | Lösung |
|---|---|---|---|
| Evidence-Collector (P16) | Hoch | 2 Wochen | Endpoint-Artefakte sammeln |
| RAG Knowledge Base (P19b) | Mittel | 3 Wochen | Qdrant + MITRE + Hunts einfüttern |
| Multi-SIEM (QRadar/Splunk) | Mittel | 2 Wochen pro Adapter | Existierende Adapter erweitern |
| Settings-Seite ausbauen | Mittel | laufend | Geplante Tabs/Funktionen real machen |
| Performance-Tuning | Niedrig | Laufend | Index-Optimierung, Caching |

### 11.3 Bekannte Limitierungen

- **Keine Offline-Hunts** — Hunts brauchen Wazuh-API; lokal funktioniert nur YARA
- **Keine Batch-Import** — Webhooks sind Event-basiert; Bulk-Upload noch nicht implementiert
- **Eingeschränktes SOAR** — Wir automatisieren nicht, wir schlagen vor (Human-in-the-loop)
- **Single-Tenant** — Keine Multi-Org-Isolierung

---

## Anhang: Wichtige Dateien

- `backend/src/app.js` — Express-Setup
- `backend/src/domain/entities/` — Datenmodelle
- `backend/src/services/` — Business-Logic
- `backend/src/integrations/adapters/` — SIEM-Adapter
- `frontend/src/pages/` — React-Seiten
- `frontend/src/features/` — UI-Features (api, auth, etc.)
- `docs/adr/decisions.md` — ADR-Details
- `ROADMAP.md` — Feature-Roadmap
