# SOC-Metriken (`/soc-metrics`)

## Zweck
Team-Performance und Detection-Qualität auf einen Blick: Mean Time To Resolution (MTTR), False-Positive-Rate, Ticket-Last pro Analyst, Top-Rules und Status-Verteilungen. Nur für Engineer/Admin sichtbar (geschäftskritische KPIs).

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** engineer (server-side minRole, client-side gate)
- **Nav-Gruppe:** Monitoring — Betrieb & Beobachtung

## Funktionen

- **KPI-Reihe (4 Kacheln):**
  - **MTTR (Median):** formatiert (z.B. "2h 15m") + Hint (Ø Mittelwert, n=Stichprobengröße)
    - Tone: accent
  - **False-Positive-Rate:** formatiert (z.B. "8.5%") + Hint (X FPs / Y geschlossene)
    - Tone: dynamisch — green (<10%), yellow (10–30%), red (>30%)
  - **Offen:** absolute Zahl + Hint (geschlossene)
    - Tone: warning
  - **Tickets gesamt:** absolute Zahl + Hint (vollständig / Stichprobe, wenn gecapped)
    - Tone: accent
    - Warnung "Stichprobe" wenn `meta.capped=true`

- **Badge "Stichprobe":** Oben rechts, wenn Daten-Sampling aktiv
  - Text: "Stichprobe (X/Y Tickets)"
  - Erklärt, dass bei großen Datenmengen eine Stichprobe berechnet wird

- **4 Panels (2x2 Grid):**
  - **Top-Rules (häufigste Offenses):** Balkendiagramm, Regel-Key auf der Y-Achse, Count auf X
  - **Last pro Analyst:** Tabelle (Analyst, Gesamt, Offen), Offen als Badge (warning wenn >0, else muted)
  - **Nach Status:** Balkendiagramm (Statuswerte: acknowledged/investigating/awaiting-approval/false-positive/resolved)
  - **Nach State:** Balkendiagramm (OPEN/CLOSED, etc.)

## Datenquellen (Backend)

**Endpunkt:** `GET /api/v1/metrics/soc`  
**API-Modul:** `frontend/src/features/metrics/socMetricsApi.ts` → `socMetricsApi.get()`

**Rückgabetyp:**
```typescript
interface SocMetrics {
  mttr: {
    medianMs: number;
    meanMs: number;
    sampleSize: number;
  };
  fpRate: {
    rate: number | null;      // 0–1
    fpCount: number;
    closedCount: number;
  };
  byState: Record<string, number>;    // OPEN/CLOSED/etc.
  byStatus: Record<string, number>;   // acknowledged/investigating/etc.
  topRules: Array<{ key: string; count: number }>;
  analystLoad: Array<{
    analyst: string;        // email oder '_unassigned'
    total: number;
    open: number;
  }>;
  meta: {
    totalTickets: number;
    sampledTickets: number;
    capped: boolean;
  };
}

// Helper
function formatDuration(ms: number): string  // "2h 15m"
function formatRate(rate: number | null): string  // "8.5%"
```

## Verknüpfungen zu anderen Seiten

- **Verwandt mit:**
  - `/tickets` — Ticket-Liste (Detail-Ansicht der Metriken-Quelle)
  - `/analysis` — Analyst-Arbeit (verursacht diese Metriken)
  - `/audit` — Audit-Log (Analyst-Aktionen)

- **Keine direkten Navigationen** — reine Ansicht

## Zustände

- **RBAC-Block (Nicht-Engineer):**
  - Full-page EmptyState
  - Titel: "Zugriff verweigert"
  - Nachricht: "SOC-Metriken sind Engineer/Admin vorbehalten."

- **Lade-Zustand:** Spinner "Metriken werden berechnet …"

- **Fehler:** EmptyState "Konnte Metriken nicht laden — Bitte später erneut versuchen."

- **Erfolgreiche Ladung:** Alle 4 KPIs + 4 Panels sichtbar

## Besonderheiten

- **MTTR-Berechnung:**
  - Nur auf geschlossene Tickets angewendet (create → close)
  - Wenn zu wenig Daten: können Werte null sein
  - Samplesize zeigt, wie viele Tickets in die Berechnung flossen

- **FP-Rate:**
  - `fpCount / closedCount`
  - Wenn closedCount=0: rate=null (keine Division-by-zero)
  - Tone-Wechsel: green (<0.1), yellow (0.1–0.3), red (>0.3)

- **Daten-Sampling:**
  - Bei sehr großem Ticketbestand kann die Berechnung gecapped werden
  - `meta.capped=true` signalisiert Stichprobe
  - UI warnt deutlich oben mit Badge

- **Analyst-Last:**
  - "_unassigned" zeigt unzugewiesene Tickets
  - Offen-Zähler als Badge mit dynamischem Ton

## Hinweise zur Ehrlichkeit der Daten

- **MTTR:** Echte Timestamps aus Ticket-DB (created_at, closed_at)
- **FP-Rate:** Count echte false_positive-Verdicte aus Ticket-DB
- **Toppers:** COUNT GROUP BY aus Ticket-DB
- **Analyst-Last:** ASSIGNED_TO Verteilung aus Ticket-DB
- **Sampling:** Wenn aktiviert, wird die Stichprobe-Größe transparent kommuniziert
- **Keine Fake-Metriken:** Falls zu wenig Daten, bleibt der Wert null oder wird erklärend angezeigt
