# Nexora SOC — Benutzerhandbuch

**Version:** 1.1  
**Gültig ab:** 2026-06-20  
**Sprache:** Deutsch

---

## Inhaltsverzeichnis

1. [Erste Schritte](#erste-schritte)
2. [Anmeldung](#anmeldung)
3. [Zwei-Faktor-Authentifizierung (MFA/TOTP)](#zwei-faktor-authentifizierung-mfatotp)
4. [Dashboard](#dashboard)
5. [Tickets verwalten](#tickets-verwalten)
6. [Reports (Incident- & Kunden-Report)](#reports-incident--kunden-report)
7. [Threat Hunting](#threat-hunting)
8. [KI-Agent (Copilot)](#ki-agent-copilot)
9. [Detection Library](#detection-library)
10. [Evidence & Threat Intelligence](#evidence--threat-intelligence)
11. [Hosts & Inventory](#hosts--inventory)
12. [Compliance — NIS2-Readiness](#compliance--nis2-readiness)
13. [Provisioning-Registry (nur Admin)](#provisioning-registry-nur-admin)
14. [Audit-Log & Export](#audit-log--export)
15. [Benachrichtigungskanäle](#benachrichtigungskanäle)
16. [Einstellungen](#einstellungen)
17. [Profil & Self-Service (Sprache, MFA, API-Token)](#profil--self-service-sprache-mfa-api-token)
18. [FAQ](#faq)

> **Verfügbarkeit:** Funktionen, die hier mit **„nach Aktivierung verfügbar"** markiert sind,
> liegen im Code vor, sind aber standardmäßig deaktiviert und werden erst durch den Betreiber
> (Admin/Operator) über eine Umgebungs-Einstellung freigeschaltet. Alle anderen Funktionen sind
> **live**.

---

## Erste Schritte

### Zugriff

Nexora ist verfügbar unter:

```
https://nexora.example
```

oder in der lokalen Entwicklung:

```
http://localhost:5173
```

### Rollen & Berechtigungen

| Rolle | Berechtigung |
|---|---|
| **Admin** | Vollzugriff, Benutzerverwaltung, System-Settings |
| **Engineer** | Hunts, KI-Vorschläge, False-Positive-Regeln, Detections |
| **Analyst** | Tickets, Hunts starten, KI-Vorschläge, Evidence |
| **Viewer** | Lesen von Tickets, Hunts, Detections |

---

## Anmeldung

### Login

1. Öffne [https://nexora.example](https://nexora.example)
2. Gib deine E-Mail-Adresse ein
3. Gib dein Passwort ein
4. Klick **Login**

**Dev-Konto (Lokal):**
```
E-Mail: admin@nexora.example
Passwort: DevAdmin123!
```

### Passwort ändern

1. Gehe zu **Einstellungen** (Zahnrad-Symbol, oben rechts)
2. Klick **Profil**
3. Gib dein aktuelles Passwort ein
4. Gib ein neues Passwort ein (mind. 8 Zeichen)
5. Klick **Passwort ändern**

### Abmeldung

1. Klick auf dein **Profilfoto** (oben rechts)
2. Klick **Abmelden**

### Anmeldung mit Passkey (WebAuthn / FIDO2) {#anmeldung-mit-passkey-webauthn--fido2}

*Nach Aktivierung durch den Betreiber verfügbar.*

Hat der Betreiber WebAuthn eingeschaltet und du hast in deinem Profil einen Passkey hinterlegt
(z. B. Windows Hello, Touch ID, Sicherheitsschlüssel), erscheint auf der Login-Seite zusätzlich
ein **Passkey**-Button. Ein Klick darauf meldet dich ohne Passwort an — die Bestätigung erfolgt
über deinen Authenticator (Fingerabdruck, Geräte-PIN oder Hardware-Token).

**Hinweis:** Passkeys ergänzen die TOTP-Zwei-Faktor-Authentifizierung, sie ersetzen sie nicht.
Der klassische Passwort-Login bleibt parallel verfügbar. Das Einrichten/Löschen von Passkeys
erfolgt im [Profil](#profil--self-service-sprache-mfa-api-token).

### Single Sign-On (SSO / OIDC)

*Nach Aktivierung durch den Betreiber verfügbar.*

Wenn der Betreiber eine OpenID-Connect-Anbindung (z. B. an einen zentralen Identity-Provider
wie Entra ID / Keycloak) eingerichtet hat, erscheint auf der Login-Seite ein **SSO**-Button.
Damit meldest du dich über den zentralen Identity-Provider an. Der Passwort-Login bleibt
parallel verfügbar. Ob neue Accounts automatisch angelegt oder nur bestehende Konten verknüpft
werden, legt der Betreiber fest.

---

## Zwei-Faktor-Authentifizierung (MFA/TOTP)

Nexora unterstützt eine zeitbasierte Zwei-Faktor-Authentifizierung (TOTP, kompatibel mit
Google Authenticator, Authy, Microsoft Authenticator u. a.). Der zweite Faktor ist ein
6-stelliger Code, der sich alle 30 Sekunden in deiner Authenticator-App ändert.

> **Live**, sofern der Betreiber MFA freigeschaltet hat. Ist MFA freigeschaltet, kannst **du als
> einzelner Nutzer** entscheiden, ob du es einrichtest — es sei denn, der Betreiber hat eine
> **organisationsweite Pflicht** aktiviert (siehe unten).

### MFA selbst einrichten

1. Gehe zu **Profil** (Klick auf dein Profilfoto oben rechts → **Profil**)
2. Öffne die Karte **Zwei-Faktor-Authentifizierung**
3. Klick **MFA einrichten**
4. Es erscheint ein **QR-Code** sowie das Geheimnis (Secret) im Klartext.
   - Scanne den QR-Code mit deiner Authenticator-App, **oder**
   - gib das Secret manuell in der App ein (`otpauth://`-Schlüssel)
5. Deine App zeigt nun einen 6-stelligen Code. Gib diesen Code zur **Bestätigung** ein.
6. Klick **Aktivieren**

### Recovery-Codes sichern (einmalig!)

Nach der Aktivierung zeigt Nexora dir eine Liste **einmaliger Recovery-Codes**.

> **Wichtig:** Diese Codes werden **nur ein einziges Mal** angezeigt. Speichere sie an einem
> sicheren Ort (Passwort-Manager, ausgedruckt im Tresor). Jeder Code funktioniert genau einmal
> und erlaubt dir die Anmeldung, falls du keinen Zugriff auf deine Authenticator-App hast
> (z. B. Handy verloren). Ohne Authenticator und ohne Recovery-Code muss ein Admin dich
> entsperren.

### Login mit zweitem Faktor

1. Gib wie gewohnt E-Mail und Passwort ein → **Login**
2. Es erscheint die Abfrage **MFA-Code**
3. Öffne deine Authenticator-App und gib den aktuellen 6-stelligen Code ein
4. Klick **Bestätigen**

Alternativ kannst du an dieser Stelle einen deiner **Recovery-Codes** eingeben (verbraucht
den Code).

### Organisationsweite MFA-Pflicht

Der Betreiber kann MFA **für alle Konten verpflichtend** machen
(*Einstellungen → Sicherheit → MFA-Pflicht*). Ist die Pflicht aktiv und du hast noch keine
MFA eingerichtet, wirst du **direkt beim nächsten Login** durch den Einrichtungs-Schritt geführt:
QR-Code anzeigen → Code bestätigen → Recovery-Codes sichern. Erst danach erhältst du Zugang.
Bestehende Sitzungen werden dadurch nicht ausgesperrt; der Schritt greift beim nächsten Anmelden.

---

## Dashboard

Das Dashboard zeigt dir einen schnellen Überblick über offene Incidents.

### Komponenten

**Key Performance Indicators (KPIs):**
- Offene Tickets (heute)
- Gelöste Tickets (diese Woche)
- Durchschnittliche Bearbeitungszeit
- Top-Alerts (nach Häufigkeit)

**Recent Activity:**
- Zuletzt geänderte Tickets
- Neue Findings aus Hunts
- Neue KI-Vorschläge

**Alerts heatmap:**
- Visualisierung von Alert-Trends (letzte 7 Tage)

### Navigation

Der **Sidebar** zeigt diese Hauptseiten:

- **Dashboard** — Start-Seite
- **Analysis** — Ticket-Workbench (Kern)
- **Threat Hunts** — Hunt-Katalog und laufende Sessions
- **Detection Library** — YARA-Regeln und Wazuh-Detections
- **KI-Agent** — Vorschlag-Queue (für Approval)
- **Hosts** — Agent-Inventory und Heartbeat
- **Compliance → NIS2** — Readiness-Status, Evidence, Management-Report
- **Provisioning** — Node-/Agent-Registry (nur Admin)
- **Audit-Log** — Nachvollziehbarkeit aller Aktionen, Export
- **Einstellungen** — Profil, System, API-Keys, Benachrichtigungen

---

## Tickets verwalten

### Analysis-Seite (Kern-Workbench)

Die **Analysis**-Seite ist deine Hauptwerkbank zur Triage von Incidents.

#### Ticket-Liste

**Filter:**
```
State    → OPEN | CLOSED
Status   → assigned | in_progress | on_hold | awaiting_customer
Priority → critical | high | medium | low
Assigned → <dein Name> | <anderer Analyst>
Source   → wazuh | qradar | splunk | manual
```

**Sortierung:**
- Neueste zuerst (Standard)
- Nach Priorität (wichtigste oben)
- Nach Änderungsdatum

**Suche:**
- Sucht in: Titel, Beschreibung, IOCs
- **Tipp:** Suche nach IP: `192.168.241.100`

#### Ticket-Detail

Klick auf ein Ticket, um es zu öffnen:

**Info-Panel (Links):**
- Ticket-Nummer (z.B. `INC000001`)
- Titel + Beschreibung
- State + Status + Priority
- Source (von welchem SIEM)
- Host-Name, User, Source-IP, Destination-IP

**Tabs (Rechts):**

1. **Evidence** — Struktur-Daten aus dem Event
   - Raw-Event von Wazuh/QRadar
   - Normalisierte Felder (Timestamp, Agent, Rule, etc.)
   - MITRE ATT&CK-Taktiken (blau verlinkt)

2. **Threat Intel** — IOC-Anreicherung
   - IP-Reputation (VirusTotal, AbuseIPDB)
   - Domain-Lookups
   - Hash-Verdicts

3. **History** — Audit-Trail
   - Wer hat was geändert
   - Wann (UTC-Timestamp)
   - Was wurden Felder geändert

4. **Comments** — Notizen
   - Deine Analyse-Notizen
   - Füge Kommentare hinzu mit `+ Kommentar`

5. **Related** — Verwandte Tickets
   - Tickets vom gleichen Host
   - Tickets mit gleicher Source-IP

#### Ticket bearbeiten

Klick auf **Bearbeiten**, um Änderungen vorzunehmen:

**Status ändern:**
```
assigned → in_progress  (Bearbeitung starten)
in_progress → on_hold   (Warte auf weitere Infos)
on_hold → in_progress   (Fortsetzen)
```

**Notizen hinzufügen:**
- Beschreibe deine Analyse-Schritte
- Notiere Findings
- Dokumentiere Entscheidungen

**Dem selbst oder anderen zuweisen:**
- Klick auf **Zugewiesen an:** Dropdown
- Wähle einen Analyst

#### Ticket schließen

1. Klick **Schließen** oben im Ticket-Detail
2. Wähle einen **Schließ-Grund:**
   - ✅ **Gelöst** — Problem behoben
   - ❌ **False Positive** — Falsche Warnung
   - 🔄 **Duplikat** — Bereits als anderes Ticket erfasst
   - ⚠️ **Benign** — Nicht-schädliche Aktivität
   - 📝 **Sonstiges** — Andere Gründe
3. Gib optional eine Notiz ein (z.B. "Malware gelöscht")
4. Klick **Bestätigen**

**Hinweis:** Geschlossene Tickets können wieder geöffnet werden (Klick **Reopen**).

#### Ticket exportieren

1. Öffne ein Ticket
2. Klick **⋮** (Menü) oben rechts
3. Klick **Als PDF exportieren**
   - Exportiert: Titel, Beschreibung, Evidence, History
4. Speichere die Datei

---

## Reports (Incident- & Kunden-Report) {#reports-incident--kunden-report}

Aus denselben Ticket-Daten erzeugt Nexora zwei unterschiedliche Report-Perspektiven. Beide
sind als **PDF-Download** verfügbar. Du findest die Buttons im **Report-Tab** des Tickets.

### Incident-Report (technisch)

Für das SOC, Analysten-Kollegen und die interne Nachvollziehbarkeit. Enthält den vollen
technischen Kontext:

- Übersicht (Ticket-Nummer, Schweregrad, Status, Zeitstempel)
- Analyst-Zusammenfassung
- Entitäten (Hosts, Benutzer, Prozesse, Netzwerk)
- Timeline
- MITRE-ATT&CK-Zuordnung
- Entscheidung / Empfehlung

### Kunden-Report (nicht-technisch)

Für die Weitergabe an Kunden oder das Management — in verständlicher, nicht-technischer
Sprache (Schweregrad und Status in Klartext).

> **Bewusst ohne technische Details:** Der Kunden-Report enthält **keine IP-Adressen, keine
> MITRE-Technik-IDs, keine IOCs und keine Roh-Logdaten**. So kannst du ihn ohne weitere
> Schwärzung an externe Empfänger weitergeben.

### Report erzeugen

1. Öffne ein Ticket
2. Wechsle in den Tab **Report**
3. Klick **Incident-Report (PDF)** oder **Kunden-Report (PDF)**
4. Die PDF wird im Browser generiert und heruntergeladen

---

## Threat Hunting

Threat Hunts sind gezielte Suchen nach verdächtigen Aktivitäten auf Systemen.

### Hunt-Katalog

1. Gehe zu **Threat Hunts**
2. Du siehst eine Karten-Katalog mit vorbereiteten Hunts:

**Verfügbare Hunts:**

| Hunt | Sucht nach |
|---|---|
| **Suspicious PowerShell** | Encoded/obfuscated Commands |
| **Lateral Movement** | RDP, SSH, WMI Lateral Moves |
| **Persistence Mechanisms** | Registry Persistence, Scheduled Tasks |
| **Data Exfiltration** | Große Datenübertragungen |
| **Credential Access** | LSASS-Dumping, Mimikatz |
| **DNS Tunneling** | DNS-basierter Command & Control |

### Hunt starten

1. Klick auf eine Hunt-Karte
2. **Konfigurieren (Optional):**
   - Host-Filter: `ENDPOINT-001` oder leer für alle
   - Zeitbereich: Letzte 24 Stunden (Standard)
3. Klick **Hunt starten**

### Hunt-Console

Während der Hunt läuft:

**Live-Ausgabe:**
```
⏳ Scanning 5 Hosts...
✓ ENDPOINT-001: 3 findings (4s)
⟳ ENDPOINT-002: scanning...
✓ ENDPOINT-003: 0 findings (2s)
[Scanning 2 Hosts... 40% done]
```

**Nach Abschluss:**

Klick auf **Findings anschauen** oder siehe die Tabelle:

| Host | Severity | Title | Evidence |
|---|---|---|---|
| ENDPOINT-001 | 🔴 High | Base64-Encoded PowerShell | powershell.exe -enc... |
| ENDPOINT-001 | 🟠 Medium | Suspicious Argument | -NoProfile -NonInteractive |
| ENDPOINT-003 | 🟡 Low | Windows Event Log Clear | Cleared logs |

### Finding verwenden

Für jedes Finding hast du Optionen:

**→ Als Ticket erstellen**
1. Klick **→ Ticket**
2. Gib einen Titel ein
3. Wähle Priorität
4. Klick **Erstellen**
   - Ein neues Ticket wird angelegt mit diesem Finding als Evidence

**→ Zur Existing-Ticket hinzufügen**
1. Klick **+ Evidence**
2. Suche dein Ticket
3. Das Finding wird als Evidence hinzugefügt

**→ Notiz hinzufügen**
1. Klick **+ Kommentar**
2. Dokumentiere deine Beobachtungen

### Response-Aktionen (Host-Isolation)

Im Tab **Response-Aktionen** kann ein kompromittierter, verwalteter Host isoliert werden — **nie
automatisch**, immer von mehreren Menschen getragen (Vier-Augen + Reauth):

1. **Anfragen** (Analyst): `Host isolieren` bzw. `Isolation aufheben` mit Begründung.
2. **Genehmigen** (Admin/Engineer ≠ Anforderer): mit dokumentierter Rechtsgrundlage (Betriebsrat / Notfall).
3. **Ausführen** (Admin ≠ Anforderer): in „Bereit zur Ausführung" das **Passwort bestätigen** (Reauth) → `Ausführen`.
   Die eigene Anfrage kann man nicht selbst ausführen; ohne Passwort ist der Button deaktiviert.

Die Isolation kappt den Host vom Netz (Linux: nftables · Windows: Windows-Firewall), hält aber den
**Management-Kanal offen**. `Isolation aufheben` stellt die Konnektivität wieder her. Sperrt sich der Kanal
nach wiederholten Fehlern, erscheint für Admins ein **Warnbanner mit Entsperren-Button**.

> **Standardmäßig inaktiv:** Ohne Scharfschaltung durch den Betrieb passiert nichts (Kill-Switch, kein Kanal).
> Details im Containment-Runbook (`docs/01-architecture/adr-042-containment-runbook.md`).

---

## KI-Agent (Copilot)

Der KI-Agent ist dein Analyst-Copilot: Er schlägt automatische Maßnahmen vor.

### Vorschlag anfordern

1. Öffne ein Ticket in der **Analysis**-Seite
2. Klick **🤖 KI-Vorschlag**
3. Wähle einen **Vorschlag-Typ:**

| Typ | Was der Agent macht |
|---|---|
| **False-Positive-Regel** | Vorschlag für Wazuh-Ausnahmeregerl |
| **Eskalation** | Empfehlungen zur Eskalation |
| **Korrelation** | Verwandte Events finden |
| **Remediation** | Remediation-Schritte |

4. Klick **Generieren**

**Hinweis:** Das dauert 10–30 Sekunden (lokal auf Ollama).

### Vorschlag bewerten

Der Agent zeigt seinen Vorschlag:

```
🤖 False-Positive-Regel
─────────────────────
Rule: Exclude legitimate admin activity
Condition: hostname=ADMIN-PC AND user=admin AND command=powershell
Confidence: 85%
```

**Optionen:**

- ✅ **Akzeptieren** — Regel wird zu Wazuh hinzugefügt
  - Künftig werden solche Events nicht mehr alarmieren
  - Audit-Log vermerkt: `AGENT_APPROVE` + dein Name
  
- ❌ **Ablehnen** — Vorschlag wird verworfen
  - Du kannst optional einen Grund eingeben
  - Der Agent lernt daraus (optional)

### KI-Vorschlag-Queue

Gehe zu **KI-Agent**, um alle Vorschläge zu verwalten:

**Tabs:**
- **Ausstehend** — Noch nicht bewertet
- **Genehmigt** — Deine Genehmigungen
- **Abgelehnt** — Abgelehnte Vorschläge

---

## Detection Library

Die Detection Library zeigt alle Erkennungsregeln.

### YARA-Regeln

YARA ist ein Pattern-Matching-Tool für Text/Binärdaten.

**Eine Regel erstellen:**

1. Gehe zu **Detection Library**
2. Klick **+ Neue YARA-Regel**
3. Füll die Felder aus:

```
Name:        My_Detection_Rule
Description: Detects suspicious PowerShell pattern
Tags:        execution, obfuscation
Patterns:    powershell.exe
             -enc
             base64
Condition:   all of them
Severity:    high
Author:      dein Name
```

4. Klick **Erstellen**

**Eine Rule testen:**

1. Gehe zu **Detection Library** → **YARA Scan**
2. Gib einen Text/Befehl ein:
   ```
   powershell.exe -enc VwByAGkAdABlAC0ASABvAHN0
   ```
3. Klick **Scannen**
4. Vorher: Regeln, die passen, werden grün markiert

### Wazuh-Detections

Zeigt die Erkennungsregeln aus Wazuh Manager.

**Suchen:**
- Nach Beschreibung
- Nach Wazuh-Group (z.B. `execution`, `persistence`)
- Nach Level (1–15)

**Filter:**
- Nur bestimmte Gruppen anzeigen
- Nur Regeln mit Level >= X

---

## Evidence & Threat Intelligence {#evidence--threat-intelligence}

### Evidence-Anreicherung

Jedes Ticket wird automatisch angereichert:

**IOC-Extraktion:**
- IPs (z.B. `192.168.241.100`)
- Domains (z.B. `malware.com`)
- Hashes (MD5, SHA-1, SHA-256)
- E-Mail-Adressen

**Automatische TI-Lookups:**
1. **VirusTotal** — Hash/IP/Domain-Reputation
   - Zeigt: Verdicts der Antivirus-Engine
   - Link: Klick auf VT-Icon → VirusTotal-Report
2. **AbuseIPDB** — IP-Reputation
   - Zeigt: Abuse-Score (0–100)
   - Kategorien: Malware, DDoS, Spamming, etc.

### IOC-Details anschauen

1. Öffne ein Ticket
2. Gehe zu **Threat Intel**
3. Du siehst eine Tabelle mit allen IOCs:

```
IP-Adresse       Quelle         Score    Verdict
─────────────────────────────────────────────────
192.168.241.100    abuseipdb      75       malicious
192.168.241.100    virustotal     5 eng.   suspicious
c2.malware.com   virustotal     40 eng.  suspicious
```

Klick auf eine IOC, um den vollständigen Report zu sehen.

---

**Berechtigung:** Threat-Intel-Anreicherung ist fuer Analyst, Engineer und Admin gedacht.
Viewer koennen vorhandene Ticket- und IOC-Informationen lesen, aber keine neuen externen
Provider-Abfragen ausloesen. So werden API-Quota und moegliche IOC-Datenabfluesse begrenzt.

## Hosts & Inventory {#hosts--inventory}

Die **Hosts**-Seite zeigt deine Wazuh-Agenten.

### Agent-Status

Tabelle mit allen registrierten Agenten:

| Agent | IP | OS | Status | Heartbeat |
|---|---|---|---|---|
| ENDPOINT-001 | 192.168.241.100 | Windows 10 | 🟢 active | vor 5 min |
| ENDPOINT-002 | 192.168.241.101 | Windows Server 2022 | 🟢 active | vor 2 min |
| ENDPOINT-003 | 192.168.241.102 | Ubuntu 22.04 | 🔴 disconnected | vor 4 Tagen |

**Filter:**
- Status (active, disconnected, never_connected)
- OS-Familie (Windows, Linux, Mac)

### Agent-Detail

Klick auf einen Agent-Namen:

**System-Info:**
- Hostname, IP-Adresse
- OS + Version + Architektur
- CPU-Cores, RAM, Disk-Space

**Installierte Pakete:**
- Antivirus (z.B. Windows Defender)
- Patch-Level
- Browser-Versionen

**Network-Interfaces:**
- Aktive NICs
- MAC-Adressen
- Gateway

**SCA-Compliance (Security Configuration Assessment):**
- Sicherheits-Scores
- Failed Checks (was zu konfigurieren ist)

---

## Compliance — NIS2-Readiness {#compliance--nis2-readiness}

Die Seite **Compliance → NIS2** (`/compliance/nis2`) unterstützt dich dabei, den Stand der
NIS2-Risikomanagement-Maßnahmen zu dokumentieren und Nachweise (Evidence) zu sammeln.

> **Ehrliche Einordnung — bitte beachten:** Diese Seite ist eine **Arbeits- und
> Nachweis-Unterstützung**. Sie ist **kein Konformitätsnachweis, keine Zertifizierung und kein
> Rechtsgutachten**. Nexora behauptet an keiner Stelle, „NIS2-konform" oder „zertifiziert" zu
> sein. Die Bewertung, ob eine Maßnahme ausreichend ist, triffst du bzw. deine Organisation.

### Aufbau

- **KPIs** oben: Anzahl Controls, Evidence-Abdeckung, Review-Bedarf, überfällige Punkte
- **Control-Registry:** ein statischer, versionierter Katalog mit **10 Maßnahmenbereichen**
  (deutsche Titel)
- **Detail-Panel:** je Control der Status, hinterlegte Nachweise und (für Admins) die
  Bearbeitung

### Status je Maßnahme setzen (Admin)

1. Wähle in der Registry eine Maßnahme aus
2. Setze im Detail-Panel den **Status:**
   - *Nicht begonnen → in Arbeit → adressiert*, oder
   - *Nicht anwendbar* — hierfür ist eine **Begründung Pflicht**
3. Speichern

**Lese-Zugriff** haben alle Rollen (Viewer und höher); **Bearbeiten** ist Admins vorbehalten.

### Nachweise (Evidence) verknüpfen

Du kannst je Maßnahme Belege hinterlegen (z. B. Link auf eine Richtlinie, ein Wiki, ein
Konfigurations-Dokument). Es gibt 8 Evidence-Typen.

> **Sicherheits-Hinweis zu Links:** Als Beleg-Link sind nur `http`/`https`-URLs erlaubt. URLs,
> die wie Geheimnisse aussehen (Tokens/Passwörter in Query oder Fragment) oder `javascript:`/
> `data:`-Schemata werden abgelehnt. So gelangen keine versehentlich verlinkten Secrets in die
> Nachweis-Sammlung.

### Incident als Nachweis verknüpfen (Admin)

Im Control-Detail kannst du über **„Incident verknüpfen"** ein bestehendes Ticket als Beleg
anhängen (Ticket-Picker). Übernommen wird nur ein **sicherer Auszug** — die INC-Nummer, der
bereinigte Titel, Priorität und State. Es werden **keine personenbezogenen Daten** (E-Mail,
Benutzer, Abteilung, Quell-IP, Notizen, Logs) übernommen.

### Readiness-Signale

Nexora zeigt ehrliche Hinweise je Maßnahme:

- **Überfällig** (`overdue`) — Frist überschritten
- **Nachweis fehlt** (`missingEvidence`) — kein Beleg hinterlegt
- **Review nötig** (`needsReview`) — z. B. als *adressiert* markiert, aber **ohne Nachweis**
- **Review fällig** (`reviewDue`) — *nach Aktivierung verfügbar:* eine adressierte Maßnahme
  **mit** Nachweis, deren letzter Review älter als die festgelegte Kadenz ist (Standard
  365 Tage)

### Management-Report

Im Tab **„Management-Report"** erhältst du eine zusammenfassende Sicht: Status-Verteilung,
Evidence-Abdeckung, Incident-Nachweis-Zähler und einen klar gekennzeichneten **Disclaimer**
(kein Konformitätsnachweis). Lese-Zugriff ab Viewer.

---

## Provisioning-Registry (nur Admin)

Die Seite **Provisioning** (`/provisioning`) ist eine Registry zur Verwaltung von Nodes/Agenten
(z. B. zusätzlichen Sensoren). Sie ist **nur für Admins** sichtbar und bedienbar.

> **Wichtig — was Provisioning NICHT tut:** Nexora sendet über diese Funktion **keine
> ausführbaren Befehle** an die Nodes, ändert **keine Netzwerk-/Firewall-Einstellungen** und
> spielt **keine Konfiguration aus**. Ein Node meldet sich lediglich (Heartbeat) und erhält als
> Antwort ausschließlich Status-Informationen — niemals Kommandos.

### Enrollment-Profil anlegen

1. Klick **Profil anlegen**
2. Vergib einen Namen und wähle die Rolle sowie die (read-only) Fähigkeiten des Nodes
3. Speichern

### Enrollment-Token erzeugen (einmalig sichtbar!)

1. Wähle ein Enrollment-Profil
2. Klick **Token erzeugen**
3. Der Token (`enr_…`) wird **genau einmal** in einem Modal angezeigt — mit Kopier-Button

> **Wichtig:** Der Token wird nur dieses eine Mal im Klartext gezeigt. Kopiere ihn sofort und
> verwende ihn beim Einrichten des Nodes. Nexora speichert den Token nicht im Klartext, sondern
> nur als Prüfsumme — er erscheint danach **nirgends** mehr (nicht in der Tabelle, nicht im
> Audit-Log). Geht er verloren, erzeuge einen neuen.

### Node-Status & Heartbeat verstehen

In der Node-Tabelle siehst du je Node:

- **Status** (z. B. *pending, enrolled, active, stale, retired*)
- **Letzter Heartbeat** (Frische — z. B. „gerade eben", „vor 5 min")
- Im **Detail-Modal:** IP, OS, Fähigkeiten, Heartbeat-Historie und die hinterlegten
  Betriebs-Credentials (es wird nur der Präfix angezeigt, **nie** das vollständige Credential)

### Credential widerrufen / Node stilllegen

Im Node-Detail-Modal stehen Admin-Aktionen bereit:

- **Credential widerrufen** — ein widerrufenes Betriebs-Credential wird sofort ungültig; der
  Node kann keine Heartbeats mehr senden, bis er neu eingerichtet wird.
- **Node stilllegen (Retire)** — setzt den Node terminal auf *retired* und widerruft dabei
  automatisch alle aktiven Credentials.

Beide Aktionen fragen vorher über einen **Bestätigungsdialog** mit klarer Folgenwarnung nach.
Viewer/Nicht-Admins sehen den Status, können aber keine Schreibaktionen ausführen.

---

## Audit-Log & Export {#audit-log--export}

Das **Audit-Log** (`/audit`) protokolliert alle sicherheitsrelevanten Aktionen
(append-only, also nachträglich nicht änderbar): wer hat was wann an welcher Ressource getan.

### Suchen & filtern

- Nach **Aktion** (z. B. Login, Ticket-Update, Rollenänderung)
- Nach **Akteur** (welcher Benutzer)
- Nach **Ressource**
- Freitext-Suche

### Export (CSV / PDF)

Oben im Audit-Log findest du das Button-Paar **CSV-Export** und **PDF-Export**. Exportiert wird
jeweils die aktuell gefilterte/durchsuchte Auswahl (Anzahl gedeckelt).

- **CSV-Export** — für Excel/Tabellen (UTF-8 mit BOM, gegen Formel-Injektion abgesichert)
- **PDF-Export** — paginiertes A4-Quer-Layout mit Kopfzeile und Erstellungs-Zeitstempel

---

## Benachrichtigungskanäle {#benachrichtigungskanäle}

Nexora kann Ausgangs-Benachrichtigungen (z. B. zu neuen kritischen Incidents) über mehrere
Kanäle versenden. Die Konfiguration der Ziele (URLs, Zugangsdaten) erfolgt durch den Betreiber
über Umgebungsvariablen — sie werden nie in der Oberfläche angezeigt.

> **Nach Aktivierung durch den Betreiber verfügbar.** Standardmäßig ist der Ausgangs-Versand
> deaktiviert.

Verfügbare Kanäle:

| Kanal | Beschreibung |
|---|---|
| **Slack** | Nachricht in einen Slack-Channel (Incoming Webhook) |
| **Microsoft Teams** | Nachricht in einen Teams-Channel |
| **E-Mail (SMTP)** | E-Mail an eine konfigurierte Adresse |
| **Webhook (generisch)** | POST an eine beliebige HTTP-Endpunkt-URL |

In den Einstellungen zeigt Nexora je Kanal nur an, **ob** er konfiguriert/aktiv ist
(„aktiv" / „konfiguriert" / „nicht konfiguriert") — niemals die hinterlegte URL oder
Zugangsdaten.

---

## Einstellungen

> **Profil-Self-Service** (Sprache, MFA, API-Token) ist in einem eigenen Abschnitt
> beschrieben: [Profil & Self-Service](#profil--self-service-sprache-mfa-api-token).

### System-Einstellungen

**Admin-Zugriff erforderlich**

Gehe zu **⚙️ Einstellungen** → **System**:

**Benutzerverwaltung:**
- Neue Benutzer hinzufügen
- Passwort zurücksetzen
- Rollen ändern
- Benutzer löschen

**Integration-Settings:**
- Wazuh-Verbindung prüfen
- Webhook-Secret anzeigen
- Integrations-Status

**LLM-Settings:**
- KI-Provider (Ollama, Stub, OpenAI)
- Modell-Name
- Ollama-URL

**Sicherheit (Tab „Sicherheit"):**
- **MFA-Pflicht** (org-weit) ein-/ausschalten (siehe [MFA](#zwei-faktor-authentifizierung-mfatotp))
- Account-Lockout (max. Fehlversuche, Sperrdauer)
- Passwort-Regeln (Ablauf, Wiederverwendungssperre)
- Inaktivitäts-Timeout, Mehrfach-Sitzungen-Limit
- TLS erzwingen, IP-Allowlist

**Benachrichtigungen (Tab „Benachrichtigungen"):**
- Status der Ausgangs-Kanäle (Slack / Teams / E-Mail / Webhook) — nur Anzeige, ob
  konfiguriert/aktiv (siehe [Benachrichtigungskanäle](#benachrichtigungskanäle))

### API-Keys (für Integrations-Webhooks)

Hiervon zu unterscheiden sind die **persönlichen API-Token (PAT)** für deinen eigenen Account —
siehe [Profil & Self-Service](#profil--self-service-sprache-mfa-api-token). Die folgenden
API-Keys dienen der Anbindung von Integrationen (z. B. Wazuh-Webhook):

1. Gehe zu **⚙️ Einstellungen** → **API**
2. Erstelle einen neuen Key:
   - Name: `Wazuh Integration`
   - Scope: `webhooks`
   - TTL: `90 Tage`
3. Kopiere den Key
4. Nutze ihn beim Wazuh-Webhook-Setup:
   ```
   POST https://nexora.example/api/v1/integrations/wazuh
   Header: Authorization: Bearer <API_KEY>
   ```

---

## Profil & Self-Service (Sprache, MFA, API-Token) {#profil--self-service-sprache-mfa-api-token}

Deine persönlichen Einstellungen verwaltest du auf der **Profil**-Seite (Klick auf dein
Profilfoto oben rechts → **Profil**). Diese Self-Service-Funktionen stehen **allen Rollen** zur
Verfügung — du musst kein Admin sein, um deine eigene Sicherheit zu verwalten.

### Persönliche Daten & Anzeige

- **Anzeigename** ändern
- **Passwort** ändern (mit altem Passwort bestätigen, mind. 8 Zeichen)
- **Sprache** (Deutsch / Englisch) — wird dauerhaft gespeichert
- **Datumsformat** — wird dauerhaft gespeichert

### Zwei-Faktor-Authentifizierung (MFA)

Die Karte **Zwei-Faktor-Authentifizierung** erlaubt dir, MFA selbst einzurichten oder zu
verwalten. Die vollständige Anleitung (QR-Code, Recovery-Codes) findest du im Abschnitt
[Zwei-Faktor-Authentifizierung](#zwei-faktor-authentifizierung-mfatotp).

> Diese Karte erscheint, wenn der Betreiber MFA freigeschaltet hat.

### Persönliche API-Token (PAT)

*Live, sofern der Betreiber Personal Access Tokens freigeschaltet hat.*

Mit einem persönlichen API-Token kannst du die Nexora-API programmatisch unter **deinem** Konto
ansprechen (z. B. für Skripte), ohne Benutzername/Passwort zu hinterlegen.

**Token erstellen:**

1. Öffne auf der **Profil**-Seite die Karte **API-Token**
2. Klick **Neues Token**
3. Vergib einen sprechenden Namen (z. B. `Mein Auswertungs-Skript`)
4. Der Token wird **einmalig** angezeigt — kopiere ihn sofort an einen sicheren Ort

> **Wichtig:** Wie bei allen Secrets zeigt Nexora den Token nur **ein einziges Mal**. Danach ist
> er nicht mehr einsehbar. Geht er verloren, widerrufe ihn und erstelle einen neuen.

**Token widerrufen:**

1. Öffne die Karte **API-Token**
2. Klick beim betreffenden Token auf **Widerrufen**
3. Bestätige im Dialog — der Token ist sofort ungültig

### Passkey (WebAuthn)

*Nach Aktivierung durch den Betreiber verfügbar.* Hat der Betreiber WebAuthn eingeschaltet,
findest du auf der Profil-Seite eine Karte zum **Hinzufügen, Auflisten und Löschen von
Passkeys**. Damit kannst du dich anschließend ohne Passwort anmelden (siehe
[Anmeldung mit Passkey](#anmeldung-mit-passkey-webauthn--fido2)).

### Bestätigungsdialoge

Sicherheitsrelevante oder unumkehrbare Aktionen (z. B. Ticket löschen, Credential widerrufen,
Node stilllegen, Passwort zurücksetzen) fragen vorher über einen **Bestätigungsdialog** nach.
Der Dialog beschreibt die Folge der Aktion; mit **Escape** oder **Abbrechen** brichst du ab.
Bei länger laufenden Aktionen bleibt der Dialog sichtbar und zeigt einen eventuellen Fehler
direkt an.

---

## FAQ

### F: Mein Passwort habe ich vergessen. Wie kann ich es zurücksetzen?

**A:** Kontaktiere einen Admin. Der Admin kann in **Einstellungen → Benutzerverwaltung** dein Passwort zurücksetzen.

---

### F: Ich habe mein Handy / meine Authenticator-App verloren. Wie komme ich rein?

**A:** Nutze beim Login statt des 6-stelligen Codes einen deiner **Recovery-Codes** (jeder Code
funktioniert genau einmal). Hast du auch keine Recovery-Codes mehr, kontaktiere einen Admin —
er kann deine MFA zurücksetzen.

---

### F: Warum sehe ich keine neuen Alerts?

**A:** Prüfe:
1. Ist das **Wazuh-System online**? (→ Dashboard, Health-Check)
2. Ist der **Webhook konfiguriert**? (Wazuh Manager → Integration)
3. Ist die **Webhook-URL** korrekt? (`https://nexora.example/api/v1/integrations/wazuh`)

---

### F: Kann ich den KI-Agent deaktivieren?

**A:** Ja. Admin kann in **Einstellungen → System → LLM** den Provider auf `Stub` setzen. Dann liefert der Agent keine Vorschläge, sondern nur Platzhalter.

---

### F: Wie lange läuft eine Hunt?

**A:** Abhängig von:
- **Hunt-Typ** (PowerShell: ~30 Sek., Lateral Movement: ~2 Min.)
- **Host-Anzahl** (1 Host: schnell, 100 Hosts: längere)
- **Zeitbereich** (24h: schnell, 90 Tage: slow)

Typisch: **1–5 Minuten**.

---

### F: Kann ich Tickets löschen?

**A:** Nur Admins können Tickets löschen. Geschlossene Tickets können nicht gelöscht werden (Audit-Trail!). Stattdessen schließen mit `close_reason=sonstiges`.

---

### F: Gibt es einen Dark Mode?

**A:** Ja! Klick auf das **Theme-Toggle** (Mond-Icon) oben rechts im Header.

---

### F: Wie exportiere ich einen Report?

**A:** Zwei Wege:
1. **Schnell-Export:** Ticket öffnen → **⋮ → Als PDF exportieren** (Ticket-ID, Evidence, History).
2. **Report-Tab:** Ticket öffnen → Tab **Report** → **Incident-Report (PDF)** (technisch) oder
   **Kunden-Report (PDF)** (nicht-technisch, ohne IPs/MITRE/IOCs). Siehe
   [Reports](#reports-incident--kunden-report).

---

### F: Ist Nexora „NIS2-konform" / zertifiziert?

**A:** Nein — und das behauptet Nexora bewusst nicht. Die NIS2-Seite ist eine **Arbeits- und
Nachweis-Unterstützung**: Sie hilft dir, den Stand der Maßnahmen zu dokumentieren und Belege zu
sammeln. Sie ist **kein Konformitätsnachweis, keine Zertifizierung und kein Rechtsgutachten**.
Siehe [Compliance — NIS2-Readiness](#compliance--nis2-readiness).

---

### F: Warum sehe ich die Provisioning-Seite nicht?

**A:** Die Provisioning-Registry ist **nur für Admins** sichtbar und bedienbar. Als Analyst,
Engineer oder Viewer hast du keinen Zugriff.

---

### F: Verändert Provisioning meine Nodes / mein Netzwerk?

**A:** Nein. Über Provisioning werden **keine** ausführbaren Befehle gesendet und **keine**
Netzwerk-/Firewall-Einstellungen geändert. Nodes melden sich nur (Heartbeat) und erhalten
ausschließlich Status-Informationen zurück.

---

### F: Wo kann ich MFA oder ein API-Token für mich selbst einrichten?

**A:** Auf der **Profil**-Seite — das geht für **alle Rollen**, nicht nur für Admins. Siehe
[Profil & Self-Service](#profil--self-service-sprache-mfa-api-token).

---

### F: Was ist der Unterschied zwischen State und Status?

**A:**
- **State** (Zustand): OPEN oder CLOSED (Lebenszyklus)
- **Status** (Workflow-Stufe): assigned, in_progress, on_hold, awaiting_customer (nur wenn OPEN)

Beispiel:
- Ticket ist OPEN und in Status `in_progress` → Ich bin gerade dran
- Ticket ist CLOSED mit `close_reason=false_positive` → Erledigt, war falsch

---

### F: Kann ich mehrere Tickets auf einmal bearbeiten?

**A:** Noch nicht. Aktuell musst du Tickets einzeln öffnen. Batch-Operationen sind geplant für eine zukünftige Version.

---

### F: Wie viele Hosts können in einer Hunt durchsucht werden?

**A:** Unbegrenzt, aber praktisch:
- **< 20 Hosts:** < 1 Minute
- **50 Hosts:** ~ 2–3 Minuten
- **100+ Hosts:** 5–10 Minuten

Bei sehr großen Hostgruppen wird empfohlen, Host-Filter zu setzen.

---

### F: Kann der KI-Agent Tickets automatisch schließen?

**A:** Nein. Der Agent macht nur Vorschläge, die du genehmigst oder ablehnst. Du entscheidest, ob ein Ticket geschlossen wird.

---

## Support & Feedback

- **Bug-Report:** Kontaktiere den Security Engineering Team
- **Feature-Request:** GitHub Issues
- **Dokumentation:** Siehe `/docs` im Repo
- **Training:** Sprich dich mit deinem SOC Lead ab

---

**Viel Erfolg beim Analyzing!** 🔍
