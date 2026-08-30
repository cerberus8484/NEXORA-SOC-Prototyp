# Threat Hunts (`/threat-hunts`)

## Zweck
Zentrale Konsole für SOC-Analysten zum Durchführen, Überwachen und Verwalten von Threat-Hunting-Sessionen. Analysten können vorgefertigte Hunts starten, Live-Konsolenausgaben verfolgen, Findings dokumentieren, Evidence sammeln und Tickets erstellen.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst` (minRole)  
**Sichtbar in:** Hauptnavigation unter "Threat Hunts"

## Funktionen

- **Hunt-Katalog-Übersicht:** Bei leerer Auswahl zeigt die Seite einen Katalog vorgefertigter Hunts (Persistence, Lateral Movement, Execution, Network, Exfiltration, Defense Evasion) mit One-Click-Launch
- **Session-Auswahl (Linkes Panel):** Gefilterte Liste laufender, abgeschlossener und geplanter Hunt-Sessionen; Auto-Auswahl der ersten laufenden Session
- **Search & Filter:** Nach Session-Name, Target-Host, Scope, Status (Active/Completed/Draft/Failed/Cancelled) oder Hunt-Typ
- **Subnavigation:** Tabs für Overview, Console, Findings, Timeline, Commands, Targets, Evidence, Tickets, Response-Aktionen, Export
- **Overview-Tab:** KPI-Zeilen (Total Events, Findings, High Severity, Affected Hosts, Data Sources) + Hunt Summary + letzte 5 Findings
- **Console-Tab:** Live-Logs mit Level-Färbung (info/warning/error/success), Pause- und Stop-Buttons (Stop nur für Admins), Export Log, Vollansicht
- **Findings-Tab:** Sortierbare Tabelle mit Schweregrad, Titel, Host, User/IP, Quelle, Status; CSV-Export; Finding-Detail-Panel rechts mit MITRE-Kontext, Verdict-Tracking und Actions
- **Timeline-Tab:** Chronologische Ereigniskette (Logs + Findings + Commands) mit Farb-Dots
- **Commands-Tab:** Safe Command Console mit Whitelist (whoami, hostname, tasklist, netstat, ipconfig, Get-Process, Get-Service); nur Read-Only
- **Targets-Tab:** Betroffene Hosts mit Primary-Target-Kennzeichnung und RDP-Datei-Export
- **Evidence-Tab:** Gesammelte Artifacts (Typ, Wert, Quelle); Verweis auf Evidence Center
- **Tickets-Tab:** Verknüpfte Tickets (Linked At, Ticket-ID, Quelle, Summary)
- **Response-Aktionen:** Approval-Gate für sensitive Aktionen (Vier-Augen) + menschlich ausgelöste Host-Isolation (ADR-042, Reauth) — siehe [Response-Aktionen / Containment](#response-aktionen-containment-adr-042)
- **Export:** Findings Report (MD), CSV, Evidence Bundle (JSON), Console Log (TXT)
- **Findings-Details-Panel:** MITRE-Mapping, Recommendation, Verdict (Analyst-Urteil), Create Ticket, Add Evidence, Run Follow-Up Hunt, RDP-Verbindung

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `GET /hunts/catalog` | Verfügbare Hunt-Typen + Metadaten |
| `GET /hunts` | Alle Hunt-Sessionen des Analysten |
| `GET /hunts/{id}` | Einzelne Session + Metadaten |
| `POST /hunts` | Neue Hunt-Session anlegen |
| `POST /hunts/{id}/start` | Hunt starten |
| `POST /hunts/{id}/pause` | Hunt pausieren (MVP: nicht unterstützt) |
| `POST /hunts/{id}/cancel` | Hunt abbrechen (nur Admin) |
| `POST /hunts/{id}/complete` | Hunt manuell beenden |
| `GET /hunts/{id}/logs` | Alle Live-Console-Zeilen |
| `POST /hunts/{id}/run-command` | Safe Command ausführen |
| `GET /hunts/{id}/findings` | Gefundene Detektionen |
| `POST /hunts/{id}/findings` | Neues Finding hinzufügen |
| `POST /hunts/{id}/findings/{fid}/create-ticket` | Finding → Ticket |
| `POST /hunts/{id}/findings/{fid}/add-evidence` | Finding → Evidence Center |
| `POST /hunts/{id}/findings/{fid}/verdict` | Analyst-Urteil setzen |
| `GET /hunts/{id}/commands` | Ausgeführte Commands |
| `GET /hunts/{id}/artifacts` | Gesammelte Artifacts |
| `GET /hunts/{id}/ticket-links` | Verknüpfte Tickets |
| `GET /hunts/{id}/response-actions` | Approval-Gate-Anfragen |
| `POST /hunts/{id}/response-actions` | Response-Aktion anfordern |
| `POST /hunts/{id}/response-actions/{aid}/approve` | Aktion genehmigen |
| `POST /hunts/{id}/response-actions/{aid}/reject` | Aktion ablehnen |
| `POST /hunts/{id}/response-actions/{aid}/execute` | Genehmigte Aktion ausführen (Admin + Reauth, ADR-042) |
| `GET /hunts/response-circuit` | Zustand des Containment-Kanals (Circuit-Breaker) |
| `POST /hunts/response-circuit/reset` | Kanal nach wiederholten Fehlern entsperren (Admin) |
| `GET /hunts/{id}/notes` | Hunt-Notizen (append-only) |
| `POST /hunts/{id}/notes` | Notiz hinzufügen |

**Implementierungsdetail:** API-Aufrufe via `huntApi` aus `frontend/src/features/hunts/huntApi.ts`.

## Response-Aktionen / Containment (ADR-042)

Nexora kann kompromittierte, **verwaltete** Hosts isolieren — **nie automatisch**, immer von Menschen
getragen. Der Ablauf im Panel „Response-Aktionen":

1. **Anfragen** (Analyst): `Host isolieren` bzw. `Isolation aufheben` für den Ziel-Host anfordern (mit Begründung).
2. **Genehmigen** (zweiter Mensch, Admin/Engineer ≠ Anforderer): mit dokumentierter **Rechtsgrundlage**
   (Betriebsrat-Zustimmung / Notfall-Freigabe) freigeben — **Vier-Augen-Prinzip**.
3. **Ausführen** (Admin ≠ Anforderer): in der Section „Bereit zur Ausführung" das **Passwort bestätigen**
   (frische Reauth) und `Ausführen` klicken. Der Button ist ohne Passwort deaktiviert; die eigene Anfrage kann
   man nicht selbst ausführen (**Drei-Parteien-Trennung**, mind. 2 verschiedene Personen).

**Was passiert technisch:** Nur `isolate_host`/`release_isolation` (umkehrbar) sind real ausführbar. Die
Isolation läuft per SSH auf dem Ziel-Host (Linux: nftables · Windows: Windows-Firewall) und hält dabei den
**Management-Kanal offen** (sonst wäre die Freigabe nicht mehr zustellbar). `privileged_command` bleibt UI-only
(kein Real-Exec).

**Standardmäßig inaktiv:** Der echte Kanal ist per Kill-Switch (`HUNT_RESPONSE_REAL_EXEC_ENABLED`) **aus**;
ohne Scharfschaltung + Deploy-Keypair + Mgmt-CIDR passiert nichts. Das Scharfschalten ist ein Operator-Schritt
(→ Containment-Runbook, Betriebshandbuch).

**Circuit-Breaker:** Nach wiederholten fehlgeschlagenen Ausführungen sperrt sich der Kanal automatisch. Admins
sehen dann oben im Panel einen Warnbanner **„Containment-Kanal gesperrt"** mit **Entsperren**-Button (nach
Ursachenprüfung). Ein erfolgreicher Lauf setzt den Fehlerzähler zurück.

**Fehlermeldungen (Auswahl):** „nicht scharfgeschaltet" (Kanal aus) · „Reauth erforderlich" (Passwort erneut) ·
„Ausführender darf nicht der Anforderer sein" (anderer Admin) · „Host ist kein aktiver managed Node" (nicht
enrollt). Vollständige Liste im Containment-Runbook.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- **HuntConsole** (`/threat-hunts/{id}`) — Klick auf Session oder Subnavigation-Tabs
- **HuntLibrary** (`/hunt-library`) — Quick-Launch-Katalog, wenn keine Session aktiv
- **Analysis** (`/analysis`) — Verknüpfte Findings können zur Workbench gehen
- **Tickets** (`/tickets`) — Verknüpfte Tickets in der Tabelle anklickbar
- **Evidence Center** (`/evidence`) — Link in der Evidence-Tab

**Empfängt von:**
- **Ticket** (`/tickets/{id}`) — kann Hunt-Session starten (Follow-Up aus Ticket)
- **Analysis** (`/analysis`) — kann Findings aus Hunt verknüpfen

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt** | Spinner, während Sessions abgerufen werden |
| **Keine Sessions** | Leerer Zustand mit Hunt-Katalog-Übersicht |
| **Session aktiv** | Alle Tabs verfügbar; KPIs + Findings aktuell |
| **Session beendet** | Read-Only; kein neuer Input möglich |
| **Fehler beim Laden** | ErrorCard mit Fehlermeldung |
| **Findings leer** | Platzhalter-Text in Findings-Tab |
| **Commands nicht ausgeführt** | Leere Console im Commands-Tab |
| **Evidence nicht angelegt** | Platzhalter in Evidence-Tab |

**Mock-Hinweis:** Hunt-Execution erfolgt deterministisch; keine echten Remote-Commands. Console zeigt echte Backend-Logs.

**Toast-Meldungen:** Erfolgreiche Aktion (Ticket erstellt, Evidence angelegt), Fehler, Bestätigungen.
