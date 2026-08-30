# YARA Engine (`/yara`)

## Zweck
Verwaltet Pattern-Matching-Regeln (YARA) für Logs, Payloads und Artefakte. Analysten können Custom-Regeln erstellen, aktivieren/deaktivieren, testen und Live-Scans gegen Text eingeben. Fokus auf Malware-Erkennung und verdächtige Muster.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst` (Scan), `analyst+` (Neue Regel), `admin` (Löschen)  
**Navigations-Gruppe:** Analysis / Detection Tools

## Funktionen

### Regel-Management (Linker Bereich)

- **KPIs:**
  - Regeln gesamt
  - Aktiv (enabled)
  - Inaktiv

- **Neue Regel Form (collapsible):**
  - Name * (Pflicht; z.B. "detect_mimikatz")
  - Beschreibung (Optional)
  - Severity (critical, high, medium, low, info)
  - Condition (any / all)
  - MITRE ATT&CK ID (Optional; z.B. T1059)
  - Tags (kommagetrennt; z.B. "malware, credential")
  - Pattern-Typ (text / regex / hex)
  - Pattern-Wert * (Pflicht; mit Format-Beispiel)
  - Groß-/Kleinschreibung ignorieren (Checkbox: nocase)

- **Regel-Liste (Cards):**
  - Expandierbare Karten pro Regel
  - Header: Toggle (enable/disable), Name, MITRE-ID, Severity-Badge, Status-Badge
  - Expanded View:
    - Beschreibung
    - Tags (Badges)
    - Condition (JSON oder String)
    - Pattern(s) (Typ + Wert + Modifier)
    - Löschen-Button (Admin-only)

### Live-Scan (Rechter Bereich)

- **Scan-Eingabe:**
  - Textarea für Log-Zeile, Payload, Commandline, etc.
  - Placeholder: "cmd.exe /c powershell -enc …"

- **Scan-Button:** 
  - Text: "Gegen N aktive Regeln scannen"
  - Disabled wenn Input leer oder Scanning läuft

- **Scan-Ergebnis:**
  - Regel-Count: "X Regel(n) geprüft"
  - Match-Status: "✓ kein Match" (grün) oder "⚠ Y Treffer" (rot)
  - Pro Match:
    - Regel-Name (fett)
    - Severity-Badge
    - MITRE-ID (mono)
    - Pattern-Hits (indentiert): "↳ Pattern: [value]"

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /yara` | Alle YARA-Regeln |
| `POST /yara` | Neue Regel erstellen |
| `PUT /yara/{id}` | Regel aktualisieren (enable/disable) |
| `DELETE /yara/{id}` | Regel löschen (Admin) |
| `POST /yara/scan` | Live-Scan mit Input-Text |

**Implementierungsdetail:** `yaraApi` aus `frontend/src/features/yara/yaraApi.ts`.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- (keine Direktnavigation; Seite ist selbstbeschränkt)

**Verlinkt zu:**
- **DetectionLibrary** (`/detections`) — YARA-Regeln sind ergänzend zu Wazuh-Rules
- **HuntLibrary** (`/hunt-library`) — YARA-Tagged Hunts

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt** | Spinner, Regeln werden abgerufen |
| **Regeln angezeigt** | Karten + Live-Scan-Panel |
| **Keine Regeln** | Empty State "Keine Regeln" |
| **Neue Regel-Form offen** | Form mit Input-Feldern |
| **Regel speichern** | Button "Speichert …"; Erfolgs-/Fehlermeldung inline |
| **Scan läuft** | Button deaktiviert, Ladeindikator |
| **Scan abgeschlossen** | Ergebnis-Box mit Matches oder "kein Match" |
| **Scan-Fehler** | Fehler-Nachricht unter Input |
| **Lösch-Bestätigung** | Modal/Dialog vor Löschen |
| **Aktion-Fehler** | Inline-Fehler-Box am oberen Rand |

**Hinweise:**
- Regeln sind Toggle-fähig (enable/disable ohne Löschen)
- Live-Scan ist Echtzeit-Pattern-Matching (keine Speicherung)
- Custom-Regeln können beliebig viele Pattern(s) enthalten (derzeit 1 pro UI)
- Severity + MITRE + Tags helfen bei der Triage und Gruppierung
