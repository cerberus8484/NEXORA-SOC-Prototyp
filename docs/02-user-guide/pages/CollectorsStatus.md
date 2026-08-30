# Kollektoren / Ingest-Quellen (`/collectors`)

## Zweck
Read-only Übersicht der **echten Ingestion-Aktivität** je Datenquelle über die letzten 24 Stunden. Zeigt, welche Quellen Tickets liefern, letzte Aktualisierung und Aktivitäts-Status. Ehrlich gekapselt: keine erfundenen Prozess-States.

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** Keine Einschränkung (alle Rollen sehen diese Seite)
- **Nav-Gruppe:** Integrations — SIEM-Quellen

## Funktionen

- **Read-Only Seite:** Keine Schreib-Aktionen, nur Ansicht

- **Ingestion-Tabelle:**
  - **Spalte "Quelle":** Name der Ingestion-Quelle (z.B. `wazuh`, `qradar`, `mail`, `honeypot-suricata`, `firewall`)
    - Monospaceer Font, fettgedruckt
  - **Spalte "Status":** Liveness-Badge
    - `Aktiv (24h)` — grün — Quelle hat in den letzten 24h mindestens ein Ticket geliefert
    - `Still` — gelb/warning — Quelle war aktiv, aber der letzte Eintrag ist älter als z.B. 6–12h
    - `Keine Daten` — grau/muted — Quelle hat noch nie ein Ticket geliefert (oder Data-Holdback)
  - **Spalte "Letzte 24h":** Ticket-Zahl aus der Quelle in den letzten 24h (rechtsausgerichtet, monospace)
  - **Spalte "Gesamt":** Gesamt-Ticket-Zahl aus dieser Quelle seit Inbetriebnahme (rechtsausgerichtet, monospace, gedimmter Text)
  - **Spalte "Zuletzt gesehen":** ISO-Zeitstempel der letzten Ticket-Einheit oder "—" wenn keine Daten
    - Format: `DD.MM HH:MM` (lokal)

- **Neu laden-Button:** Manuell Daten refreshen

- **Info-Hinweis (oben):** Wenn `liveProcessStatus` nicht verfügbar
  - Icon + Text: "Live-Prozessstatus nicht verfügbar — gezeigt wird die belegbare Datenankunft je Quelle, kein erfundener Prozessstatus."
  - Erklärt, warum keine "running/stopped"-States angezeigt werden

## Datenquellen (Backend)

**Endpunkt:** `GET /api/v1/collectors/pipeline` (neu gebaut 2026-06-30)  
**API-Modul:** `frontend/src/features/collectors/collectorsStatusApi.ts` → `getCollectorActivity()`

**Rückgabetyp:**
```typescript
interface CollectorActivity {
  liveProcessStatus?: {
    available: boolean;
    note: string;
  };
  sources: Array<{
    source: string;
    recent: number;       // 24h
    total: number;        // cumulative
    lastSeen: string | null;  // ISO
  }>;
}

function sourceLiveness(src: CollectorActivitySource): 'active' | 'quiet' | 'none' {
  // Logic: active = recent > 0 && lastSeen < 6h, quiet = recent > 0 but old, none = recent === 0
}
```

## Verknüpfungen zu anderen Seiten

- **Verwandt mit:**
  - `/dataplane` — zeigt Live-Pipeline-Status (Collector-Hub, Intake/Outbox-Zähler)
  - `/tickets` — ticketlist filtert sichtbar nach Quelle
  - `/wazuh` / `/qradar` — Integrations-Ursprünge dieser Daten

- **Keine direkten Navigationen** — reine Ansicht

## Zustände

- **Lade-Zustand:** Spinner (ohne Label, oder "Ingestion-Aktivität wird geladen")

- **Fehler:** ErrorCard "Ingestion-Aktivität konnte nicht geladen werden."

- **Keine Quellen registriert:** EmptyState
  - Titel: "Noch keine Ingestion"
  - Nachricht: "Es sind noch keine Tickets aus einer Quelle eingegangen."
  - Beispiel: frische Installation, bevor erste Tickets vom Honeypot oder Wazuh ankommen

- **Quellen vorhanden:** Tabelle mit echten Daten

## Besonderheiten

- **Ehrliche Liveness-Logik:**
  - `active` — wenn `recent > 0` UND `lastSeen < Schwelle` (z.B. 6h)
  - `quiet` — wenn `recent > 0` aber älter als Schwelle
  - `none` — wenn `recent === 0` (noch nie Daten oder 0 24h)

- **Hub-Status-Brücke fehlt noch:**
  - Info-Hinweis erklärt, dass Live-Prozessstatus vom Collector-Hub noch nicht verfügbar ist
  - Nur belegbare Datenankunft (aus Tickets) wird gezeigt, nicht Prozess-States

- **Update-Frequenz:** On-demand (manuelles Refresh), nicht auto-polled

## Hinweise zur Ehrlichkeit der Daten

- **Alle Zähler kommen aus der Ticket-DB:** COUNT(*) pro `source` in letzten 24h, nicht aus erfundenen Prozess-Metriken
- **Liveness:** Basiert auf echten Ticket-Zeitstempeln, keine Fake-Heartbeats
- **Keine Demo-Daten:** Wenn eine Quelle nie ein Ticket geliefert hat, wird sie nicht angezeigt (oder mit `recent=0`)
