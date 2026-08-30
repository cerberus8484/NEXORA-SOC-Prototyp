# Verbindungssicherheit — Inter-Service Security Plan

> Gültig für alle Verbindungen zwischen Komponenten des SOC Ticket Tool Ökosystems.
> Kein System spricht ungesichert mit einem anderen.

---

## 1. Übersicht aller Verbindungen

```
Internet / Externe Systeme
    │
    ▼ HTTPS 443 (nginx, TLS-Terminierung)
┌───────────────────────────────────────────┐
│            SOC VLAN (intern)              │
│                                           │
│  Browser (Analyst)                        │
│      │ HTTPS + JWT                        │
│      ▼                                    │
│  nginx (Reverse Proxy + TLS)              │
│      │ HTTP (intern, localhost only)      │
│      ▼                                    │
│  Backend API (Node.js :3000)              │
│      │ SSL + User/Pass                    │
│      ├──► PostgreSQL (:5432)             │
│      │ pg-boss (in PostgreSQL)            │
│      ├──► Queue/Worker (intern)          │
│      │ HTTPS + API Key                    │
│      ├──► QRadar                         │
│      │ HTTPS + API Key                    │
│      ├──► Splunk                         │
│      │ HTTPS + API Key                    │
│      ├──► ServiceNow                     │
│      │ HTTPS + Service JWT               │
│      ├──► ThreatHunting Tool             │
│      │ HTTPS + Agent JWT                  │
│      └──► KI Agent (Flowise)            │
│                                           │
└───────────────────────────────────────────┘

Eingehende Webhooks:
    QRadar / Splunk / SOAR
        │ HTTPS + HMAC-SHA256 Signature
        ▼
    nginx → Backend /api/v1/webhooks/:system
```

---

## 2. Transport Security (TLS überall)

### Regel
```
Keine unverschlüsselte Verbindung zwischen Systemen.
HTTP ist nur intern zwischen nginx und Backend erlaubt (localhost).
```

### nginx → Backend (intern)
```
✅ HTTP localhost:3000 ist OK
✅ nginx übernimmt TLS-Terminierung
✅ Kein externer Zugriff auf Port 3000 möglich (Firewall-Regel)
```

### Alle anderen Verbindungen
```
✅ TLS 1.2 minimum
✅ TLS 1.3 bevorzugt
✅ Kein SSLv3, kein TLS 1.0/1.1
✅ Zertifikat-Validierung immer aktiv (rejectUnauthorized: true)
✅ HSTS Header: max-age=31536000; includeSubDomains
```

### nginx Konfiguration (Produktion)
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
add_header Strict-Transport-Security "max-age=31536000" always;
```

---

## 3. Frontend → Backend (Analyst)

### Authentifizierung
```
Methode:  JWT (JSON Web Token)
Header:   Authorization: Bearer <token>
Ablauf:   8 Stunden (Arbeitstag)
Refresh:  POST /api/v1/auth/refresh (vor Ablauf)
Logout:   Token-Blocklist in DB (sofort ungültig)
```

### JWT-Sicherheit
```javascript
// Signing: HS256 mit min. 32-Zeichen Secret (aus Env, nie im Code)
// Payload: { sub: userId, role: 'analyst', exp, iat, jti }
// jti (JWT ID) für Blocklist bei Logout

// Prüfungen bei jedem Request:
// ✅ Signatur gültig
// ✅ nicht abgelaufen (exp)
// ✅ nicht in Blocklist (jti)
// ✅ Rolle berechtigt für diesen Endpoint
```

### CORS
```javascript
// Nur interne Origins erlaubt
cors({
  origin: ['https://soc.example.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
})
// Kein Wildcard * in Produktion!
```

### Rate Limiting (pro IP + pro User)
```
Global:      200 Req/min pro IP
Auth-Routes: 10 Login-Versuche/min pro IP (Brute-Force Schutz)
API:         500 Req/min pro authentifiziertem User
```

---

## 4. Backend → PostgreSQL

### Verbindung
```
✅ SSL-Verbindung: ssl: { rejectUnauthorized: true }
✅ Eigener DB-User: soc_api (nur notwendige Rechte)
✅ Kein postgres-Superuser für die App
✅ Port 5432 nur von Backend-Server erreichbar (Firewall)
✅ Passwort nur in .env, niemals im Code oder Git
```

### Minimale DB-Rechte (Principle of Least Privilege)
```sql
-- App-User hat nur was er braucht
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soc_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soc_api;

-- Kein DROP, kein CREATE TABLE, kein ALTER
-- Migrations laufen mit eigenem Migrations-User
```

### Connection Pool
```javascript
// Max Verbindungen begrenzen
pool = new Pool({
  max:             10,
  idleTimeoutMs:   30_000,
  connectionTimeoutMilliseconds: 2_000,
  ssl: { rejectUnauthorized: true },
})
```

### Row-Level Security (RLS) — Phase 6+
```sql
-- Analyst sieht nur eigene Tickets (oder alle wenn teamlead)
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_access ON tickets
  USING (analyst = current_setting('app.current_user')
         OR current_setting('app.user_role') IN ('teamlead', 'admin'));
```

---

## 5. Backend → Externe Systeme (QRadar, Splunk, ServiceNow, OTRS)

### Authentifizierung pro System

| System | Methode | Wo gespeichert |
|---|---|---|
| QRadar | `SEC` Header Token | .env / Vault |
| Splunk | Bearer Token | .env / Vault |
| ServiceNow | OAuth2 Client Credentials | .env / Vault |
| OTRS | API Key Header | .env / Vault |

### Implementierung
```javascript
// ✅ API Keys NIEMALS im Code
// ✅ Immer aus process.env laden
// ✅ TLS-Validierung immer aktiv
// ✅ Timeout pro Request setzen (verhindert hängende Connections)

const response = await axios.get(url, {
  headers: { 'SEC': process.env.QRADAR_API_TOKEN },
  httpsAgent: new https.Agent({ rejectUnauthorized: true }),
  timeout: 10_000,  // 10 Sekunden max
});
```

### Credential Rotation
```
□ API-Keys müssen rotierbar sein ohne Code-Änderung
□ Rotation: neuen Key in .env → Neustart Backend
□ Dokumentieren: welcher Key zu welchem System gehört
□ Ablaufdatum für Keys tracken (falls System es unterstützt)
```

---

## 6. Eingehende Webhooks (QRadar, Splunk, SOAR → Backend)

### Sicherheitsproblem
Externe Systeme schicken Daten zu unserem Backend.
Wir müssen sicherstellen dass die Anfrage wirklich vom richtigen System kommt.

### Lösung: HMAC-SHA256 Signature + Timestamp

#### Webhook-Sender (z.B. QRadar) muss schicken:
```
Header: X-Webhook-Signature: sha256=<HMAC>
Header: X-Webhook-Timestamp: <Unix-Timestamp>
Body:   JSON Payload
```

#### HMAC berechnet sich aus:
```
HMAC-SHA256(key=WEBHOOK_SECRET, message=timestamp + "." + body)
```

#### Backend prüft:
```javascript
function verifyWebhookSignature(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  // 1. Timestamp nicht älter als 5 Minuten (Replay-Schutz)
  const age = Date.now() / 1000 - parseInt(timestamp);
  if (age > 300) throw new Error('Webhook timestamp too old');

  // 2. Signatur prüfen
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${req.rawBody}`)
    .digest('hex');

  // 3. Constant-Time Vergleich (kein Timing-Angriff)
  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )) throw new Error('Invalid webhook signature');
}
```

### IP-Allowlisting (zusätzliche Absicherung)
```javascript
// Webhook-Requests nur von bekannten IPs akzeptieren
const ALLOWED_IPS = {
  qradar:      process.env.QRADAR_IP,
  splunk:      process.env.SPLUNK_IP,
  servicenow:  process.env.SERVICENOW_IP,
};

function checkWebhookSource(system, reqIp) {
  if (reqIp !== ALLOWED_IPS[system]) {
    throw new ForbiddenError(`Unexpected source IP for ${system}`);
  }
}
```

---

## 7. Service-to-Service (ThreatHunting Tool, KI Agent)

### Intern entwickelte Tools: Service Accounts

Jedes interne Tool bekommt einen eigenen Account mit minimalen Rechten:

| Service | Rolle | Darf |
|---|---|---|
| ThreatHunting Tool | `agent` | Evidence POST, Tickets READ |
| KI Agent (Flowise) | `agent` | Tickets READ, Evidence POST, Verdict POST |
| Evidence Collector | `agent` | Evidence POST |
| Monitoring | `viewer` | Health READ, Metrics READ |

### Authentifizierung: Long-lived Service Token
```javascript
// Für Service-to-Service: langlebiger JWT (kein User-Login)
// Erstellt durch Admin einmalig, rotierbar

// Token Payload:
{
  sub:     'threathuning-tool',
  role:    'agent',
  scope:   ['evidence:write', 'tickets:read'],
  exp:     /* 90 Tage */
}
```

### Flowise speziell: Endpoint-Scoping
```
Flowise darf NUR:
  GET  /api/v1/tickets/:id       (Ticket lesen)
  GET  /api/v1/tickets/:id/evidence
  POST /api/v1/tickets/:id/evidence  (Evidence anfügen)
  POST /api/v1/agent/verdict         (Verdict vorschlagen)

Flowise darf NICHT:
  DELETE /api/v1/tickets/:id     (Ticket löschen)
  POST   /api/v1/admin/*         (Admin-Funktionen)
  GET    /api/v1/users           (User-Liste)
```

---

## 8. Secrets Management

### Phase 1 (Jetzt): .env Dateien auf Server

```
✅ .env in .gitignore (niemals committen)
✅ .env.example mit Platzhaltern im Repo
✅ .env nur auf Produktions-VM
✅ Zugriffsrechte: chmod 600 .env
✅ Nur root und App-User können lesen
```

### Phase 2 (Später): HashiCorp Vault oder ähnliches
```
□ Vault-Server intern
□ Backend holt Secrets beim Start
□ Secrets nie auf Disk
□ Automatische Rotation möglich
```

### Was niemals ins Repo darf
```
❌ Passwörter
❌ API Keys
❌ JWT Secrets
❌ TLS Private Keys
❌ Datenbankpasswörter
❌ HMAC Webhook Secrets
```

---

## 9. Netzwerksegmentierung

### Firewall-Regeln (mit IT abstimmen)

| Von | Nach | Port | Erlaubt |
|---|---|---|---|
| Internet | nginx | 443 | ✅ HTTPS |
| Internet | nginx | 80 | ✅ Redirect zu 443 |
| Internet | Backend | 3000 | ❌ Blockiert |
| Internet | PostgreSQL | 5432 | ❌ Blockiert |
| nginx | Backend | 3000 | ✅ Intern |
| Backend | PostgreSQL | 5432 | ✅ Intern |
| Backend | QRadar | 443 | ✅ Ausgehend |
| Backend | Splunk | 8089 | ✅ Ausgehend |
| QRadar | Backend | 443 | ✅ Webhook |
| Analyst | nginx | 443 | ✅ SOC VLAN |
| Andere VLANs | nginx | 443 | ❌ Prüfen |

---

## 10. Audit — was wird geloggt

### Jede Verbindung hinterlässt einen Eintrag:

```javascript
// Pflicht-Log-Felder für alle API-Calls
{
  requestId:   'uuid',          // Traceability
  timestamp:   'ISO8601',
  actor:       'user-id oder service-name',
  action:      'CREATE_TICKET',
  resource:    '/api/v1/tickets/abc123',
  method:      'POST',
  status:      201,
  ip:          '192.168.243.45',
  durationMs:  45,
  // Bei Webhooks zusätzlich:
  source:      'qradar',
  externalId:  'OFF-009134',
}
```

### Kritische Events werden zusätzlich in audit_log Tabelle geschrieben:
```
Login (erfolgreich + fehlgeschlagen)
Logout
Token-Erneuerung
Ticket erstellt / geändert / gelöscht
Status geändert
Benutzer erstellt / gesperrt / Rolle geändert
Webhook empfangen (von welchem System, welche ID)
KI-Agent Aktion (was hat der Agent getan)
Fehler bei externer Verbindung
```

---

## 11. Checkliste — vor Produktivbetrieb

```
Transport:
□ TLS 1.2+ auf allen Verbindungen
□ Kein HTTP außer localhost nginx→backend
□ Zertifikat von interner CA oder vertrauenswürdiger CA
□ HSTS Header aktiv

Authentifizierung:
□ JWT Secret min. 32 Zeichen, aus .env
□ JWT Ablauf 8 Stunden
□ Webhook HMAC-Secret pro System, aus .env
□ DB-User nur Minimalrechte
□ Service-Accounts für interne Tools

Netzwerk:
□ Port 3000 (Backend) von außen blockiert
□ Port 5432 (PostgreSQL) nur Backend
□ Firewall-Regeln dokumentiert und umgesetzt

Secrets:
□ .env in .gitignore
□ .env auf VM: chmod 600
□ Keine Secrets in Logs
□ Keine Secrets in Error-Messages

Monitoring:
□ Fehlgeschlagene Logins werden geloggt und alarmiert
□ Unbekannte Webhook-Signaturen werden geloggt
□ Zertifikat-Ablauf überwacht
□ Rate-Limit-Überschreitungen sichtbar
```

---

## 12. Angriffs-Szenarien und Gegenmaßnahmen

| Angriff | Gegenmaßnahme |
|---|---|
| Gestohlener JWT | Logout → Blocklist, kurze Ablaufzeit (8h) |
| Webhook-Spoofing (falscher Sender) | HMAC Signature + IP-Allowlist |
| Replay-Angriff auf Webhook | Timestamp-Check (max 5min alt) |
| Brute-Force Login | Rate Limit 10/min + Account Lockout |
| SQL Injection | Parameterized Queries (pg library) |
| XSS via Ticket-Daten | escHtml() + CSP (S1 bereits erledigt) |
| Credential Leak via Logs | Niemals Passwörter/Tokens in Logs |
| MITM | TLS überall + rejectUnauthorized: true |
| Insider-Zugriff | RBAC + Audit Trail (wer hat was getan) |
| Flowise macht unerlaubte Aktionen | Scoped JWT + Endpoint-Restriction |


---

## 13. Lokales LLM — Sicherheit

### Grundprinzip
```
Sensitive SOC-Daten werden NIEMALS an externe LLM-APIs gesendet.
Hashes, IOCs, Credentials, Incident-Details → nur lokales Modell.
```

### Netzwerk-Isolation
```
Ollama:  127.0.0.1:11434  (nur localhost)
Qdrant:  127.0.0.1:6333   (nur localhost)
Flowise: hinter nginx, HTTPS, mit Auth
Kein direkter externer Zugriff auf LLM-Ports
```

### Was darf an Cloud-LLM (Ausnahme)
```
✅ Anonymisierte, generische Beschreibungen
✅ "Ein Endpoint zeigt C2-Beaconing-Pattern"
❌ Echte Hashes, IPs, Hostnamen, Credentials
❌ Rohe Incident-Daten
❌ Interne Netzwerk-Topologie
```

### Modell-Integrität
```
SHA256-Verifikation aller heruntergeladenen Modelle
Keine unverifizierten Community-Modelle in Produktion
Modell-Hashes in docs/ dokumentieren
```

### Prompt Injection Schutz
```
Systemkontext: fest vom Backend gesetzt, nicht überschreibbar
Benutzereingaben: sanitized bevor sie in den Prompt gehen
Externe Daten (aus SIEM/Tickets): als Daten markiert, nicht als Instruktion
Output-Länge: begrenzt (max 2000 Token)
```

---

## 14. Authentifizierung — aktueller Stand (Security-Welle 3, Stand 2026-06-20)

> Ergänzt Abschnitt 3. Die ursprüngliche Bearer-im-`sessionStorage`-Beschreibung
> dort ist **historisch** — produktiv läuft Auth heute Cookie-only (ADR-017).

### 14.1 Session & CSRF (Cookie-only + Double-Submit) — LIVE
```
✅ Kein Token im Frontend-Storage (sessionStorage/localStorage) — XSS kann ihn nicht lesen.
✅ Auth läuft über httpOnly-Cookie soc_token (credentials:'include'); /auth/me restauriert die Session.
✅ CSRF Double-Submit: Server setzt JS-lesbares csrf_token-Cookie (sameSite=strict);
   Frontend sendet es bei state-changing Methoden als X-CSRF-Token-Header.
✅ csrfGuard (am v1-Prefix) prüft Gleichheit — NUR für echte Cookie-Sessions.
✅ Ausgenommen (CSRF-immun bzw. anders gesichert): Bearer/PAT, Webhooks (HMAC),
   /auth/login, Safe-Methods.
```
Begründung/Details: ADR-017. Bearer wird für API-Clients/PAT weiterhin akzeptiert.

### 14.2 MFA / TOTP (RFC 6238, ohne externe Lib) — LIVE
```
✅ Zweiter Faktor beim Login (TOTP), Enrollment-Domäne + Login-Challenge.
✅ Einmalige Recovery-Codes (für Geräteverlust).
✅ Org-weite Pflicht via Setting mfaRequired → erzwingt Enrollment beim Login
   (Setup-Token-Flow), bevor die Session voll nutzbar ist.
✅ Routen: /v1/mfa/*, /v1/auth/mfa, /v1/auth/mfa-setup/{begin,complete}.
✅ ENV MFA_ENABLED (default AUS) · Migration 038_mfa_enrollments.
```
Self-Service für **alle** Rollen über ProfilePage (per-User-Flag `mfaEnabled` via
`GET /v1/profile`). Adressiert OWASP A07 (Auth-Failures) / ASVS L2.

### 14.3 WebAuthn / Passkey (FIDO2, @simplewebauthn) — LOKAL (noch nicht deployt)
```
✅ Passwortlose bzw. phishing-resistente Anmeldung über Plattform-/Roaming-Authenticator.
✅ backend/src/auth/webauthn/, Routen /v1/auth/webauthn/* · Migration 040_webauthn_credentials.
✅ ENV WEBAUTHN_* (default AUS). Self-Gating-Card auf ProfilePage + Passkey-Button auf LoginPage.
ℹ️ Ergänzt TOTP-MFA, ersetzt es NICHT. Passwort-Login bleibt parallel verfügbar.
```

### 14.4 Personal Access Tokens (PAT) — LIVE
```
✅ Programmatischer Zugriff (API-Clients) ohne Cookie/CSRF; PAT sind CSRF-immun.
✅ Token nur als Hash gespeichert (nie Klartext); Klartext wird einmalig beim Erzeugen gezeigt.
✅ Routen /v1/tokens · ENV API_TOKENS_ENABLED (default AUS) · Migration 030_api_tokens.
✅ Self-Service auf ProfilePage + Settings-Card; per-User-Flag apiTokensEnabled via GET /v1/profile.
```

### 14.5 SSO / OIDC (Authorization Code + PKCE S256) — LOKAL (noch nicht deployt)
```
✅ backend/src/auth/oidc/ · Routen /v1/auth/oidc/* · ENV OIDC_* (default AUS).
✅ PKCE (RFC 7636, Methode S256) + state + nonce — über Node-Crypto, keine externe Lib.
✅ allowSignup AUS → nur Verknüpfung BESTEHENDER Accounts (kein Auto-Provisioning Fremder).
✅ Default-Rolle für neu verknüpfte Accounts: viewer (least privilege).
✅ Redirect-Ziele sind FEST + intern (kein Open-Redirect über Request-Parameter).
✅ Discovery/Token-Calls mit redirect:'error' (kein 3xx-Folgen → SSRF-Härtung, siehe 18).
✅ Migration 039_user_oidc_link. Passwort-Login bleibt parallel.
```
Details: ADR-023.

---

## 15. Rate-Limiting — aktueller Stand

> Ergänzt Abschnitt 3 („Rate Limiting"). Erzwungen serverseitig.

| Bereich | Granularität | Zweck |
|---|---|---|
| Global | pro IP | Grund-Schutz gegen Last/Abuse |
| Login | pro IP | Brute-Force-Schutz (+ Account-Lockout, ADR-019) |
| Provisioning `/enroll` | pro IP, **nur Fehlversuche** | Token-Bruteforce-Schutz, ohne legitime Nodes zu drosseln |
| Provisioning `/nodes/:id/heartbeat` | pro **nodeId** | Flood-Schutz, **NAT-transparent** (mehrere Nodes hinter einer IP) |
| Provisioning Heartbeat-Auth-Fehler | pro IP | zusätzliche Fehlversuch-Drossel |

`429`-Antworten tragen `standardHeaders` (RateLimit-Reset) + maschinenlesbaren Body,
spiegeln **kein** Secret. Der nodeId-Key beim Heartbeat vermeidet, dass ein Standort
mit vielen Nodes hinter NAT sich selbst aussperrt (Verfügbarkeit vs. Abuse-Schutz).

---

## 16. Provisioning / Control-Plane — No-Apply-Sicherheitsmodell

> Phase-6-Fundament. Architektur-Entscheidung: ADR-020.

```
KERNINVARIANTE: Die Control-Plane hat KEINEN Remote-Command-, Apply- oder
Netzwerk-Konfigurations-Kanal. Sie inventarisiert und überwacht Nodes — sie
steuert sie NICHT fern.
```

### 16.1 Per Test erzwungen (kein bloßes Versprechen)
- `backend/tests/provisioning/provisioningDomain.test.js` scannt alle Domain-Methoden
  gegen eine Forbidden-Regex (`apply|exec|ssh|remote|shell|spawn|network|nat|route|
  firewall|dhcp|sniff`) → CI rot bei jeder Methode, die so etwas auch nur heißt.
- Der Linux-Installer (`deploy/install/`) hat ein eigenes Safety-Gate
  (`installerSafety.test.js`), das jede ausführbare Zeile gegen Netz-/Firewall-/
  Routing-Kommandos prüft (iptables/nft/ufw/nmcli/netplan/`ip addr|link|route`/
  tcpdump/wazuh/opnsense …) → CI rot bei Verstoß.

### 16.2 Server-Antwort enthält nie ausführbare Befehle
```
Heartbeat-Antwort = { accepted, serverTime, desiredProfileId }
→ keine Commands, kein Code, kein Apply-Trigger. Der Node entscheidet selbst,
  der Server gibt nur einen deklarativen Zielzustand bekannt.
```

### 16.3 Token-/Credential-Handhabung (Hash-only, einmaliger Klartext)
| Secret | Format | Speicherung | Klartext |
|---|---|---|---|
| Enrollment-Token | `enr_` + 64 hex | nur SHA-256-Hash | **einmalig** bei Mint |
| Node-Credential | `ncr_` (256-bit) | nur SHA-256-Hash | **einmalig** bei Enroll |
```
✅ Enroll ist single-use: consume-vor-mint (CAS) → kein Doppel-Credential bei Parallel-Enroll.
✅ Heartbeat NUR per Node-Credential (Enrollment-Token → 401) + Node-Bindung (auth.nodeId == :id, sonst 403).
✅ Installer persistiert nur Server/NodeId/Node-Credential (NIE den Enrollment-Token).
✅ Secrets via curl-stdin, nicht argv (ps-/proc-sicher).
✅ Credential-Revoke (CAS-idempotent) + Node-Retire (revoke-on-retire) · FK-Migration 037.
✅ Token/Credential niemals im Audit/Log/Response (Audit-data nur Prefix + ref-UUID).
```
Adressiert OWASP A04 (Cryptographic Failures: Hash-only Secrets) und A01/A07
(Identity & Privilege Abuse: einmaliger Klartext, Node-Bindung, Revoke-Pfad).

---

## 17. Compliance — NIS2 Readiness (KEIN Konformitätsnachweis)

> Architektur-Entscheidung: ADR-021. Ehrliche Positionierung (vgl. ADR-009).

```
EHRLICHE POSITIONIERUNG: Nexora liefert eine NIS2-READINESS-Sicht — eine
Selbsteinschätzung mit Evidenz-Verknüpfung. Das ist KEIN Konformitätsnachweis,
KEINE Zertifizierung und KEIN Rechtsgutachten. Per Test erzwungen.
```
- Statischer, versionierter 10-Control-Katalog (stabile Keys, deutsche Titel).
- Assessment-Status `not_started…addressed/not_applicable` (n/a braucht Begründung).
- Readiness-Signale `overdue` / `missingEvidence` / `needsReview`
  (**addressed ohne Evidence ⇒ needsReview**; Review-Kadenz `reviewDue`, Default 365 T — lokal).
- **Evidence-`ref` hart validiert:** nur http/https, kein `user:password@`, keine
  Secret-Query-/**Fragment**-Keys, kein `javascript:`/`data:`, keine Steuerzeichen.
- Management-Readiness-Report (`/v1/nis2/report`) trägt einen sichtbaren **Disclaimer**.
- Incident-Evidence (`/v1/nis2/controls/:key/incident-evidence`): nur sichere
  Snapshot-Felder eines Tickets, **kein PII** (Datenminimierung, DSGVO Art. 5).
- Audit trägt **nur sichere Metadaten** — nie `notes`/URL/Inhalt.
- RBAC: Lesen viewer+, Schreiben admin. Migration 036_nis2.

---

## 18. SSRF-Härtung — keine 3xx-Redirects (RealHttpClient)

> Erzwungen im zentralen HTTP-Client für ausgehende Integrationen.

```
✅ RealHttpClient (backend/src/integrations/http/RealHttpClient.js): redirect: 'error'.
   → Ein 3xx vom Zielserver wird NICHT automatisch verfolgt.
   Grund: node-fetch würde sonst den Authorization-Header transparent an ein
   vom Server gewähltes Redirect-Ziel weiterreichen → Credential-Leak / SSRF.
✅ Gleiches Prinzip im OIDC-Flow: Discovery- und Token-Fetches mit redirect:'error'.
```
Adressiert OWASP A10 (SSRF) und A04 (Credential-Leak über umgeleitete Auth-Header).

---

## 19. CSV-Injection-Schutz beim Audit-Export

> Audit-Log-Export (CSV) in `frontend/src/features/audit/auditExport.ts`.

```
✅ RFC-4180-Escaping: Felder mit , " \n \r werden in Double-Quotes gesetzt, " verdoppelt.
✅ CSV-Injection-Schutz (OWASP): beginnt ein Wert mit  = + - @  oder einem
   Steuerzeichen (Tab/CR), wird ein führendes ' vorangestellt
   → Tabellenkalkulationen (Excel/LibreOffice) interpretieren ihn als Text, nicht als Formel.
✅ UTF-8-BOM für korrekte Umlaut-Darstellung beim Öffnen in Excel.
```
Verhindert, dass Audit-Metadaten, die mit `=` beginnen, beim Öffnen des Exports
als Formel ausgeführt werden (Formula/CSV Injection, OWASP A03/Injection).
Pendant: PDF-Export via jsPDF (dynamisch geladen).

---

## 20. Secret-Handling — aktueller Stand

> Ergänzt Abschnitt 8 (Secrets Management).

```
✅ LLM-/Integrations-API-Keys: At-Rest AES-256-GCM-verschlüsselt (secretsCrypto),
   Schlüssel SETTINGS_ENC_KEY || JWT_SECRET (Dev-Fallback nur non-prod). ENV hat Vorrang.
   GET gibt Keys NIE im Klartext zurück (nur Status configured/keySource). (ADR-018)
✅ Provisioning-Token/-Credentials: nur Hash gespeichert, Klartext einmalig (siehe 16).
✅ Notification-Outbound: GET /v1/notifications/channels meldet nur .configured-Booleans
   (keine URLs/SMTP-Creds). URLs/SMTP-Daten NIEMALS im Rückgabewert oder in Logs.
✅ Audit-Redaction: sicherheitskritische Werte (Token, Evidence-URL, notes) erscheinen
   nie im Audit; nur sichere Metadaten/Referenzen.
```

---

## 21. Dependency-Security (Supply Chain)

> CI-Workflow `.github/workflows/security.yml`. Adressiert OWASP A03 (Supply Chain Failures).

```
✅ npm audit --omit=dev --audit-level=high  → Prod-Dependency-Gate (CI rot bei High/Critical).
✅ CycloneDX-SBOM-Generierung (maschinenlesbare Stückliste der Abhängigkeiten).
✅ Trigger: push + PR + wöchentlicher Cron (kontinuierliche Überwachung neuer CVEs).
✅ 2 produktive High-Vulns wurden im Zuge dieser Härtung gefixt.
```

---

## 22. Notification-Outbound — Kanäle (default AUS)

> Ausgehende Benachrichtigungen, default deaktiviert via `NOTIFICATIONS_OUTBOUND_ENABLED`.

| Kanal | Mechanismus | Konfig (ENV) |
|---|---|---|
| Slack | Incoming Webhook (HTTPS POST) | `NOTIFY_SLACK_WEBHOOK_URL` |
| Generischer Webhook | HTTPS POST (JSON) | `NOTIFY_WEBHOOK_URL` |
| Microsoft Teams | Incoming Webhook (HTTPS POST) | `NOTIFY_TEAMS_WEBHOOK_URL` |
| E-Mail / SMTP | nodemailer (LAZY geladen) | `NOTIFY_SMTP_HOST/PORT/SECURE/USER/PASS`, `NOTIFY_EMAIL_FROM/TO` |

```
✅ default AUS — kein ausgehender Traffic ohne explizite Aktivierung.
✅ GET /v1/notifications/channels liefert nur .configured-Booleans (keine URLs/Secrets).
✅ Best-effort-Versand: Fehler werden geloggt OHNE URL/SMTP-Daten — nur Channel-ID + anonyme Meldung.
ℹ️ E-Mail-Kanal ist LOKAL (nach dem deployten Stand 41d8d92). nodemailer wird erst
   beim ersten Versand geladen → kein Modul-Overhead, solange der Kanal aus ist.
```
Der hier genutzte E-Mail/SMTP-**Outbound**-Kanal ist der reale Versandpfad für
E-Mail-Benachrichtigungen; ein früher angedachter separater Mail-Server-Plan ist damit hinfällig.
