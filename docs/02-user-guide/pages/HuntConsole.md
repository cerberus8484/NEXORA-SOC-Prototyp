# Hunt Console (`/threat-hunts/{id}`)

## Zweck
Detaillierte Einzelsicht für eine Hunt-Session. Zeigt Konsolenausgaben, Commands, Findings, Artifacts und Notizen in einer fokussierten Umgebung. Analyst kann die Hunt starten, Commands ausführen, Findings hinzufügen und Ergebnisse dokumentieren.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst`  
**Route-Parameter:** `id` (Hunt-Session-ID)  
**Erreichbar von:** ThreatHuntsPage Session-Liste oder Direct URL

## Funktionen

- **Session-Übersicht Header:** Hunt-Typ, Target-Host, Status, Zeitstempel
- **Hunt-Sessions-Sidebar:** Alle verfügbaren Sessions mit Status-Badge; Auswahl wechselt Session
- **Neue Hunt Modal:** Button zum Anlegen einer neuen Session; Input für Target-Host/IP
- **Hunt-Console-Komponente:** Zentrale Konsole mit mehreren Registerkarten
  - **Overview:** Session-Metadaten, Status, Risk Level, Hypothese, letzte Findings
  - **Logs:** Live-Konsolenausgaben mit Zeitstempel
  - **Findings:** Verwaltbare Liste gefundener Detektionen
  - **Commands:** Eingabe + Ausführung + Output von Safe Commands
  - **Artifacts:** Gesammelte Indikatoren/Dateien
  - **Ticket-Links:** Verknüpfte Tickets
  - **Notes:** Append-Only Notizen des Analysten

- **Session-Controls:** Start-, Complete-, Run-Command-Buttons
- **Findings-Dialog:** Modal zum Hinzufügen von Findings (Titel, Schweregrad, MITRE, Beschreibung)
- **Artifacts-Dialog:** Modal zum Hinzufügen von Artifacts (Typ, Wert)
- **Notes-Dialog:** Multiline-Eingabe für Notizen

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /hunts/{id}` | Session-Daten |
| `POST /hunts/{id}/start` | Hunt starten |
| `POST /hunts/{id}/complete` | Hunt beenden |
| `POST /hunts/{id}/run-command` | Safe Command ausführen |
| `GET /hunts/{id}/logs` | Konsolenausgaben |
| `GET /hunts/{id}/commands` | Ausgeführte Commands |
| `GET /hunts/{id}/artifacts` | Artifacts |
| `GET /hunts/{id}/findings` | Findings |
| `GET /hunts/{id}/ticket-links` | Verknüpfte Tickets |
| `GET /hunts/{id}/notes` | Notizen |
| `POST /hunts/{id}/findings` | Finding hinzufügen |
| `POST /hunts/{id}/artifacts` | Artifact hinzufügen |
| `POST /hunts/{id}/notes` | Notiz hinzufügen |

**Implementierungsdetail:** Nutzt `HuntConsole`, `HuntSessionList` und Dialog-Komponenten aus `frontend/src/features/hunts/`.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- **ThreatHunts** (`/threat-hunts`) — "Zurück"-Button
- **Andere Sessions** — Session-Sidebar Klick

**Empfängt von:**
- **ThreatHunts** (`/threat-hunts`) — Session-ID in Route

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt** | Spinner während Session abgerufen wird |
| **Session gefunden** | Vollständige Console mit allen Daten |
| **Session nicht gefunden** | ErrorCard |
| **Status: planned** | Start-Button aktiv, Complete deaktiviert |
| **Status: active** | Start deaktiviert, Complete aktiviert, Logs aktualisieren |
| **Status: completed** | Read-Only, kein Input möglich |
| **Command läuft** | Button deaktiviert bis Antwort kommt |
| **No Findings** | Leerer Zustand mit Platzhalter |

**Mock-Verhalten:** Commands antworten sofort mit Mock-Output; Logs aktualisieren nach Start.
