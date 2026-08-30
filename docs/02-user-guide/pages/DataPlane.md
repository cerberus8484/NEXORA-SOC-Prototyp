# Data-Plane (`/dataplane`)

## Zweck
Read-only Live-Status der Korrelations-Pipeline: Collector-Hub-Zustand, Intake/Outbox-Zähler, pro Knoten Collector-Status und Fehler. Fail-honest: ohne frischen Status-Snapshot zeigt es das ehrlich an — keine erfundenen Prozesszustände.

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** analyst (server-side minRole, client-side gate)
- **Nav-Gruppe:** Integrations — SIEM-Quellen

## Funktionen

- **KPI-Reihe (5 Kacheln):**
  - **Knoten frisch:** `X/Y` — wie viele Knoten haben einen aktuellen Status-Snapshot (<Schwelle, z.B. 60s)
  - **Kollektoren laufend:** absolute Zahl aller aktiven Collector-Prozesse (aggregiert über alle Knoten)
  - **Intake gesamt:** kumulative Intake-Events pro-node, summiert
  - **Outbox pending:** kumulative pending-Message in der Outbox
  - **Fehler (Coll.+Outbox):** Collector-Fehler + Outbox-Fehler-Zähler (rot, wenn > 0)

- **Info-Hinweis (wenn nicht verfügbar):**
  - Text erklärt, dass kein frischer Status-Snapshot von einem Data-Plane-Knoten verfügbar ist
  - "Der Push-Job des Knotens meldet periodisch an `POST /dataplane/status` — bis dahin wird hier nichts erfunden."
  - Schwelle (in ms) wird angezeigt

- **Pro Knoten eine Card:**
  - **Header:** Node-ID (monospace), Health-Status-Badge (`healthy` / `warning` / `error`), Alter (z.B. "vor 5s"), Reported-at-Zeitstempel
  - **Counters (6 Werte):**
    - Intake gesamt
    - Intake abgelehnt
    - Outbox pending
    - Outbox retrying
    - Outbox failed (rot gefärbt wenn > 0)
  - **Collector-Tabelle (pro Knoten):**
    - Spalten: Kollektor-Name (monospace), Art (z.B. "wazuh", "suricata"), Status-Badge, Emittiert (Zähler), Fehler (MonoMeldung rot oder "—")
    - Sortierung nach Emittiert absteigend

- **Leerzustand:** "Noch kein Data-Plane-Knoten gemeldet" — erklärt, dass der Status erst angezeigt wird, sobald ein Knoten meldet

- **Neu laden-Button:** Manuelle Daten-Aktualisierung

## Datenquellen (Backend)

**Endpunkt:** `GET /api/v1/dataplane/status` (neu, 2026-06-30)  
**API-Modul:** `frontend/src/features/dataplane/dataplaneApi.ts` → `getPipelineStatus()`

**Rückgabetyp:**
```typescript
interface PipelineStatus {
  available: boolean;        // Hat mindestens einen frischen Snapshot?
  staleAfterMs?: number;     // Schwelle für Staleness (z.B. 60000ms)
  aggregate?: {              // Nur wenn available
    nodes: number;
    freshNodes: number;
    collectorsRunning: number;
    collectorsFailed: number;
    intake: { total: number; rejected: number };
    outbox: { pending: number; retrying: number; failed: number };
  };
  nodes: Array<{
    nodeId: string;
    health: 'healthy' | 'degraded' | 'error';
    ageMs: number;
    reportedAt: string;
    intake: { total?: number; rejected?: number };
    outbox: { pending?: number; retrying?: number; failed?: number };
    collectors: Array<{
      name: string;
      kind?: string;
      status: 'running' | 'stopped' | 'error' | 'unknown';
      emitted?: number;
      error?: string;
    }>;
  }>;
}

// View-Helper aus dataplaneView.ts:
function healthTone(health?: string): 'success' | 'warning' | 'danger' | 'muted'
function healthLabel(health?: string): string
function collectorStatusTone(status?: string): 'success' | 'warning' | 'danger' | 'muted'
function collectorStatusLabel(status?: string): string
function formatAge(ageMs?: number): string  // z.B. "vor 5s"
function formatTimestamp(iso?: string): string
```

## Verknüpfungen zu anderen Seiten

- **Verwandt mit:**
  - `/collectors` — echte Ingestion-Aktivität (Tickets aus Quellen)
  - `/wazuh` / `/qradar` — Integrations-Quellen (liefern via Data-Plane)

- **Keine direkten Navigationen** — reine Ansicht

## Zustände

- **Lade-Zustand:** Spinner (ohne Label, oder "Pipeline-Status wird geladen …")

- **Fehler:** ErrorCard "Pipeline-Status konnte nicht geladen werden."

- **Nicht verfügbar (kein frischer Snapshot):**
  - Info-Hinweis sichtbar
  - KPI + Knoten-Cards leer oder grayed-out
  - EmptyState "Noch kein Data-Plane-Knoten gemeldet"

- **Verfügbar mit Knoten:** Alle KPIs + Node-Cards sichtbar, Collector-Tabellen gefüllt

## Besonderheiten

- **Health-Indikatoren:**
  - `healthy` = grün
  - `degraded` = gelb
  - `error` = rot
  - `unknown` = grau (keine Info)

- **Collector-Status Mapping:**
  - `running` → grün
  - `stopped` → grau
  - `error` → rot
  - `unknown` → grau

- **Outbox-Fehler hervorgehoben:**
  - Wert rot gefärbt wenn > 0
  - Fehlerstring monospace, rot, verkürzt (ellipsis wenn lang)

- **Keine Auto-Polling:** Nur manuelles Refresh oder bei Page-Load

## Hinweise zur Ehrlichkeit der Daten

- **Alle Zähler:** Vom Hub/Knoten selbst gemeldet via `POST /dataplane/status`
- **Health-Status:** Basiert auf Prozess-Metriken vom Knoten, nicht erfunden
- **Collector-Status:** Echte Prozess-States, nicht simuliert
- **Keine Demo-Daten:** Wenn kein Knoten gemeldet hat, ist die Seite leer (nicht mit Fake-Daten gefüllt)
- **Staleness-Logik:** Explizit erklärt, nach wie vielen Sekunden ein Snapshot als "alt" gilt

## Architektur-Hinweis

Die Data-Plane ist eine Hub-Backend-Status-Brücke: Collector-Hubs melden ihren Status periodisch an die API. Diese Seite zeigt den **letzten gemeldeten Snapshot**, nicht die Live-Prozesse selbst. Daher "stale" States möglich, wenn der Hub nicht regelmäßig meldet.
