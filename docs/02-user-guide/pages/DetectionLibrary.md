# Detection Library (`/detections`)

## Zweck
Zeigt alle von Wazuh Manager geladenen Erkennungsregeln mit Filterung, Suche und Custom-Rule-Erstellung. Analyst kann neue Detection-Regeln in XML schreiben, FP-Ausnahmen verwalten und Published Detections aus dem Use-Case-Developer einsehen.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst` (Suche), `analyst+` (Neue Regel)  
**Navigations-Gruppe:** Settings / Integrations

## Funktionen

### Wazuh Detection Rules (Haupt-Bereich)

- **KPI-Zeilen:**
  - Total Rules Loaded
  - MITRE Techniques (Unique)
  - Custom Rules (ID ≥ 100000)
  - High Severity (Level ≥ 12)

- **Filter-Leiste:**
  - Freitextsuche (Description, Rule-ID)
  - Min. Level (numerisch, 1–16)
  - Group (z.B. sysmon, windows_security)
  - Rule-Typ (All / Detection / FP-Ausnahmen)
  - Clear-Button

- **Rules-Tabelle:**
  - Spalten: ID, Level, Description, MITRE, Groups, File
  - FP-Ausnahmen gekennzeichnet (Badge "FP-Ausnahme")
  - Paginierung (50 Regeln/Seite)
  - Status-Badge: FP-Range (900000–920000) oder Gruppe `soc_false_positive`

- **Neue Rule Modal:**
  - Description * (Pflicht)
  - Level * (1–15, Pflicht)
  - Parent-Rule-ID (if_sid, optional)
  - Field-Name * (Dropdown mit Common Fields: commandLine, image, targetFilename, srcip, dstip, full_log, etc.)
  - Match-Typ (regex / match)
  - Feld-Wert * (mit Beispiel-Hinweis)
  - Tags (kommagetrennt)
  - Speichern in `nexora-custom-detections.xml` (ID-Range 100500–109999)

### Nexora Published Detections (Unten)

- **Sektion:** "Nexora Published Detections — Snapshots aus dem Use-Case-Developer (nach Publish)"
- **Tabelle:** Title, Language (wazuh/sigma/splunk/qradar/generic), Severity, MITRE, Source, Rule-Vorschau
- **Status:** Empty State wenn keine publiziert; sonst Liste mit Scroll

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /detections` | Wazuh-Rules (paginated) mit Filterung |
| `POST /detections/custom` | Neue Custom-Regel schreiben |
| `GET /detections/published` | Nexora Published Detections (UCD) |

**Implementierungsdetail:** `detectionApi.list()`, `detectionApi.createCustom()`, `detectionApi.getPublishedDetections()`.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- **DetectionLibrary** (`/detections`) — selbst (Paginierung, Filter)

**Verlinkt zu:**
- **Use-Case-Developer** (`/use-case-developer`) — Context: Published Detections entstehen dort

## Zustände

| Zustand | Verhalten |
|---|---|
| **Wazuh nicht verbunden** | Badge "Wazuh-API nicht verbunden"; Regel-Erstellung deaktiviert |
| **Lädt** | Spinner in der Rules-Tabelle |
| **Rules angezeigt** | Gefilterte Tabelle mit Paginierung |
| **Keine Treffer** | "Keine Rules" mit Filter-Hinweis |
| **Modal offen** | Form zur Regel-Erstellung |
| **Regel speichern** | Button zeigt "Speichert …"; Erfolgs- oder Fehler-Meldung inline |
| **Published Detections leer** | Empty State "Noch keine Published Detections" |
| **Published Detections angezeigt** | Tabelle mit Snapshots |

**Hinweise:**
- FP-Regeln sind automatisch erkannt (ID-Range oder Gruppen-Membership)
- Custom-Regeln erhalten IDs im Range 100500–109999
- Neue Regel schreiben erfordert Wazuh-API-Verbindung (Backend-seitig)
- Published Detections sind Read-Only (aus UCD)
