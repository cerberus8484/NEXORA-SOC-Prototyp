# NIS2 Readiness (`/compliance/nis2`)

## Zweck
Komplianz-Dashboard zur Nachverfolgung der NIS2-Direktiven-Umsetzung. Zeigt Control-Registry (pro Control: Status, Evidence, Owner, Fälligkeit, Review-Status) sowie Incident-Verknüpfung und ein Management-Readiness-Report für Audits. Admins können Assessments bearbeiten, Evidence hinzufügen und Incident-Tickets verknüpfen. Analysten sehen Read-Only-Ansicht.

## Rolle & Sichtbarkeit
**Mindest-Rolle:** analyst (Read-Only) / admin (mit Bearbeitung)  
**Nav-Gruppe:** Compliance  
**Zugriffsprüfung:** Analyst+ können lesen; nur Admins können bearbeiten  

## Funktionen

### 1. View-Umschalter (oben)
- **Registry-View (Standard):** Control-Liste + Detail-Panel
- **Management-Report-View:** Readiness-Report (aggregierte Metriken)
- Buttons: Registry | Management-Report

### 2. KPI-Reihe (oben, beide Views)
- **Controls:** Gesamtzahl
- **Evidence-Coverage:** Prozent (z. B. 73%)
  - Farbcode: rot (< 50%) | orange (50–75%) | grün (> 75%)
- **Review nötig:** Anzahl Controls mit „review fällig" Flag
- **Überfällig:** Anzahl mit dueDate < heute
- **Review fällig:** Anzahl mit lastReviewedAt > 90 Tage alt

### 3. Registry View

#### Control-Tabelle (links)
- **Spalten:** Control | Status | Evidence | Owner | Fällig | Zuletzt geprüft | Signal
- **Status-Badge:** not_started | in_progress | addressed | not_applicable
  - Farben: muted | warning | success | warning
- **Signal-Badge:** ok | review | keine_evidence | überfällig
- **Row-Click:** Wählt Control für Detail-Panel
- **Sortierung/Filter:** Optional (z. B. nach Status oder Signal)

#### Detail-Panel (rechts)
- **Header:** Control-Titel + Status-Badge
- **Kurzbeschreibung:** Text des Controls
- **Quelle (Referenz):** ADR-Artikel oder Link (kein Rechtszitat)

- **Warning:** Falls Status=addressed aber keine Evidence → gelbes Alert-Banner
  - Text: „Status ‚Bearbeitet', aber keine Evidence verlinkt — das ist kein vollständiger Nachweis"

- **Evidence-Sektion:**
  - Liste der verknüpften Evidence (Typ | Titel | Ref | Löschen-Button für Admin)
  - Evidence-Typen: document | audit_report | policy | technical_implementation | incident_evidence
  - Falls keine: Hinweis + Evidence-Hinweise vom Control selbst (z. B. „Upload Backup-Report, …")

- **Assessment-Metadaten:**
  - Owner | Fällig bis | Zuletzt geprüft | Zuletzt geändert | ChangedBy

- **Notizen:** Falls vorhanden, Anzeigebereich

- **Admin-Panel (nur Admins):**
  - **Assessment-Formular:**
    - Status (Dropdown)
    - Owner (Textfeld)
    - Fällig bis (Date-Picker)
    - Zuletzt geprüft (Date-Picker)
    - Notizen (Textarea, max 4000 Zeichen)
    - Speichern-Button
  
  - **Evidence-Hinzufügen:**
    - Evidence-Typ (Dropdown)
    - Titel (Textfeld)
    - Referenz/URL (Textfeld, kein Secret, nur http/https)
    - Hinweis: „Der Ticket-Titel wird als Nachweis-Bezeichnung gespeichert — vor dem Verknüpfen auf personenbezogene Daten prüfen"
    - Button „Evidence verlinken"
  
  - **Incident-Ticket Verknüpfen:**
    - Select mit Incident-Tickets (ticketNr | titel)
    - Button „Incident als Nachweis verknüpfen"
    - Hinweis: Ticket-Titel wird als Evidence-Referenz gespeichert

- **Read-Only-Hinweis (Nicht-Admins):**
  - Text: „Nur-Lese-Ansicht — Änderungen sind Administratoren vorbehalten"

### 4. Management-Report View

#### Report-Header
- Generierungs-Datum + Katalog-Version
- Disclaimer (Hinweis zur Nicht-Zertifizierung)

#### Status-Verteilung (Pills)
- Badges für jeden Status mit Count (z. B. „addressed: 15", „in_progress: 8")

#### Incident-Coverage-Text
- Text: z. B. „12 von 32 Controls sind mit Incident-Evidenz verknüpft"

#### Report-Tabelle
- **Spalten:** Control | Status | Owner | Fällig | Evidence | Incidents | Signal
- **Signal:** ok | review | keine_Evidence | überfällig
- Alle Read-Only

### 5. Refresh-Button (global)
- Neu laden aller Daten (Controls + Report)
- Spinner während Load

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| Control-Registry auflisten | `GET /api/v1/compliance/nis2/controls` | nis2Api.getControls() |
| Control-Detail laden | `GET /api/v1/compliance/nis2/controls/:key` | nis2Api.getControlDetail() |
| Assessment aktualisieren | `PUT /api/v1/compliance/nis2/controls/:key/assessment` | nis2Api.updateAssessment() |
| Evidence hinzufügen | `POST /api/v1/compliance/nis2/controls/:key/evidence` | nis2Api.addEvidence() |
| Evidence entfernen | `DELETE /api/v1/compliance/nis2/evidence/:id` | nis2Api.removeEvidence() |
| Incident verknüpfen | `POST /api/v1/compliance/nis2/controls/:key/incidents` | nis2Api.linkIncident() |
| Management-Report | `GET /api/v1/compliance/nis2/report` | nis2Api.getManagementReport() |
| Tickets auflisten (für Incident-Select) | `GET /api/v1/tickets?limit=50&sort=createdAt&order=desc` | ticketApi.list() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** Compliance-Menü
- **Empfängt von / steuert:** Ticket-System (Incident-Verknüpfung → `/tickets/:id`)
- **Beeinflusst:** Audit-Log (alle Änderungen trackt)

## Zustände

### Laden
- Spinner beim initialen Load von Controls + Summary
- Tickets optional laden (für Incident-Select)

### Leer
- Keine Controls registriert: EmptyState (sollte nicht vorkommen, da Katalog vordefiniert)
- Keine Evidence pro Control: Hinweis

### Fehler
- API-Fehler: ErrorCard
- 403 Forbidden: Zugriff verweigert (nur analyst+)
- Detail-Load fehlgeschlagen: Error inline im Panel

### Admin-Aktionen
- **Assessment speichern:** Button disabled während Speichern, Toast auf Erfolg
- **Evidence hinzufügen:** Button disabled bis Titel + Referenz gefüllt
- **Credential widerrufen:** Button disabled während API-Call

## Besonderheiten

1. **Separate Evidence-Typen:** document, audit_report, policy, technical_implementation, incident_evidence
2. **Incident-Verknüpfung:** Ticket-Titel wird als Evidence-Referenz gespeichert — DSGVO-Check empfohlen
3. **Evidence-Floor:** Control muss mindestens 1 Evidence haben für Status=addressed
4. **Katalog vordefiniert:** Controls sind nicht editierbar — nur Assessments + Evidence
5. **Read-Only Report:** Management-Report ist zum Audit-Download/Sharing gedacht, keine Bearbeitungen hier
6. **Audit-Trail:** Alle Änderungen (updateAssessment, addEvidence, linkIncident) werden im Audit-Log trackt

## Häufige Workflows

### Control bewerten (Admin)
1. Registry-View, Control-Reihe klick
2. Detail-Panel öffnet
3. Assessment-Formular füllen (Status, Owner, Fällig, …)
4. Klick „Assessment speichern"
5. Toast „Assessment gespeichert"

### Evidence verlinken (Admin)
1. Detail-Panel, Evidence-Sektion
2. „Evidence hinzufügen" Formular
3. Typ wählen (z. B. audit_report)
4. Titel + Referenz (URL/Link) eingeben
5. Klick „Evidence verlinken"
6. Toast „Evidence hinzugefügt"

### Incident als Nachweis (Admin)
1. Detail-Panel, „Incident-Ticket verknüpfen"
2. Ticket aus Dropdown wählen
3. Klick „Incident als Nachweis verknüpfen"
4. Ticket-Titel wird als Evidence-Titel gespeichert
5. Toast „Incident verknüpft"

### Management-Report erzeugen (Admin)
1. View-Button „Management-Report" klick
2. Report mit KPIs + Tabelle anzeigen
3. Optional: Drucken (Ctrl+P) für PDF
4. Für Auditor freigeben

### Überblick über Compliance-Status (Analyst)
1. Registry-View, KPI-Reihe prüfen
2. Fällige Controls filtern / sortieren
3. Detail-Panel, Evidence-Übergabe + Review-Datum prüfen
4. Report-View: Gesamtfortschritt anzeigen
