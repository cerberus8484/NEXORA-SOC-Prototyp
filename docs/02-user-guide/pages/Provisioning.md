# Provisioning (`/provisioning`)

## Zweck
Zentrale Registry für Node-Enrollment und Agent-Provisioning. Administratoren erstellen Enrollment-Profile (mit definierter Rolle und Capabilities), erzeugen daraus zeitlich begrenzte Tokens, und überwachen enrollte Nodes, deren Heartbeat-Status, Credentials und Lifecycle-Ereignisse. Keine Remote-Befehle oder Apply-Funktionen — rein Read-Only-Registry + kontrollierter Lifecycle (Credential-Revocation, Node-Retirement).

## Rolle & Sichtbarkeit
**Mindest-Rolle:** admin  
**Nav-Gruppe:** System (Menü `Einstellungen > Provisioning`)  
**Zugriffsprüfung:** Frontend-Gate; echte Durchsetzung auf admin-only Backend-Routes  

## Funktionen

### 1. Enrollment-Profile-Tabelle
- **Spalten:** Name | Rolle | Capabilities | Status | Aktion
- **Rolle-Optionen:**
  - control_plane
  - normal_agent
  - integration_connector
  - network_sensor
  - gateway_sensor
- **Capabilities:** Tags (z. B. `threat_hunt`, `log_collection`)
- **Status-Badge:** active | inactive | disabled
- **Aktion: Token-Button**
  - Nur bei `status=active` aktiv
  - Klick → TokenModal mit Klartext-Token (einmalig!)
  - Token im Clipboard zum Kopieren bereit

### 2. Nodes-Tabelle
- **Spalten:** Name | Rolle | IP | Version | Status | Zuletzt gesehen
- **Status-Badge:** online | offline | pending | retired
- **IP:** Monospace-Font, `—` falls nicht bekannt
- **Version:** z. B. `1.0.2`, `—` falls nicht gemeldet
- **Zuletzt gesehen:** Relative Zeit (z. B. „vor 5 Minuten") + `stale`-Badge wenn älter als 1h
- **Click-Action:** Zeile klick öffnet Node-Detail-Modal

### 3. Node-Detail-Modal
- **Header:** Node-Name
- **Grid (2 Spalten):**
  - Status (Badge)
  - Rolle (Text)
  - IP (Monospace)
  - OS / Version
  - Zuletzt gesehen (relative Zeit + `stale`-Badge)
  - Letzter Heartbeat-Status

- **Credentials-Sektion:**
  - List der Credentials (Präfix | Status | Issued At | Aktion)
  - Status: active | expired | revoked
  - **Widerrufen-Button:** nur wenn Role=admin UND Status=active
  - Bestätigungs-Dialog vor Revocation

- **Capabilities-Sektion:**
  - Tags (z. B. `threat_hunt`, `log_collection`)
  - Nur eindeutige Capabilities pro Node

- **Heartbeats-Sektion:**
  - Letzte 8 Heartbeats (reverse chronologisch)
  - Status | Zeitstempel | Agent-Version
  - Nur Read-Only-Anzeige

- **Footer-Actions:**
  - „Node stilllegen"-Button (nur Admin, nur wenn Status=online/pending)
  - Bestätigungs-Dialog vor Retirement

### 4. Enrollment-Profil-Modal (Anlegen)
- **Felder:**
  - Name (Textfeld, erforderlich)
  - Rolle (Dropdown, erforderlich)
  - Capabilities (Checkboxen, read-only beschriftet)
- **Speichern:** POST → Toast „Enrollment-Profil angelegt" → Tabelle refresht
- **Abbrechen:** Modal schließt, keine Änderungen

### 5. Token-Modal (Klartext, einmalig)
- **Warnung:** „Dieser Token wird nur einmal angezeigt"
- **Token-Box:** Monospace, wordBreak, selektierbar
- **Kopieren-Button:** Clipboard-API → Badge „Kopiert" für 2s
- **Fertig-Button:** Schließt Modal

### 6. Bestätigungs-Dialog (useConfirm Hook)
- **Revocation:** Titel „Credential widerrufen", Nachricht mit Node-Name, Bestätigung „Widerrufen"
- **Retirement:** Titel „Node stilllegen", Nachricht mit Node-Name, Bestätigung „Stilllegen"
- **Danger-Flag:** Rote Buttons für beide
- **Async-Action-Mode:** Modal bleibt offen, Spinner während API-Call, Error inline anzeigen

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| Nodes auflisten | `GET /api/v1/provisioning/nodes?limit=200` | provisioningApi.listNodes() |
| Enrollment-Profile auflisten | `GET /api/v1/provisioning/profiles` | provisioningApi.listEnrollmentProfiles() |
| Enrollment-Profil anlegen | `POST /api/v1/provisioning/profiles` | provisioningApi.createEnrollmentProfile() |
| Token erzeugen (Klartext) | `POST /api/v1/provisioning/profiles/:id/token` | provisioningApi.mintToken() |
| Node-Detail laden | `GET /api/v1/provisioning/nodes/:id` | provisioningApi.getNode() |
| Node-Credentials auflisten | `GET /api/v1/provisioning/nodes/:id/credentials` | provisioningApi.listNodeCredentials() |
| Credential widerrufen | `POST /api/v1/provisioning/nodes/:id/credentials/:credId/revoke` | provisioningApi.revokeCredential() |
| Node stilllegen | `POST /api/v1/provisioning/nodes/:id/retire` | provisioningApi.retireNode() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** Settings / System (Menü)
- **Empfängt von:** keine
- **Verknüpft mit:** `/system` (Info über Agent-Status)

## Zustände

### Laden
- Spinner beim initialen Load von Profiles + Nodes
- Parallel laden beider

### Leer
- Keine Enrollment-Profile: Nachricht „Noch keine Enrollment-Profile…"
- Keine Nodes: Nachricht „Noch keine Nodes enrollt"
- Tabellen zeigen Platzhalter-Zeilen

### Fehler
- API-Fehler: ErrorCard mit Meldung
- 403 Forbidden: Zugriff verweigert
- Node-Detail-Load fehlgeschlagen: Error inline im Modal

### Busy-Zustände
- **Profile-Anlegen:** Button disabled während Speichern
- **Token-Erzeugung:** Button disabled, Spinner
- **Credential-Revocation:** Async-Dialog busy, Button disabled
- **Node-Retirement:** Async-Dialog busy, Button disabled

### Refresh
- Header-Button „Neu laden" triggert `load()` (beide Tables neu laden)

## Besonderheiten

1. **Klartext-Token einmalig:** Nach Erzeugung ist Token nur im Modal sichtbar — kein Abruf später
2. **Keine Bearbeitung:** Profile / Nodes können nach Anlegen nicht editiert werden (nur löschen via Retirement)
3. **Async-Lifecycle-Aktionen:** Revocation & Retirement nutzen useConfirm Hook (Bestätigung bleibt offen während API-Call)
4. **Heartbeat-Stale-Detection:** > 1h kein Heartbeat = stale-Badge
5. **Mounted-Guard:** Bei ticketApi.list (ticketId für Incident-Verknüpfung in NIS2) wird Mounted-Flag genutzt, um setState nach Unmount zu vermeiden (kein React-Warning)

## Häufige Workflows

### Neue Agent-Rolle registrieren
1. Klick „Profil anlegen"
2. Name eingeben, Rolle wählen, Capabilities optional
3. Klick „Anlegen"
4. Toast „Enrollment-Profil angelegt"

### Agent über Token enrollen (Off-Page)
1. Klick auf Token-Button neben Profil
2. TokenModal öffnet, Token kopieren
3. Auf Agent-Host: `agent enroll --token <COPIED_TOKEN>`
4. Token wird gehashed, nur Hash im DB gespeichert

### Node-Detail inspizieren
1. Nodes-Tabelle, Klick auf Node-Reihe
2. Modal öffnet mit Heartbeats, Credentials, Capabilities
3. Optional: Credential widerrufen (Revoke-Button)
4. Optional: Node stilllegen (Retire-Button in Modal-Footer)

### Node stilllegen (Cleanup)
1. Node-Detail-Modal öffnen
2. Klick „Node stilllegen"
3. Bestätigungs-Dialog
4. Node-Status wird `retired`, neue Enrollments auf diesem Node nicht akzeptiert
