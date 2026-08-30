# Settings (`/settings`)

## Zweck
Zentrale Plattform-Konfigurationsseite mit 11 Tabs für Admin und Analyst Einstellungen (Allgemein, Benutzer, Integrationen, Sicherheit, API, Benachrichtigungen, Speicherung, Branding, Threat Hunting, Audit, KI). Die Settings-Seite ist Multi-Tab, teilweise rollenbasiert (z. B. Sicherheit nur für Admin), und steuert das ganze System aus einer Oberfläche.

## Rolle & Sichtbarkeit
**Mindest-Rolle:** analyst (Lese-Zugriff), admin (Bearbeitung)  
**Nav-Gruppe:** Benutzer-Profil (Menü oben rechts) oder System  
**Tab-Sichtbarkeit:** Rollenbasiert via `hasRole(role, minRole)`  

## Funktionen

### Header
- **Titel:** „Systemeinstellungen"
- **Untertitel:** „Konfigurieren Sie Ihre SOC-Plattform…"
- **Export-Button:** Disabled (geplant), Tooltip erklärt das

### Tab Bar
- 11 Tabs mit Icons + Labels (horizontal scrollbar bei schmalem Viewport)
- Nur für Rolle sichtbare Tabs anzeigen
- Click wechselt Tab

| Tab | Icon | Min. Rolle | Enthält |
|-----|------|-----------|---------|
| Allgemein | Server | none | Plattform-Name, Zeitzone, Sprache, Default-Ansicht, Wartungsmodus, Beta-Features, Lizenz & Nutzung |
| Benutzer & Rollen | Users | admin | UsersPanel (Benutzer-CRUD, RBAC) |
| Integrationen | Link2 | admin | IntegrationsPanel (verfügbare Quellen: Wazuh, QRadar, Splunk, …) |
| Sicherheit | Shield | admin | SecurityTab (Passwort, Lockout, TLS, IP-Allowlist, MFA-Pflicht, OIDC, Security-Score) |
| API / Webhooks | Webhook | admin | ApiWebhooksPanel (Token, Webhook-Registrierung) |
| Benachrichtigungen | Bell | admin | NotificationsPanel (E-Mail, Slack, etc.) |
| Speicherung & Retention | Database | admin | StorageRetentionPanel (Backup, Retention-Policies, Datenbankgröße) |
| Branding / Thema | Palette | admin | BrandingPanel (Logo, Farben, Theme Dark/Light) |
| Threat Hunting | Target | analyst | ThreatHuntingPanel (Hunt-Konfiguration) |
| Audit & Compliance | FileCheck | analyst | AuditCompliancePanel (Audit-Log-Einstellungen, Compliance-Reports) |
| KI-Einstellungen | Bot | admin | KiTab (LLM-Provider, RAG, parallel wie in `/ki-agent`) |

### Tab: Allgemein (General)

#### System-Status (KPI-Reihe)
- **4 Tiles:** API-Status | Datenbank | Version | Uptime
- Icons + Status-Badge + Farbe

#### Plattform-Informationen (2-Spalten Grid)
- Plattformname (Text, Admin bearbeitbar)
- Zeitzone (Select: Europe/Berlin, UTC, US/Eastern, …)
- Sprache (Select: Deutsch, English)
- Standard-Ansicht (Select: Dashboard, Tickets, Threat Hunts)
- Wartungsmodus (Toggle)
- Feature-Vorschau aktivieren (Toggle)
- **Save-Button:** Speichert alle Änderungen, Toast auf Erfolg/Fehler

#### Verwandte Einstellungen (Info-Karte)
- **Hinweis:** Wo wird was konfiguriert?
- Cross-Reference zu anderen Tabs (z. B. „Passwort & Sitzung → Tab Sicherheit")

#### Lizenz & Nutzung (Rechts-Spalte, Karte)
- Edition: Badge „Community"
- Lizenzstatus: Badge „Aktiv"
- Gültig bis: „Open Source"
- **Nutzung:**
  - Benutzer: Zahl aus DB
  - Datensätze gesamt: Summe aus DB
  - Datenbankgröße: formatBytes()
  - Hinweis: Echte Werte aus DB, keine Nutzer-/Speichergrenze in Community

### Tab: Sicherheit (Security)

#### Security Posture Cards (oben)
- KPI-Reihe mit Security-Bewertung (live aus Einstellungen)
- z. B. Score, Posture-Level (Basic / Enhanced / Advanced)

#### Spalte 1: Passwort & Sitzung

**Passwort- und Sitzungsrichtlinie:**
- Min. Passwortlänge (Zahl, 8–128)
- Komplexität (Select: Niedrig | Mittel | Hoch)
- Max. Sitzungsdauer (Stunden, 1–168)
- History-Sperre (Anzahl, 0 = aus)
- Ablauf (Tage, 0 = aus)
- Max. Sitzungen / Nutzer (0 = unbegrenzt)
- Inaktivität-Timeout (Min, 0 = aus)
- **Info-Box:** „Serverseitig erzwungen"
- **Save-Button**

**Anmelde-Sicherheit (Account-Lockout):**
- Max. Fehlversuche (Zahl, 0 = deaktiviert)
- Sperrdauer (Min, 1–1440)
- Erklärtext: wenn 0, Lockout aus; sonst erklärt die Wirkung
- **Geplant:** CAPTCHA, Benachrichtigung bei Sperrung

#### Spalte 2: Zugriffskontrolle & Standards

**Zugriffskontrolle:**
- TLS erzwingen (Toggle)
- IP-Allowlist (Toggle + optionales Textarea für CIDRs, comma-separated)
- MFA-Pflicht (Toggle) — Greift, wenn MFA_ENABLED serverseitig aktiv
- **Geplant:** WebAuthn / Hardware-Keys
- **Save-Button**

**Security-Standards & Compliance (Info-Karte):**
- Read-Only Übersicht (NIST 800-63B, CIS Controls, OWASP ASVS)
- Orientierungswerte, keine Zertifizierung

**OIDC-Einstellungen (OidcSettingsCard):**
- Issuer-URL
- Client-ID
- Client-Secret (Passwort-Feld)
- Scope (Text)
- Toggle „OIDC aktiv"
- **Save-Button**

#### Spalte 3: Security-Score, Events, MFA, Passwort ändern

**Security-Score-Card:**
- Live-Berechnung aus Einstellungen
- Score (0–100)
- Posture-Level (Basic / Enhanced / Advanced)
- Trend (optional)

**Security-Events-Feed:**
- Letzte 10 Sicherheitsereignisse (Login, Config-Änderung, Failed-Auth, …)
- Zeitstempel + Ereignis-Typ

**MFA-Security-Card:**
- Org-MFA-Anforderung Status
- Enrollment-Status pro Benutzer (optional)
- Toggle „MFA-Pflicht für alle"

**Passwort ändern (ChangePasswordCard):**
- Aktuelles Passwort (Feld)
- Neues Passwort (Feld)
- Bestätigung (Feld)
- Hinweis: Letzte Passwortänderung nicht getrackt (— serverseitig)
- **Ändern-Button**
- Toast auf Erfolg/Fehler

### Tab: KI-Einstellungen (Ki)

**2-Spalten Layout:**
- **KiSettingsCard (Links):** Provider, Modell, Base-URL, API-Key (gleich wie `/ki-agent`)
- **RagCard (Rechts):** Qdrant-Status, Collections (gleich wie `/ki-agent`)

(Siehe auch `/ki-agent`-Seite für Details — Duplikat hier für Convenience)

### Weitere Tabs (Kurzbeschreibung)

- **Benutzer & Rollen:** UsersPanel — CRUD für Benutzer, Rollenzuweisung, RBAC-Matrix
- **Integrationen:** IntegrationsPanel — Verfügbare SIEM/Log-Quellen (Wazuh, QRadar, Splunk), Verbindungsstatus, Konfiguration
- **API / Webhooks:** ApiWebhooksPanel — API-Token generieren, Webhooks registrieren, Secrets verwalten
- **Benachrichtigungen:** NotificationsPanel — E-Mail-Config, Slack-Integration, Alert-Policies
- **Speicherung & Retention:** StorageRetentionPanel — Backup-Status, Retention-Policies (z. B. Tickets nach 90d löschen), DB-Größe
- **Branding / Thema:** BrandingPanel — Logo, Akzentfarben, Dark/Light-Mode-Standardwert
- **Threat Hunting:** ThreatHuntingPanel — Hunt-Grenzen, Modul-Konfiguration, GeoIP-Db-Update
- **Audit & Compliance:** AuditCompliancePanel — Audit-Log-Retention, Compliance-Export

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| Platform-Einstellungen laden | `GET /api/v1/settings/platform` | getPlatform() |
| Platform-Einstellungen speichern | `PUT /api/v1/settings/platform` | savePlatform() |
| System-Health | `GET /health` | api.get() |
| System-Statistiken | `GET /api/v1/system/stats` | systemApi.stats() |
| Passwort ändern | `POST /api/v1/auth/change-password` | authApi.changePassword() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** Menü (Zahnrad oder Benutzer-Profil)
- **Empfängt von:** Alle Seiten — Settings steuert globale Konfiguration
- **Beeinflusst:** Dashboard, Tickets, Hunt, Analysis (z. B. Theme, Sprache, Integrationen)

## Zustände

### Laden
- Spinner beim initialen Load von Platform-Settings + Health
- Pro Tab separate Spinner falls Sub-Panels async laden

### Fehler
- 403 Forbidden: Nicht-Admin sieht Admin-only Tabs nicht (Gate funktioniert)
- API-Fehler: ErrorCard + Fehlermeldung
- Speichern fehlgeschlagen: Error-Nachricht inline + Toast

### Speichern
- Button wechselt zu „Wird gespeichert…" + disabled
- Bei Erfolg: Button grün „✓ Gespeichert" (2.5s), dann zurück zu Normal
- Bei Fehler: Button rot / Error-Nachricht, 3s timeout dann zurück

## Besonderheiten

1. **Multi-Tab:** 11 Tabs mit rollenbasierter Sichtbarkeit
2. **Keine Export-Funktion:** Noch nicht implementiert (Button disabled mit Tooltip)
3. **Ehrliche Lizenzen:** Community-Edition, keine künstliche Nutzungs-Grenze
4. **Security-Score Live:** Berechnet sich aus echten Einstellungen, nicht hardcoded
5. **Passwort-Tracking:** Serverseitig nicht getrackt — Dashboard zeigt „—"
6. **Duplikat KI-Tab:** KiSettingsCard + RagCard sind identisch wie auf `/ki-agent` (Code-Reuse)
7. **Duplikat OIDC:** OidcSettingsCard auch auf Security-Tab sichtbar
8. **Verwandte Einstellungen:** Kreuzreferenzen zeigen, welche Config wo liegt (Honesty-Rule)

## Häufige Workflows

### Admin-Onboarding
1. Allgemein Tab: Plattformname, Zeitzone, Sprache einstellen
2. Sicherheit Tab: Passwort-Komplexität, MFA-Pflicht aktivieren
3. Integrationen Tab: Wazuh, QRadar verbinden
4. KI-Einstellungen Tab: LLM-Provider konfigurieren

### Security-Audit
1. Sicherheit Tab: Security-Score und Posture checken
2. Events-Feed: Letzte Änderungen überprüfen
3. Benutzer Tab: Aktive Admin-Konten zählen
4. Audit Tab: Audit-Log-Einstellungen validieren

### Benutzer hinzufügen
1. Benutzer & Rollen Tab
2. Klick „Benutzer hinzufügen"
3. Email, Rolle, Initiales Passwort setzen
4. Speichern → Toast

### Passwort ändern (eigenes Konto)
1. Sicherheit Tab, Sektion „Eigenes Passwort ändern"
2. Aktuelles + neues Passwort eingeben
3. Klick „Passwort ändern"
4. Toast „Passwort geändert ✓"
