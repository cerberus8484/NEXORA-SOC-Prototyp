# System & Datenbank (`/system`)

## Zweck
Live-Status der Nexora-Plattform und der Backend-Datenbank: API-Health, DB-Verbindung, Uptime, sowie Kennzahlen (Tickets, Evidence, Hunts, Audit-Log, Benutzer), Speicherverbrauch und Schreib-Aktivität der letzten 14 Tage.

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** Keine Einschränkung (alle Rollen sehen diese Seite)
- **Nav-Gruppe:** Monitoring — Betrieb & Beobachtung

## Funktionen

- **Health-Zeile (oberen Card):**
  - **API:** Status-Badge (ok/warning/—), Live-Indikator
  - **Datenbank:** Status-Badge (ok/warning/—)
  - **Version:** Nexora-Version String
  - **Umgebung:** Env (development/production/staging)
  - **Uptime:** formatiert (z.B. "5d 3h" oder "42m")

- **DB-Modus-Hinweis:**
  - Wenn `DB_ENABLED=false`: EmptyState erklärt, dass Backend ohne Datenbank läuft, keine Kennzahlen verfügbar

- **KPI-Reihe (6 Kacheln, wenn DB aktiv):**
  - **Tickets:** Gesamt-Zahl + Hint (z.B. "42 offen")
  - **Evidence-Items:** Gesamt-Zahl
  - **Hunt-Sessions:** Gesamt-Zahl + Hint (z.B. "15 Findings")
  - **FP-Ausnahmen:** Gesamt-Zahl (warning-Ton)
  - **Audit (24h):** Events in der letzten 24h + "Ereignisse" Hint
  - **Benutzer:** Gesamt-Zahl registrierter Benutzer

- **Verteilungs-Cards (2-spaltig):**
  - **Tickets nach Priorität:** Balkendiagramm (critical/high/medium/low), farbcodiert
  - **Tickets nach Status:** Balkendiagramm (OPEN/CLOSED/IN_PROGRESS/etc.), farbcodiert

- **Speicherplatz-Card:**
  - DB-Gesamtgröße (z.B. "2.5 GB")
  - Top-Tabellen nach Bytes (Balkendiagramm), Tabellennamen + Größen monospace

- **Schreib-Aktivität-Card:**
  - Balkendiagramm der letzten 14 Tage (aus audit_log)
  - Y-Achse: Anzahl Schreibvorgänge, X-Achse: Tage (z.B. "24", "25", "26" … kurzform)
  - Gradient-Balken (grün), Peak-Wert angezeigt (rechts oben)
  - Tooltip pro Bar zeigt exaktes Datum + Zahl

## Datenquellen (Backend)

**Endpunkte:**
- `GET /api/v1/system/health` → HealthResponse (API, DB, Version, Env, Uptime)
- `GET /api/v1/system/stats` → SystemStats (Counts, byPriority, byState, storage, activity)

**API-Modul:** `frontend/src/features/system/systemApi.ts` → `systemApi.health()`, `.stats()`

**Rückgabetypen (Auswahl):**
```typescript
interface HealthResponse {
  status: 'ok' | 'warning' | 'error';
  db?: 'ok' | 'warning' | 'error';
  version?: string;
  env?: string;
  uptime?: number;  // seconds
}

interface SystemStats {
  dbEnabled: boolean;
  counts?: {
    tickets: number;
    ticketsOpen: number;
    evidence: number;
    hunts: number;
    findings: number;
    fpExceptions: number;
    audit24h: number;
    users: number;
  };
  byPriority?: Record<'critical' | 'high' | 'medium' | 'low', number>;
  byState?: Record<'OPEN' | 'CLOSED' | 'IN_PROGRESS' | string, number>;
  storage?: {
    dbBytes: number;
    tables: Array<{ name: string; bytes: number }>;
  };
  activity?: Array<{
    day: string;  // YYYY-MM-DD
    writes: number;
  }>;
}
```

## Verknüpfungen zu anderen Seiten

- **Verwandt mit:**
  - `/audit` — Audit-Log zeigt Schreib-Aktivität Details
  - `/tickets` — Ticket-Zähler sind interaktiv (indirekt verlinkt)

- **Keine direkten Navigationen** — reine Ansicht

## Zustände

- **Lade-Zustand:** Spinner "Status wird geladen …"

- **Fehler:** EmptyState "Nicht erreichbar — weder Health noch Stats antworten — Backend prüfen."

- **Keine DB:** Card erklärt, dass `DB_ENABLED=false`, keine weiteren Stats

- **Health OK:** Alle Panels sichtbar mit echten Daten

## Besonderheiten

- **Status-Badges:**
  - `ok` → grün
  - `warning` → gelb
  - `error` → rot
  - `—` → wenn nicht verfügbar (grau)

- **Balken-Visualisierungen:**
  - Nach Max-Wert skaliert (prozentual)
  - Farbcodierung nach Priorität / State

- **Uptime-Format:**
  - `>24h` → "Xd Yh" (z.B. "5d 3h")
  - `<24h` → "Xh Ym" (z.B. "12h 34m")

- **Speicher-Top-Tables:**
  - Nur Tables > einigen Prozent des Totals angezeigt (limit)
  - Sortiert nach Bytes absteigend

- **Activity-Chart:**
  - Letzte 14 Tage, automatisch ermittelt
  - Tage ohne Daten noch sichtbar (0-Balken oder Lücke)
  - Tooltip zeigt ISO-Datum + absolute Zahl

## Hinweise zur Ehrlichkeit der Daten

- **Alle Metriken:** Live vom Backend API abgerufen, nicht gecached
- **Health-Status:** Echte Ping-Checks (API ↔ DB)
- **Uptime:** Aus Server-Startzeit berechnet
- **Counts:** COUNT(*) Queries auf echte DB-Tabellen
- **Storage:** Echte Tablesize-Queries (z.B. `pg_total_relation_size()` in PostgreSQL)
- **Activity:** Aus audit_log aggregiert (COUNT per Tag)
- **Keine Demo-Daten:** Wenn DB offline, wird das deutlich (Spinner/Error, nicht Fake-Stats)
