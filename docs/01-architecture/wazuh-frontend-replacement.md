# Architekturplan: Wazuh-Dashboard durch NEXORA-Frontend ersetzen

> Status: **Entwurf** · Datum: 2026-06-07 · Workstream: **NX (NEXORA Console)**
> Ziel: Das OpenSearch-basierte Wazuh-Dashboard vollständig durch das NEXORA-Frontend
> (`frontend/`) ersetzen. NEXORA wird die einzige Oberfläche; das Wazuh-Dashboard wird
> am Ende abgeschaltet. Indexer + Server-API laufen weiter.

---

## 1. Zielbild

```
        ┌─────────────────────────────┐
        │   NEXORA Frontend (React/TS) │   einzige UI
        └──────────────┬──────────────┘
                       │  HTTPS (eigene REST-API, RBAC, Session)
        ┌──────────────▼──────────────┐
        │   NEXORA Backend (Express)   │   Adapter-/Proxy-Schicht
        │   - WazuhApiClient (:55000)  │   Agents, Rules, Control, Config
        │   - WazuhIndexerClient (:9200)│  Alerts, Events, Vulns, MITRE   ← NEU
        └───────┬───────────────┬──────┘
                │               │
        ┌───────▼──────┐ ┌──────▼───────────┐
        │ Wazuh Server │ │ Wazuh Indexer     │
        │  API :55000  │ │ (OpenSearch) :9200│
        └──────────────┘ └───────────────────┘
```

**Prinzip:** Das Frontend spricht **nie** direkt mit Wazuh. Jeder Zugriff läuft über die
NEXORA-Backend-Adapter (Hard Rule: „No integration without an adapter layer"). Damit:
Auth/Token-Handling, RBAC, Rate-Limiting, Audit-Log und Normalisierung an *einer* Stelle.

---

## 2. Ist-Zustand (was bereits existiert)

| Baustein | Datei | Deckt ab |
|---|---|---|
| Server-API-Client | `backend/src/integrations/adapters/wazuh/WazuhApiClient.js` | Auth (JWT, gecacht), `listAgents`, `getAgent`, `getAgentInventory` (Syscollector) |
| HTTP-Abstraktion | `backend/src/integrations/http/{Real,InMemory}HttpClient.js` | testbar ohne echtes Wazuh |
| Adapter/Mapper/Processor | `.../wazuh/WazuhAdapter.js`, `wazuhMapper.js`, `WazuhProcessor.js` | Webhook-Alert → Ticket-Pipeline |
| Frontend-Client | `frontend/src/features/wazuh/wazuhApi.ts` | `agents()`, `inventory(id)` |
| Webhook-Integration | `integrations/wazuh/*` | Wazuh → NEXORA Ticket (eingehend) |

**Fazit:** Der **Server-API-Pfad (:55000) steht.** Der **Indexer-Pfad (:9200) fehlt komplett** —
und genau der liefert die Daten für die meisten Dashboard-Module.

---

## 3. Lücke: Wazuh-Dashboard-Module → NEXORA-Seite

| Wazuh-Modul | Datenquelle | NEXORA-Ziel | Status |
|---|---|---|---|
| Security Events / Threat Hunting | Indexer `wazuh-alerts-*` | Dashboard + Alerts-Seite | **neu** |
| Vulnerability Detection | Indexer `wazuh-states-vulnerabilities-*` | Vulnerabilities-Seite | **neu** |
| MITRE ATT&CK | Indexer (rule.mitre) | MITRE-Panel | **neu** |
| Agents / Endpoints | Server-API `/agents` | HostsPage (vorhanden) | ✅ teilweise |
| Agent-Inventory (Syscollector) | Server-API `/syscollector` | Host-Detail | ✅ teilweise |
| FIM / Integrity Monitoring | Indexer + `/syscheck` | Evidence/FIM-Seite | **neu** |
| Configuration Assessment (SCA) | Server-API `/sca` | Compliance-Seite | **neu** |
| Rules / Decoders / Manager | Server-API `/rules`, `/manager` | Settings/Admin | **neu** |

---

## 4. Neue Bausteine

### 4.1 Backend — `WazuhIndexerClient` (NEU, kritisch)
- Pfad: `backend/src/integrations/adapters/wazuh/WazuhIndexerClient.js`
- Spricht OpenSearch `:9200` per `_search` (Basic-Auth, `rejectUnauthorized:false` für self-signed).
- Nutzt **dieselbe HttpClient-Abstraktion** → InMemory-Tests.
- Read-only. Query-Builder mit **fester Whitelist** an Feldern/Indizes (keine freien Nutzer-Queries → kein Injection-Risiko).
- Methoden (Auswahl):
  - `alertSummary({ from, to })` → Counts nach Severity/Rule-Level
  - `searchAlerts({ from, to, level, agentId, limit })`
  - `topRules({ from, to })`, `topAgents(...)`, `mitreSummary(...)`
  - `vulnerabilities({ agentId, severity })`

### 4.2 Backend — Service + Routen
- `backend/src/services/wazuhConsoleService.js` — orchestriert ApiClient + IndexerClient, normalisiert auf NEXORA-Typen.
- Neue Routen unter `/api/wazuh/...`:
  - `GET /wazuh/alerts/summary`, `GET /wazuh/alerts`, `GET /wazuh/vulnerabilities`,
    `GET /wazuh/mitre/summary`, `GET /wazuh/overview`
- RBAC-geschützt (bestehendes `rbac`-Modul), Audit-Log für jeden Zugriff.

### 4.3 Frontend — neue/erweiterte Seiten (NEXORA-Design)
- `frontend/src/features/wazuh/wazuhApi.ts` erweitern (alerts, vulns, mitre, overview).
- Seiten: DashboardPage (echte Wazuh-KPIs) → AlertsPage → VulnerabilitiesPage → MitrePanel → HostsPage (Server-API).
- Reuse der vorhandenen UI-Bausteine (`StatCard`, `Donut`, `Card`, `Badge`).

---

## 5. Phasen (Workstream NX)

| Phase | Inhalt | Definition of Done |
|---|---|---|
| **NX-1** | `WazuhIndexerClient` + Auth + `alertSummary`/`searchAlerts` | Unit-Tests grün (InMemoryHttpClient), Feld-Whitelist |
| **NX-2** | Service + Routen `/wazuh/alerts*` + RBAC + Audit | Integrationstests, Fehlerpfade (Indexer down → 503) |
| **NX-3** | DashboardPage zeigt **echte** Wazuh-Alert-KPIs | Donut „Alerts nach Severity" live |
| **NX-4** | AlertsPage (Liste, Filter, Detail) im NEXORA-Look | Vitest grün, leere/Fehlerzustände |
| **NX-5** | Vulnerabilities + MITRE + FIM/SCA | je Seite Tests + EmptyState |
| **NX-6** | Cutover: Branding bleibt, Wazuh-Dashboard-Dienst deaktivieren | NEXORA ist alleinige UI |

> Branding-Set (`wazuh/branding/`) bleibt nur relevant, falls das Wazuh-Dashboard
> übergangsweise noch läuft. Nach NX-6 wird es nicht mehr benötigt.

---

## 6. Security / DSGVO (Hard Rules)

- **Read-only** gegen Indexer; keine Schreibzugriffe, keine freien Nutzer-Queries (Whitelist).
- Wazuh-Credentials nur im Backend (`backend/src/config`), **nie** im Frontend/Bundle.
- Token/JWT-Caching wie im bestehenden `WazuhApiClient` (~800 s).
- TLS zu Indexer/API: self-signed → mittelfristig CA-Pinning statt `rejectUnauthorized:false`.
- **Audit-Log** (append-only, IP gehasht) für jeden Console-Zugriff.
- PII: Alerts können Usernamen/Hostnamen/IPs enthalten → in Logs nicht im Klartext spiegeln.
- RBAC: Analyst (read) vs. Admin (Config) — Server-API-Schreibpfade später, separat freigeben.

## 7. Risiken / offene Entscheidungen

- **R-NX1** Indexer-Index-Namen versionsabhängig (`wazuh-alerts-4.x-*`) → konfigurierbar machen.
- **R-NX2** Datenmenge: Alerts-Queries brauchen Zeitfenster + Paginierung (kein „alles laden").
- **R-NX3** Feature-Parität: Wazuh-Dashboard hat viele Module — bewusst nur die für den SOC-Workflow nötigen nachbauen (YAGNI), Rest später.
- **E-NX1** Direkt Indexer ODER nur über Server-API (`/...`)? → Indexer für Massendaten (Alerts), Server-API für Steuerung. **Empfehlung: beide, getrennte Clients.**

## 8. Nächster konkreter Schritt nach Freigabe

**NX-1 starten:** `WazuhIndexerClient` mit `alertSummary` + Tests (InMemoryHttpClient),
nach dem Muster des bestehenden `WazuhApiClient`. Kein UI, kein echtes Wazuh nötig.
