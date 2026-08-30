# QRadar Analysis Center (`/qradar`)

## Zweck
Dedicated IBM QRadar SIEM Integration für Offense-Triage und Langzeitinvestigation: Offense-Queue (gefiltert/gesucht), Detailübersicht (5 Tabs), Threat-Intel-Anreicherung, Analyst-Notizen und Report-Export. **RBAC-gekapselt:** Analyst+ nur.

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** analyst (server-side + client-side gate)
- **Nav-Gruppe:** Integrations — SIEM-Quellen

## Funktionen

- **Verbindungs-Status:** Badge zeigt "VERBUNDEN" (grün) oder "NICHT VERBUNDEN" (grau)

- **Offense Queue (links):** Scrollbare Liste mit Filter + Suchfeld
  - Pro Offensive: Priority-Badge (farbcodiert), Zeitstempel (relativ), Offense-ID + Name, Source-IP, Kategorie, Event-Count
  - Aktivzustand: linker Rand farblich, leicht anderer Hintergrund
  - **Filter:** OPEN / ALL (Radiobuttons), serverseitig gefiltert
  - **Suchfeld:** Live-Filter über Offense-Name, Beschreibung, Source-IPs, Kategorien, ID (Client-seitig)

- **Offense Header (oben Mitte):** 
  - Basisfelder in Reihen angeordnet: ID, Priority, Status, Severity/10, Magnitude/10, Assigned To
  - Button "In QRadar öffnen" (extern über `VITE_QRADAR_URL`, optional)
  - Zweite Zeile: Source IPs, Destination IPs, Event Count, Start Time, Last Updated

- **5 Tabs:** summary · events · iocs · notes · report

  1. **SUMMARY Tab:**
     - Offense Description (Fließtext, pre-wrap)
     - QRadar Scoring (Severity/Credibility/Relevance/Magnitude mit farbigen Progress-Balken)
     - Categories & MITRE: QRadar-Kategorien + MITRE Techniques als Badge-Listen
     - Network Context: Source IPs, Destination IPs, Log Sources
     - Timeline: Start, Last Event, Events, Flows

  2. **EVENTS Tab:**
     - Event Log als Tabelle (max ~50 Events)
     - Pro Event: Zeitstempel, Log Source, Kategorie, Quell-IP:Port → Ziel-IP:Port, Username (falls vorhanden)
     - Event-Message (monospace, word-break, multiline)
     - Lazy-Loading: nur geladen wenn Tab aktiv ist

  3. **IOCs Tab:**
     - Indicators of Compromise: kombiniert Source + Destination IPs aus der Offense
     - Pro IP: Badge "ip", IP-Adresse, Threat-Intel-Verdict (Button "Globe"-Icon), Copy-Button
     - On-demand Threat-Intel Enrichment: `threatIntelApi.enrich('ip', ip)` → Verdict + Score + Confidence + Summary + Tags
     - Fehlerbehandlung: Enrichment-Error sichtbar unter IP-Reihe

  4. **NOTES Tab:**
     - 2-spaltig: links Analyst Notes (persistente Liste), rechts Investigation Checklist (8 vordefinierte Items)
     - Analyst Notes: scrollbare Liste, sortiert absteigend nach createdAt, jeweils Timestamp + Author-Kürzel + Content
     - Neuer Text-Input (5000-Zeichen-Limit), "Speichern"-Button, Zeichenzähler
     - Schreib-Berechtigung: `can.act(user?.role)` — Viewer-Nutzer sehen nur "erfordert Analyst-Rolle"
     - Checklist: 8 Items (z.B. "Source IP in Threat Intel geprüft", "Betroffene Hosts isoliert") mit Checkboxen, localStorage-frei (transienter UI-State)

  5. **REPORT Tab:**
     - Markdown-Report vorgebaut (Details: Summary, Description, Scores, Assets, Categories, MITRE, Log Sources, Timeline, Analyst Notes)
     - Buttons: "Copy to Clipboard", "Export Markdown", "Create Nexora Ticket" (nur Analyst+)
     - False Positive Button: "Als False Positive schließen" (nur Analyst+)
     - Report enthält echte Analyst-Notizen (nachgeladen via `qradarApi.getOffenseNotes()`)

- **Enrichment Sidebar (rechts):**
  - Threat Intel Panel: On-demand Enrichment der Source-IP mit Score/Confidence/Summary/Tags
  - Quick Facts: Offense ID, Priority, Event Count, Sources, Assigned To
  - Actions: "In QRadar öffnen", "Nexora Ticket erstellen", "Als False Positive schließen"

- **KPI-Leiste (oben bei verbundener QRadar):**
  - 4 KPI-Cards: Offenses offen, Critical, High, Total Events (alle `toLocaleString('de-DE')`)

## Datenquellen (Backend)

**Endpunkte:**
- `GET /api/v1/qradar/offenses[?status=OPEN|ALL]` → Offense-Liste mit Filterung
- `GET /api/v1/qradar/stats` → KPI-Daten + connection status
- `GET /api/v1/qradar/offenses/:offenseId/events` → Events einer Offense (lazy, pro Tab)
- `GET /api/v1/qradar/offenses/:offenseId/notes` → Analyst-Notizen (persistenter Speicher)
- `POST /api/v1/qradar/offenses/:offenseId/notes` → Neue Notiz hinzufügen
- `GET /api/v1/threat-intel/enrich` (query: `type=ip&value=IP`) → Verdict + Score + Confidence

**API-Modul:** `frontend/src/features/qradar/qradarApi.ts` → `qradarApi.*`

**Rückgabetypen (Auswahl):**
```typescript
interface QRadarOffense {
  id: number;
  offenseName: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  severity: number;      // 0-10
  credibility: number;   // 0-10
  relevance: number;     // 0-10
  magnitude: number;     // 0-10
  sourceIps: string[];
  destIps: string[];
  sourceCount: number;
  eventCount: number;
  flowCount: number;
  startTime: string;
  lastUpdated: string;
  categories: string[];
  mitreT: string[];      // MITRE Techniques
  logSources: string[];
  assignedTo?: string;
}

interface OffenseNote {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

interface ThreatIntelResult {
  verdict: 'malicious' | 'suspicious' | 'clean' | 'unknown';
  score: number;
  confidence: number;
  summary: string;
  tags: string[];
  indicatorValue: string;
}
```

## Verknüpfungen zu anderen Seiten

- **Navigiert zu:**
  - Externe Systeme: "In QRadar öffnen" Button öffnet QRadar-Offense-Konsole im neuen Tab (via `VITE_QRADAR_URL`)
  - `/tickets` (implizit über Ticket-Create-Hook) — "Create Nexora Ticket" erstellt ein Ticket aus der Offense und kehrt ggf. zur Ticket-Ansicht zurück

- **Empfängt von:**
  - QRadar-Instanz (ENV: `QRADAR_URL` + `QRADAR_TOKEN`)
  - Threat-Intel-Service (interne API)

- **Daten-Ursprung:**
  - Offense-Daten = QRadar REST API (`GET /api/siem/offenses/`)
  - Events = QRadar Ariel-Query
  - Notizen = Nexora-DB (persistenter Speicher, mapped auf Offense-ID)

## Zustände

- **Nicht konfiguriert:**
  - QRadarNotConnected EmptyState: "QRadar nicht konfiguriert"
  - Nachricht erklärt, dass `QRADAR_URL` + `QRADAR_TOKEN` in Env-Vars gesetzt sein müssen
  - Kein KPI-Block, leerer Offense-Queue

- **Lade-Zustand:** Spinner "QRadar Offenses werden geladen …"

- **Fehler beim Laden:** ErrorCard mit Fehlermeldung

- **Verbunden, aber keine Offenses:** EmptyState "Keine offenen Offenses"

- **Offense ausgewählt, Tabs laden lazy:**
  - Events Tab: Spinner während Laden, dann Tabelle oder EmptyState "Keine Events"
  - IOCs Tab: Client-seitig aus Source + Dest IPs abgeleitet, sofort sichtbar
  - Notes Tab: Spinner während Lade, dann Liste oder "Noch keine Notizen"
  - Report Tab: Markdown sofort generiert (lädt Notizen nach zur Anreicherung)

- **RBAC-Block (Viewer-Rolle):**
  - Full-page EmptyState "Keine Berechtigung"
  - Nachricht: "Das QRadar Analysis Center erfordert mindestens die Analyst-Rolle."

## Spezialverhalten

- **Fiktive QRadar-URL:** Wenn `VITE_QRADAR_URL` nicht gesetzt, Button "In QRadar öffnen" deaktiviert mit Tooltip
- **Threat-Intel bei IOCs:** On-demand, nicht vorgeladen; Error-Feedback sichtbar
- **False Positive Workflow:** "Als False Positive schließen" erzeugt ein Ticket mit Status `CLOSED` + `verdict=false_positive`
- **Suche & Filter:** Query-Parameter nicht persistent (Session-Zustand nur); Filter wechselt zurück zu Seite 1

## Hinweise zur Ehrlichkeit der Daten

- **Alle Daten kommen echts von QRadar** — keine Mock-Alerts
- **Threat-Intel-Verdikt:** Kann "unknown" sein; Score/Confidence werden echts vom Service geliefert (oder nicht, wenn Service nicht erreichbar)
- **Notizen:** Persistente DB-Speicherung in Nexora; werden nicht automatic gelöscht oder manipuliert
- **MITRE Techniques:** Aus QRadar-Regel-Mapping, nicht erfunden
