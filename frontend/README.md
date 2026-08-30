# SOC Orchestrator — Frontend

Enterprise-Frontend (React 18 + TypeScript + Vite) für das SOC Ticket & Threat Hunting System.

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # ggf. VITE_API_TARGET anpassen
npm run dev            # http://localhost:5173 (Proxy /api → Backend :3000)
```

Parallel das Backend starten:

```bash
cd ../backend && npm start
```

## Scripts

| Script | Zweck |
|---|---|
| `npm run dev` | Dev-Server mit API-Proxy |
| `npm run build` | Typecheck + Produktions-Build (`dist/`) |
| `npm run typecheck` | Nur TypeScript prüfen |
| `npm test` | Unit-Tests (Vitest) |

## Architektur

```
src/
  app/        App · router · RequireAuth-Guard
  layout/     AppShell · Sidebar · Topbar · navConfig
  components/ui/  Card · Button · Badge · Input · Select · Tabs ·
                  Accordion · StatCard · EmptyState · SectionHeader
  pages/      Login · Dashboard · Analysis · Tickets · TicketEditor · Hosts ·
              ThreatHunts · HuntConsole · EvidenceCenter · KiAgentSettings · Settings · Profile
  components/analysis/  EvidenceTab · ImportDataModal (Analysis-Deck-Bausteine)
  features/   tickets/ · hunts/ · analysis/ (analysisModel: Datenmodell + Logik) ·
              hosts/ (hostsTypes) · wazuh/ (wazuhApi: Agents/Inventory)
  lib/        apiClient · auth (Context) · rbac · badges · types
  styles/     tokens.css (Design-Tokens) · global.css (Basis + Komponenten-Klassen)
```

### Analysis-Deck (`/analysis`) — SOC Workbench
3 Spalten (Ticket-Queue · Analysis-Tabs · Enrichment-Sidebar), Active-Ticket-Header,
6 Tabs (ANALYSIS/EVIDENCE/TIMELINE/NOTES/PLAYBOOKS/REPORT) + Import-Data-Modal.
Evidence korrelationsorientiert (Source → NAT → Destination → Reputation → Detection),
konsistente Daten via `buildEvidence(ticket)`. **Kein Remote-Exec, keine API-Keys im
Frontend** (VT/AbuseIPDB serverseitig). Siehe ADR-008/009.

### Keine Demo-/Fake-Daten
Alle `*Demo.ts`-Dateien wurden entfernt; wo noch kein Backend existiert, zeigt die UI
**ehrliche Leerzustände** („Nicht verbunden" / „Not provided by source log").
Invariante: `grep -rni "DEMO_" src/` ist leer. Offene Anbindungen: `frontend/TODO.md`.

- **Design:** Dark Enterprise SOC — Tokens in `styles/tokens.css`, lucide-react Icons.
- **Auth:** JWT im `localStorage`, `/auth/me`-Restore beim Start, 401 → Logout.
- **RBAC:** Backend-Hierarchie admin > analyst > viewer; Aktionen rollen-gegated.
- **API:** zentraler `apiClient` + Feature-API-Module (`ticketApi`, `huntApi`) — keine fetch-Aufrufe in Komponenten.

## Stand

Vollständige Enterprise-UI: App-Shell (einklappbare Sidebar + Topbar), Login,
Dashboard (echte Daten), **Analysis-Deck** (SOC Workbench, s. o.), Tickets-Liste +
**Ticket-Editor**, **Hosts** (echte Wazuh-Agents + syscollector-Inventory),
**Hunt-Console** (ohne echte Remote-Ausführung).

**Echte Daten:** Tickets/Hunts-KPIs + Donuts (Dashboard), Ticket-Queue/Header/IoCs
(Analysis), Wazuh-Agents (Hosts), Auth/Profil-Basisdaten. **Leerzustände (Backend
folgt):** Evidence/Enrichment/Timeline (Analysis), Evidence Center, KI Agent,
Settings-Status/Lizenz/Integrationen, Profil-MFA/Geräte/Tokens — siehe `frontend/TODO.md`.
