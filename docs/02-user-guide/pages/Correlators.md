# Correlators (`/correlators`)

## Zweck
Registry der bekannten Correlatoren (Correlation Engines). Zeigt pro Correlator ein- und ausgänge, Queue-Status, Risiko-Klassifizierung, letzte Aktivität und genehmigungspflichtige Konfiguration. Rein Lese-Zugriff + Detailanzeige — keine Apply-, Restart- oder Remote-Befehle (bewusst, um Config-Lifecycle zu kontrollieren).

## Rolle & Sichtbarkeit
**Mindest-Rolle:** analyst (READ) / admin (admin-only Änderungen geplant)  
**Nav-Gruppe:** Data Plane / System  
**Zugriffsprüfung:** `canReadCorrelators(role)` — ab analyst aufwärts  

## Funktionen

### 1. Filter & Suche
- **Risiko-Filter:** Dropdown (Alle | low | medium | high)
- **Quelle-Filter:** Dropdown (Alle | [dynamisch aus inputSources der Correlators])
- **Nur aktive:** Checkbox (zeigt nur Correlatoren mit Queue.active > 0)
- **Anwendung:** Live-Update der Tabelle (useMemo)

### 2. Correlators-Tabelle
- **Spalten:**
  - **Correlator:** Name (clickable → Detail-Modal)
  - **Engine:** Version (Monospace)
  - **Inputs / Outputs:** Badges (Input-Sources → Pfeiltrennung → Output-Types)
  - **Risiko:** Badge (low | medium | high) mit Ton-Farbe
  - **Letzte Aktivität:** ISO-Zeitstempel oder `—`
  - **Queue:** Minimalanzeige (z. B. „42 aktiv, 8 blocked")
- **Row-Click:** Öffnet Detail-Modal

### 3. Correlator-Detail-Modal (CorrelatorDetailModal)
- **Header:** Correlator-Name
- **Hauptbereich:**
  - Beschreibung / Zweck
  - Input-Sources (Liste)
  - Output-Types (Liste)
  - Risiko-Klassifizierung + Beschreibung
  - Queue-Status (aktiv | blocked | backlog | abgelehnt)
  - Config-Übersicht (read-only)

- **Admin-Panel (falls role=admin):**
  - Config-Edit-Formular (geplant für Phase 2)
  - Approval-Gate-Anzeige
  - Hinweis: „Config erfordert Approval vor Anwendung"

- **Keine Aktionen:**
  - Kein Apply / Restart / Remote-Trigger
  - Keine Delete-Option

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| Correlators auflisten | `GET /api/v1/correlators` | correlatorsApi.list() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** Datenfluss-Monitoring, Deployment-Center
- **Empfängt von:** keine (autonome Seite)
- **Zeigt Details von:** Tickets, Events aus diesen Correlators

## Zustände

### Laden
- Spinner beim initialen Load der Correlator-Liste

### Leer
- Keine Correlators registriert: Nachricht
- Alle Correlators nach Filterung herausgefiltert: Nachricht „Keine Correlatoren für die aktuelle Filterung"

### Fehler
- API-Fehler: ErrorCard mit Meldung
- 403 Forbidden: Zugriff verweigert (Render-Gate)

### Detail-Modal Fehler
- Detail-Load fehlgeschlagen: Error inline im Modal

## Besonderheiten

1. **Read-Only-Registry:** Keine Bearbeitung von dieser UI aus — Config-Lifecycle über genehmigungspflichtige Kanäle
2. **Dynamische Quellen:** Quellen-Filter wird aus allen registrierten inputSources gebaut (useMemo)
3. **Queue-Headline:** Minimalanzeige der Queue (z. B. über queueHeadline-Funktion)
4. **Risiko-Ton:** low=muted, medium=warning, high=danger
5. **Analyst-Zugriff:** Ab analyst-Rolle sichtbar (kein admin-only Gate wie andere System-Seiten)

## Häufige Workflows

### Correlator-Status prüfen
1. Correlators-Seite laden
2. Optional: Nach Risiko / Quelle / aktiv filtern
3. Reihe klick → Detail-Modal
4. Queue-Status + letzte Aktivität einsehen

### Problem-Diagnose
1. Wenn Correlation ausfällt: Correlators-Seite → Filter „nur aktive"
2. Correlator-Detail prüfen: Queue blocked/backlog?
3. Input-Sources verfügbar?
4. Kontakt Admin für Config-Änderung (keine direkten Befehle von hier)
