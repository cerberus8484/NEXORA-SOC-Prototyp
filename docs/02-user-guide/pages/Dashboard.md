# Dashboard (`/dashboard`)

## Zweck

Lagebild für SOC-Analysten: KPI-Übersicht (Tickets, Hunts, Evidence, Agent-Buffer, System-Health) + Live-Telemetrie aus dem Wazuh-Indexer + Schnellzugriff auf alle Kernseiten + Aktivitätsfeed + Statistiken (Ticket-Prioritäten, Hunt-Status, Top-Erkennungsquellen).

## Rolle & Sichtbarkeit

- **Minimale Rolle:** (keine; für alle Rollen sichtbar)
- **Nav-Gruppe:** `monitoring`

## Funktionen

- **KPI-Übersicht (5 StatCards):**
  - Offene Tickets: echte Zahl via `ticketApi.list({ state: 'OPEN' })`
  - Aktive Hunts: Hunts mit Status `planned` oder `active` via `huntApi.listSessions()`
  - Evidence Items: Anzahl der Evidence-Items via `evidenceApi.recent(500)`
  - Agent Buffer: Telemetrie-Status (Wazuh 202/203) mit Farbcodierung
  - System Health: API-Health-Status via `systemApi.health()`

- **Live-Telemetrie-Panel:** Zeitreihe aus dem Wazuh-Indexer (wenn Wazuh verbunden); zeigt Agenten-Puffer, Events-pro-Sekunde, etc. Real-Time-Daten via `siemApi.telemetry('wazuh')`

- **Schnellzugriff-Cards:** 5 Links zu den Kernseiten (Tickets, Threat Hunts, Evidence Center, Analyse-Deck, Settings)

- **Aktivitäten (Activity Feed):** Echtes Audit-Log der letzten 25 Einträge via `auditApi.recent(25)` mit Aktion, Typ, Akteur, relative Zeit

- **Übersicht (zwei Donuts + Statistik-Leiste):**
  - Tickets nach Priorität (critical/high/medium/low)
  - Hunts Status (active/planned/completed/failed/cancelled)
  - Top Erkennungsquellen (Top-5 Regeln/Offense-Quellen, nur für engineer/admin sichtbar via `socMetricsApi.get()`)

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /api/v1/tickets?limit=1` (gefiltert nach Priorität/State) | Ticket-KPIs, Prioritäts-Donuts |
| `GET /api/v1/hunts/sessions` | Hunt-Sessions, Hunt-Status-Donut |
| `GET /api/v1/evidence/recent?limit=500` | Evidence-Item-Anzahl |
| `GET /api/v1/health` | System-Health (optional, ignoriert Fehler) |
| `GET /api/v1/siem/wazuh/telemetry` | Live-Telemetrie, Agent-Buffer, Events/sec |
| `GET /api/v1/audit?limit=25` | Aktivitäten-Feed |
| `GET /api/v1/soc-metrics` | Top-Erkennungsquellen (engineer/admin only) |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu:**
  - `/tickets` — Klick auf Schnellzugriff-Card oder Ticket-KPI
  - `/threat-hunts` — Klick auf Hunt-KPI oder Schnellzugriff-Card
  - `/evidence` — Klick auf Evidence-KPI oder Schnellzugriff-Card
  - `/analysis` — Klick auf Schnellzugriff-Card (Analyse-Deck)
  - `/settings` — Klick auf Schnellzugriff-Card

## Zustände

- **Laden:** Spinner zeigt "Lagebild wird geladen …" während Parallelalufrufe für alle KPIs laufen
- **Leere Ansicht:** Wenn keine Tickets, Hunts oder Evidence existieren, werden die KPIs auf `0` oder `—` gesetzt (ehrlich)
- **Top-Erkennungsquellen nur für engineer/admin:** Viewer/Analyst sehen statt der Statistik einen Text "Nur für Engineer/Admin"; bei Fehler wird ebenfalls ein ehrlicher Hinweis gezeigt
- **Fehler:** GlobalErrorCard zeigt Fehler beim Laden der KPIs; alte Daten werden nicht gezeigt

**Stub/Mock:** Keine; alle Daten sind echt, wenn APIs erreichbar sind. Bei Fehler wird das ehrlich angezeigt.
