# Autonomy Policies (`/autonomy-policies`)

## Zweck
Verwaltungsseite für KI-Autonomie-Policies pro Mandant × Aktionsklasse. Definiert, welche KI-Aktionen (z. B. Host Response, Ticket Tagging) in welchem Modus (advisory, assisted, autonomous) laufen dürfen, ab welcher Confidence und mit welchen Limits. **Wichtig:** Policies sind vorbereitet, aber global inert — echte Durchsetzung erfordert `AUTONOMY_ENABLED=true` (ENV-Schalter).

## Rolle & Sichtbarkeit
**Mindest-Rolle:** admin  
**Nav-Gruppe:** System (nur Admin sichtbar)  
**Zugriffsprüfung:** Frontend-Gate + serverseitige admin-only Routes  

## Funktionen

### 1. Global-Status-Banner
- **Farbe:** Grün (aktiv) oder Orange (deaktiviert)
- **Anzeige:**
  - `AUTONOMY_ENABLED=false` (Default): „Policies sind vorbereitet, aber inert" + Hinweis zur Aktivierung
  - `AUTONOMY_ENABLED=true`: „Autonomie global aktiviert — Policies werden ausgewertet"
- Klick-freie Information (rein lesbar)

### 2. Aktionsklassen-Decken (unveränderlich)
- **Tabelle** mit 6 Aktionsklassen:
  - `enrichment`: TI-Lookup, Entity-Normalisierung (Decke: advisory)
  - `internal_state`: FP-Markierungen, Tags setzen (Decke: advisory)
  - `draft_generation`: Report-/Kundenantwort-Entwurf (Decke: assisted)
  - `detection_write`: Wazuh-FP-Regel schreiben + Restart (Decke: advisory)
  - `host_response`: Host-Isolation, Block (Decke: advisory)
  - `external_comms`: Mail/Ticket an Kunden (Decke: advisory)
- **Warnung:** Decken sind fest kodiert (ADR-016), können nicht überschrieben werden — Backend erzwingt sie
- Badge-Ton zeigt Decke-Level visuell an

### 3. Policy-Tabelle
- **Spalten:** Mandant | Aktionsklasse | Modus | Min. Verdict | Confidence | Max/h | Ev.-Floor | Status | Aktionen
- **Sortierung & Filter:** Nach Mandant oder Aktionsklasse gruppierbar (optional)
- **Reihe pro Policy:** Zeigt komplette Konfiguration
  - Wenn Decke-Verletzung erkannt: Hintergrund gelb + Warnung „Decke überschritten, Backend erzwingt …"
- **Aktionen:** Bearbeiten-Button | Löschen-Button

### 4. Policy-Formular (Modal: Anlegen / Bearbeiten)
- **Felder:**
  - `customer` (Mandant): Text oder `*` (alle)
  - `actionClass`: Dropdown (6 Klassen)
  - `mode`: Dropdown (advisory | assisted | autonomous)
  - `minVerdict`: Dropdown (needs_more_info | false_positive | suspicious | confirmed_incident)
  - `minConfidence`: Slider 0–1 (zeigt % an)
  - `maxPerHour`: Zahl (0 = kein Limit, Circuit-Breaker bleibt)
  - `requireEvidenceFloor`: Checkbox (Pflicht für Schreib-Klassen)
  - `enabled`: Checkbox (Policy aktiv ja/nein)
- **Validierung:**
  - Mode darf Aktionsklassen-Decke nicht überschreiten → Warnung im Formular
  - Customer + Aktionsklasse + Verdict erforderlich
- **Speichern:** POST/PUT → Toast „Policy angelegt/aktualisiert"

### 5. Delete-Confirm-Modal
- Bestätigungsdialog: „Policy löschen?"
- Anzeige von Mandant × Aktionsklasse
- **Warnung:** Diese Aktion kann nicht rückgängig gemacht werden
- **Aktion:** DELETE → Toast „Policy gelöscht"

### 6. Toast-Meldungen
- Kurzzeitig unten rechts
- Automatisches Ausblenden nach ~3.5s
- Klick zum manuellen Schließen

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| Globaler Status laden | `GET /api/v1/autonomy/status` | autonomyApi.getStatus() |
| Policies auflisten | `GET /api/v1/autonomy/policies` | autonomyApi.listPolicies() |
| Policy anlegen | `POST /api/v1/autonomy/policies` | autonomyApi.createPolicy() |
| Policy bearbeiten | `PUT /api/v1/autonomy/policies/:id` | autonomyApi.updatePolicy() |
| Policy löschen | `DELETE /api/v1/autonomy/policies/:id` | autonomyApi.deletePolicy() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** `/ki-agent` → Link „Autonomy-Policies konfigurieren"
- **Empfängt von:** keine (autonome Seite)
- **Sende-Link:** keine

## Zustände

### Laden
- Spinner beim initialen Load von Status + Policies
- Parallel laden beider Endpunkte

### Leer
- 0 Policies: Nachricht „Noch keine Policies angelegt. Klicke ‚Policy anlegen'…"
- Tabelle zeigt Platzhalter-Reihe

### Fehler
- API-Fehler: ErrorCard mit Fehlermeldung
- 403 Forbidden: Zugriff verweigert (Render-Gate)

### Busy-Zustände
- **Modal offen:** Form-Buttons disabled während Speicherung
- **Delete bestätigt:** Delete-Button disabled während Löschung

### Geplant / Inert
- **Globaler Schalter aus:** Alle Policies sind vorbereitet, aber keine wird aktiv ausgewertet
  - Banner erklärt: `AUTONOMY_ENABLED=false` setzen + Neustart
  - Policies können trotzdem angelegt/bearbeitet werden (kein Hindernis)

## Besonderheiten

1. **Decken-Enforcement:** Backend erzwingt Aktionsklassen-Decken — Policy kann sie nicht überschreiben
2. **ADR-016:** Autonomy-Policies folgen ADR-016 (Default-Deny, Evidence Floor, Confidence-Schwellen)
3. **Circuit-Breaker:** `maxPerHour=0` deaktiviert Stunden-Limit, Circuit-Breaker bleibt als Sicherheit
4. **Honest Design:** Wenn `AUTONOMY_ENABLED=false`, wird das prominent im Banner angezeigt — keine Fake-Aktivierung
5. **Evidence Floor:** Für Schreib-Klassen (`detection_write`, `host_response`, `external_comms`) Checkbox vorgesehen zur Pflicht-Validierung

## Häufige Workflows

### Neue Policy anlegen
1. Klick „Policy anlegen"
2. Form ausfüllen (Customer, Klasse, Modus, Verdict, Confidence)
3. Klick „Speichern"
4. Toast „Policy angelegt" → Tabelle refresht automatisch

### Policy bearbeiten
1. Tabellen-Reihe klick oder Bearbeiten-Button
2. Form mit bestehenden Werten präfüllt
3. Änderungen vornehmen
4. Klick „Speichern"
5. Toast „Policy aktualisiert"

### Policy löschen
1. Löschen-Button in Tabelle
2. Bestätigungs-Modal bestätigen
3. Toast „Policy gelöscht" → Tabelle refresht
