# MITRE ATT&CK Coverage (`/mitre`)

## Zweck
Zeigt die Abdeckung des MITRE ATT&CK Frameworks durch aktuell geladene Wazuh-Rules. Visualisiert Lücken im Erkennungsvermögen pro Taktik und Technik, um Threat-Hunting-Prioritäten zu identifizieren.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst` (Read-Only)  
**Navigations-Gruppe:** Analysis / Threat Intelligence

## Funktionen

- **KPI-Summary:**
  - Coverage % (Gesamtabdeckung)
  - Abgedeckte Techniken (Count)
  - Lücken (Total − Covered)
  - Taktiken-Anzahl

- **Legend:**
  - ✓ Abgedeckt (grün)
  - ○ Keine Regel (grau)
  - (optional) Badge wenn Wazuh offline

- **Taktik-Grid:**
  - Grid layout (auto-fill, minmax 200px)
  - Pro Taktik-Karte:
    - Taktik-Name + ID (z.B. "TA0001")
    - Counter: "X/Y Techniken (Z%)"
    - Progress-Bar mit Coverage %
    - Liste aller Techniken in der Taktik
      - ✓ oder ○ Icon
      - Technik-ID (z.B. T1234)
      - Technik-Name
      - (Optional) Hover-Tooltip mit Status

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /detections?limit=500` | Alle Regeln laden (für Coverage-Berechnung) |

**Implementierungsdetail:** Frontend extrahiert MITRE IDs aus Rules, berechnet Coverage mithilfe von `MITRE_MATRIX` (statisches Subset, ~75 Techniken über 14 Taktiken) und `buildCoverageSet()`.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- (keine Direktnavigation; Seite ist Read-Only)

**Verlinkt zu:**
- **DetectionLibrary** (`/detections`) — Context für welche Regeln die Techniken abdecken
- **HuntLibrary** (`/hunt-library`) — MITRE-getaggte Hunts

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt** | Spinner mit "Coverage wird berechnet" |
| **Wazuh verbunden** | Live Coverage aus aktuellen Rules |
| **Wazuh nicht verbunden** | Statisches Framework ohne Live-Coverage; Badge mit Warnung |
| **Coverage berechnet** | Grid mit Taktiken + Techniken + Progress-Bars |

**Hinweis:** MITRE_MATRIX ist ein kuratiertes Subset (nicht das vollständige Framework). Nur abgedeckte Techniken zählen; nicht genau gemappte Rules werden ignoriert.

**Technik-Verknüpfung:** Klick auf Technik könnte später zu "Regeln für diese Technik" führen (nicht implementiert).
