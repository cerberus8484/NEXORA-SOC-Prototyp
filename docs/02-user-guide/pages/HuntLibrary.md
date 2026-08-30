# Hunt Library (`/hunt-library`)

## Zweck
Browseable Katalog aller verfügbaren vorgefertigten Hunts. Analysten können nach Kategorie/Risk filtern, Target anpassen und mit einem Klick eine Hunt starten. Zentrale Quelle für wiederverwendbare, sichere Threat-Hunting-Playbooks.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst`  
**Sichtbar in:** Hauptnavigation unter "Threat Hunts"

## Funktionen

- **Filter-Leiste:**
  - Freitextsuche (Titel, Beschreibung, MITRE)
  - Risk-Filter (Alle, critical, high, medium, low)
  - Kategorie-Filter (Alle, Persistence, Lateral Movement, Execution, Network, Exfiltration, Defense Evasion)
  
- **Hunt-Karten-Grid:**
  - Titel + Beschreibung
  - Risk-Badge
  - Kategorie + MITRE ATT&CK ID
  - Data Sources (Liste)
  - Target-Type + Vorgabe
  - **Target-Input:** Editierbares Feld pro Karte (Host/IP)
  - **Start-Button:** Bunt mit Status (Starte …, Starten, deaktiviert wenn keine Target)

- **Ergebnisse:** Auto-sortiert nach Risk (critical → high → medium → low)
- **Leerer Zustand:** "Keine Hunts gefunden — Filter anpassen"
- **Ladefehler:** ErrorCard mit Nachricht

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /hunts/catalog` | Hunt-Katalog-Items mit Metadaten |
| `POST /hunts` | Neue Hunt-Session anlegen + starten |

**Implementierungsdetail:** `huntApi.catalog()` + `launchHunt()` Helper.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- **HuntConsole** (`/threat-hunts/{id}`) — Nach erfolgreicher Hunt-Erstellung

**Erreichbar von:**
- **ThreatHunts** (`/threat-hunts`) — "Hunt Library" Link wenn keine Session aktiv

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt** | Spinner, Katalog wird abgerufen |
| **Katalog leer** | "0 Hunts" — (selten in Produktiv) |
| **Hunts angezeigt** | Gefilterte Karten im Grid |
| **Keine Treffer** | "Keine Hunts gefunden" mit Filter-Hinweis |
| **Target nicht eingegeben** | Start-Button deaktiviert |
| **Hunt startet** | Button zeigt "Starte …", deaktiviert |
| **Start-Fehler** | Fehler-Box oben auf der Seite |

**Note:** Target wird pro Hunt-Typ gemäß Session beibehalten (nicht über Navigationen hinweg).
