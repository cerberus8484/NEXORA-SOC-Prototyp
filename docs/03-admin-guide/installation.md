# Nexora SOC — Installations- & Deployment-Dokumentation

> Diese Anleitung führt einen Operator oder Entwickler von null zu einem laufenden
> System — **lokal (Dev)** und **produktiv (Proxmox/Ubuntu)**.
>
> Sie ist **vollständig aus dem Repository abgeleitet** (`docker-compose.dev.yml`,
> `deploy/`, `backend/src`). Stellen, an denen das Repo keine Befehle/Werte liefert,
> sind ehrlich als **TODO/offen** markiert — nichts ist erfunden.
>
> **Stand der Ableitung:** 2026-06-20 · **Version:** `v0.1.0` (SemVer; `/health` meldet
> die laufende Version) · **Deployter Stand:** `41d8d92` (MFA + PAT aktiv). Commits
> danach (E-Mail/SMTP-Kanal, OIDC, WebAuthn, NIS2-Review-Kadenz) sind lokal/unreleased
> und unten als **„lokal, noch nicht deployt"** gekennzeichnet.

---

## Inhalt

1. [Überblick & Architektur](#1-überblick--architektur)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Lokale Installation (Dev)](#3-lokale-installation-dev)
4. [Konfiguration (ENV)](#4-konfiguration-env)
5. [Datenbank & Migrationen](#5-datenbank--migrationen)
6. [Produktions-Deployment](#6-produktions-deployment)
7. [Externe Dienste anbinden](#7-externe-dienste-anbinden)
8. [Erster Start / Verifikation](#8-erster-start--verifikation)
9. [Betrieb (Backup, Release, Logs)](#9-betrieb-backup-release-logs)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Überblick & Architektur {#1-überblick--architektur}

Nexora SOC ist eine selbst-gehostete SOC-Plattform (Incident-Tickets, Threat Hunting,
KI-Triage-Agent, Live-Telemetrie). Sie besteht aus drei Kern-Containern und mehreren
**optionalen externen Diensten**.

```
                 ┌──────────────────────────────────────────┐
   Browser ─► 443 │  web (nginx + TLS)                       │
                 │   ├─ serviert React-SPA (frontend/dist)   │
                 │   └─ /api  → proxy ──► api:3000           │
                 │                         │                 │
                 │            api (Node/Express) ─► postgres │
                 └──────────────┬───────────────────────────┘
                                │ (optional, nach außen)
            ┌───────────────────┼───────────────────────────┐
            ▼                   ▼                           ▼
     Ollama (LLM)        Qdrant (RAG)             Wazuh (API :55000
   192.168.240.78:11434   10.99.99.79:6333            + Indexer :9200)
```

| Baustein | Technik | Pflicht? |
|---|---|---|
| **web** | nginx, serviert gebautes React-SPA, TLS-Terminierung, Reverse-Proxy `/api` | Pflicht (Prod) |
| **api** | Node.js + Express, Repository-Pattern, Migrationen auto bei Boot | Pflicht |
| **postgres** | PostgreSQL 16 (Tickets, User, Audit, Hunts) | Pflicht für Persistenz¹ |
| **Ollama** | Lokales LLM für KI-Agent (eigene LXC, kein Cloud-Zwang) | Optional² |
| **Qdrant** | Vektor-DB für RAG-Wissensbasis | Optional |
| **Wazuh** | SIEM — liefert Alerts (Webhook) + Indexer-Daten (Dashboard) | Optional |

¹ Ohne Postgres läuft das Backend auf **InMemory-Repositories** — nichts überlebt
einen Neustart (nur für Tests/Dev sinnvoll). Schalter: `DB_ENABLED`.
² Ohne Ollama bleibt der KI-Agent auf dem **`stub`-Provider** (deterministisch, kein
LLM). Schalter: `AGENT_LLM_PROVIDER`.

**Architektur-Prinzipien (aus `ROADMAP.md`):**

- **Repository-Pattern:** InMemory für Tests/Dev, Postgres bei `DB_ENABLED=true`
  (per-Domain-Factory).
- **Migrationen automatisch bei Boot:** `server.js` → `bootstrap()` ruft `migrate()`
  vor `app.listen()`. Idempotent (alle SQL-Dateien nutzen `IF NOT EXISTS`).
- **Fail-Fast:** In Produktion bricht der Start ab, wenn Pflicht-Secrets fehlen
  (`config/validateEnv.js`).
- **Keine Integration ohne Adapter, kein externer Input ohne Validierung.**

---

## 2. Voraussetzungen

### Gemeinsam

| Werkzeug | Version | Quelle/Begründung |
|---|---|---|
| **Node.js** | **20.x** | Container-Images `node:20-bookworm-slim` (Dev) bzw. Backend-Dockerfile. README nennt „Node.js 20+". |
| **Docker + Docker Compose** | aktuell (Compose v2, `docker compose`) | `docker-compose.dev.yml`, `deploy/docker-compose.prod.yml` |
| **Git** | aktuell | `release.sh` zieht den aktuell ausgecheckten Branch per `git pull --ff-only origin <branch>` |

### Zusätzlich für Produktion (aus `deploy/README.md` + ROADMAP P15)

- **Linux / Ubuntu 22.04 LTS** (empfohlen), läuft im Lab als **Proxmox-VM**
  (P15: VM 177, NAS, `192.168.240.77`).
- **TLS-Zertifikat** (interne CA oder Let's Encrypt) — Pfade `server.crt` / `server.key`.
- **DNS-Eintrag** auf die VM-IP (im Beispiel `soc.example.com`).
- **Firewall:** Port 3000 (api) und 5432 (postgres) **nicht** nach außen — nur `web`
  (80/443) ist öffentlich.

> Native (ohne Docker) Dev-Variante: README zeigt `npm install` + `npm run dev` je in
> `backend/` und `frontend/`. Dafür wird Node 20 lokal benötigt; Postgres ist dann
> optional (sonst InMemory).

---

## 3. Lokale Installation (Dev)

### Variante A — Full-Stack in Docker (empfohlen, mit Hot-Reload)

Startet Postgres + API + Frontend in Containern. Quelle: `docker-compose.dev.yml`.

```bash
# Im Repo-Root:
docker compose -f docker-compose.dev.yml up -d

# Logs verfolgen:
docker compose -f docker-compose.dev.yml logs -f api web

# Stoppen:
docker compose -f docker-compose.dev.yml down
```

Danach erreichbar:

| Dienst | URL | Hinweis |
|---|---|---|
| Frontend (Vite, HMR) | http://localhost:5173 | Proxy `/api` → `api:3000` |
| API | http://localhost:3000 | Health: `/api/v1/health` |
| Postgres (Dev) | `localhost:5432` | DB `soc_tickets_dev`, User `soc_api` |
| Postgres (Jest-Tests) | `localhost:5433` | DB `soc_tickets_test` |

**Erster Start ist langsam** — `npm install` läuft in beiden Containern. Danach liegen
die `node_modules` in Named Volumes (`api_node_modules`, `web_node_modules`) und der
Start ist schnell.

**Dev-Seed-Login** (aus `docker-compose.dev.yml`, automatisch idempotent angelegt):

```
E-Mail:    admin@nexora.example
Passwort:  DevAdmin123!
```

> Alle Dev-Secrets in `docker-compose.dev.yml` (z. B. `JWT_SECRET=dev-only-…`,
> `DB_PASSWORD=devpassword`) sind **nur für lokale Entwicklung** — niemals in Prod.

### Variante B — Nativ ohne Docker (aus `README.md`)

```bash
# 1) Backend
cd backend && npm install
npm run dev            # http://localhost:3000  (InMemory, ohne DB)
npm test

# 2) Frontend (zweites Terminal)
cd frontend && npm install
npm run dev            # http://localhost:5173  (Proxy /api → :3000)
npm test

# 3) Admin im Dev-Modus via ENV bootstrappen
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=ChangeMe123 npm --prefix backend run dev
```

Mit Persistenz nativ: `DB_ENABLED=true` + DB-Verbindungsdaten setzen (siehe ENV-Tabelle).

---

## 4. Konfiguration (ENV)

### Wo liegen die Dateien?

| Umgebung | Datei | In Git? |
|---|---|---|
| Dev (Docker) | inline in `docker-compose.dev.yml` | ja (nur Dev-Secrets) |
| Dev (nativ) | `backend/.env` (via `dotenv`) | **nein** (Secrets) |
| **Produktion** | `deploy/.env.production` (aus `deploy/.env.production.example` kopieren) | **NIEMALS** |

```bash
cp deploy/.env.production.example deploy/.env.production
# Alle CHANGE_ME-Werte ersetzen, dann:
nano deploy/.env.production
```

> **Secrets gehören nie in Git und nie in diese Doku.** Unten stehen nur
> Variablen**namen** + Platzhalter. Generatoren: `openssl rand -hex 64` (JWT),
> `openssl rand -hex 32` (Webhook), `openssl rand -hex 20` (DB-Passwort).

### Vollständige ENV-Tabelle

Abgeleitet aus `backend/src/config/index.js`, `config/validateEnv.js`, `db/pool.js`,
`server.js`, allen Adaptern unter `backend/src/integrations` + `agents` + `rag`, sowie
`deploy/.env.production.example`. **Pflicht** = Server startet in Produktion nicht ohne
korrekten Wert (durch `validateEnv`).

#### Server / Core

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `NODE_ENV` | empfohlen | `development` | `production` aktiviert Fail-Fast-Validierung + JWT-Guard |
| `PORT` | nein | `3000` | API-Port (intern) |
| `LOG_LEVEL` | nein | `info` | Winston-Loglevel (`debug`/`info`/`warn`/`error`) |
| `CORS_ORIGINS` | **Pflicht (prod)** | `http://localhost:5500` | Erlaubte Origins, kommagetrennt. In Prod **kein** `*`/`localhost` (sonst Start-Abbruch) |

#### Datenbank (PostgreSQL)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `DB_ENABLED` | **Pflicht (prod)** | `false` | `true` = echte Postgres-Persistenz; sonst InMemory |
| `DB_HOST` | **Pflicht (prod)** | `localhost` | DB-Host (im Compose: `postgres`) |
| `DB_PORT` | nein | `5432` | DB-Port |
| `DB_NAME` | **Pflicht (prod)** | `soc_tickets_dev` | Datenbankname |
| `DB_USER` | **Pflicht (prod)** | `soc_api` | DB-Benutzer |
| `DB_PASSWORD` | **Pflicht (prod)** | `devpassword` | DB-Passwort (Default ist in Prod verboten) |
| `DB_SSL` | nein | `false` | `true` = TLS zur DB (`rejectUnauthorized:true`) |
| `DB_POOL_MAX` | nein | `10` | Max. Pool-Verbindungen |

#### Auth (JWT)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `JWT_SECRET` | **Pflicht (prod)** | Dev-Fallback | Signierschlüssel; in Prod min. **32 Zeichen**, kein Dev-Fallback (sonst Abbruch). Generator: `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | nein | `8h` | Token-Gültigkeit |
| `AUTH_RETURN_TOKEN_JSON` | nein | prod: `false`, dev/test: `true` | Kompatibilitätsmodus für alte Bearer-Header-Clients. Browser-Login nutzt httpOnly-Cookie `soc_token`; in Produktion den JSON-Session-Token nur explizit mit `true` ausliefern. |
| `ADMIN_EMAIL` | optional | — | Bootstrap-Admin (nur angelegt wenn nicht vorhanden, idempotent) |
| `ADMIN_PASSWORD` | optional | — | Bootstrap-Admin-Passwort (wird nie geloggt). Nach erstem Login entfernen |

#### Webhooks (Integrationen, HMAC)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `WEBHOOK_SECRET_GENERIC` | **Pflicht (prod)** | — | HMAC-Secret generischer Webhook. Generator: `openssl rand -hex 32` |
| `WEBHOOK_SECRET_WAZUH` | Pflicht wenn Wazuh aktiv | — | HMAC-Secret Wazuh-Webhook (muss mit Wazuh-VM-Script übereinstimmen) |
| `WEBHOOK_SECRET_QRADAR` | optional | — | Nur wenn QRadar genutzt |
| `WEBHOOK_SECRET_SPLUNK` | optional | — | Nur wenn Splunk genutzt |
| `WEBHOOK_SECRET_SERVICENOW` | optional | — | Nur wenn ServiceNow genutzt |

#### Rate Limiting

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | nein | `60000` | Zeitfenster (ms) pro Client-IP |
| `RATE_LIMIT_MAX` | nein | `200` | Max. Requests/Fenster (UI/API) |
| `RATE_LIMIT_WEBHOOK_MAX` | nein | `1000` | Separater, höherer Topf für SIEM-Webhook-Bursts |

#### Wazuh — Push-Tuning + API-Pull (Enrichment)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `WAZUH_MIN_LEVEL` | nein | `5` | Tickets erst ab diesem Rule-Level (filtert Rauschen) |
| `WAZUH_CORRELATION_WINDOW_H` | nein | `24` | Wiederkehrende Offense aktualisiert offenes Ticket nur in diesem Fenster (h); `0` = nie zusammenfassen |
| `WAZUH_API_URL` | optional | — | Wazuh-Manager-API (z. B. `https://192.168.240.77:55000`). Leer = Enrichment aus |
| `WAZUH_API_USER` | optional | — | API-User (`wazuh`) |
| `WAZUH_API_PASSWORD` | optional | — | API-Passwort |
| `WAZUH_INDEXER_URL` | optional | — | OpenSearch/Indexer für Dashboard-Aggregationen (z. B. `https://…:9200`) |
| `WAZUH_INDEXER_USER` | optional | — | Indexer-User |
| `WAZUH_INDEXER_PASSWORD` | optional | — | Indexer-Passwort |
| `WAZUH_INDEXER_INDEX` | nein | `wazuh-alerts-*` | Alert-Index-Pattern |
| `WAZUH_INDEXER_VULN_INDEX` | nein | `wazuh-states-vulnerabilities-*` | Vuln-Index-Pattern |
| `WAZUH_TLS_REJECT_UNAUTHORIZED` | nein | `false` | `true` = TLS-Zertifikat-Validierung für Wazuh-API/Indexer (Prod-Warnung wenn nicht `true`) |
| `WAZUH_FP_APPLY_ENABLED` | nein | `false` | **Safety-Gate (Stage 4):** produktiver FP-Regel-Schreibpfad + Restart. `false` = apply/restart/revert → 403 |

#### KI-Agent / LLM (Ollama)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `AGENT_LLM_PROVIDER` | nein | `stub` | `stub` (kein LLM, deterministisch) oder `ollama` (lokales Modell) |
| `OLLAMA_BASE_URL` | nein | `http://192.168.240.78:11434` | Ollama-Endpunkt (nur bei `ollama`) |
| `OLLAMA_MODEL` | nein | `llama3.1:8b`¹ | Modellname (CPU-only: `llama3.2:3b` empfohlen) |
| `OLLAMA_TIMEOUT_MS` | nein | `60000` (compose) / `120000` (example) | Timeout für Ollama-Calls (ms) |
| `OLLAMA_NUM_PREDICT` | nein | — | Max. Tokens pro Antwort (optional) |
| `OLLAMA_TLS_REJECT_UNAUTHORIZED` | nein | — | TLS-Validierung für Ollama (optional) |

¹ Default differiert je Quelle: `docker-compose.prod.yml`/`ollama-setup.sh` nutzen
`llama3.1:8b`, `.env.production.example` empfiehlt `llama3.2:3b` (CPU-schnell).
**Empfehlung: `OLLAMA_MODEL` explizit setzen.**

#### RAG-Wissensbasis (Qdrant)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `RAG_ENABLED` | nein | `false` | RAG-Retrieval aktivieren |
| `QDRANT_URL` | optional | `http://10.99.99.79:6333` | Qdrant-Endpunkt |
| `QDRANT_API_KEY` | optional | — | Qdrant-API-Key (falls gesichert) |
| `QDRANT_TLS_REJECT_UNAUTHORIZED` | nein | — | TLS-Validierung Qdrant |
| `RAG_EMBED_MODEL` | nein | `nomic-embed-text` | Embedding-Modell (über Ollama) |
| `RAG_TOP_K` | nein | `3` | Anzahl Retrieval-Treffer |
| `RAG_INGEST_BATCH_SIZE` | nein | — | Batch-Größe beim Einlesen (optional) |

#### Threat Intel (Provider-Keys — nur Backend, nie ins Frontend/Git)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `VIRUSTOTAL_API_KEY` | optional | — | VirusTotal-Lookup. Leer = Provider `not_configured`, Mock-Fallback |
| `ABUSEIPDB_API_KEY` | optional | — | AbuseIPDB-Lookup. Leer = Mock-Fallback |
| `ABUSEIPDB_MAX_AGE_DAYS` | nein | `90` | Max. Alter der AbuseIPDB-Reports |

#### Autonomie-Gate

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `AUTONOMY_ENABLED` | nein | `false` | **Kill-Switch (ADR-016):** nur `true` aktiviert den Autonomie-Evaluator; sonst bleibt jede Policy advisory |

#### Auth-Erweiterungen (Security-Welle 3 — alle **default AUS**, serverseitig erzwungen)

> Alle folgenden Schalter sind nach Deploy **inert** (Feature aus) und werden ausschließlich
> serverseitig ausgewertet — ein gesetzter `*_ENABLED=true`-Wert schaltet erst die jeweiligen
> Routen/Challenges frei. Der klassische Passwort-Login bleibt in allen Fällen parallel
> bestehen. Secrets (`OIDC_CLIENT_SECRET` etc.) bleiben strikt backend-only — nie ins Frontend.

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `MFA_ENABLED` | nein | `false` | **MFA/TOTP** (RFC 6238, ohne externe Lib): nur `true` schaltet Enrollment-Routen + Login-Challenge (2. Faktor) frei. Org-weite Pflicht über das Setting `mfaRequired` (Setup-Token-Flow beim Login). Migration `038`. Routen `/v1/mfa/*`, `/v1/auth/mfa`, `/v1/auth/mfa-setup/{begin,complete}`. **LIVE** |
| `API_TOKENS_ENABLED` | nein | `false` | **Personal Access Tokens (PAT):** nur `true` aktiviert PAT-Auth + Routen `/v1/tokens` (Self-Service). Migration `030`. **LIVE** |
| `OIDC_ENABLED` | nein | `false` | **SSO/OIDC** (Authorization Code + PKCE, S256): nur `true` aktiviert Routen `/v1/auth/oidc/*` + SSO-Button. Migration `039`. **lokal, noch nicht deployt** |
| `OIDC_ISSUER` | wenn OIDC | — | Issuer-URL des IdP, z. B. `https://idp.example.com/realms/soc` |
| `OIDC_CLIENT_ID` | wenn OIDC | — | OIDC-Client-ID (öffentlich) |
| `OIDC_CLIENT_SECRET` | wenn OIDC | — | OIDC-Client-Secret — **strikt backend-only**, nie ins Frontend |
| `OIDC_REDIRECT_URI` | wenn OIDC | — | Callback-URL, z. B. `.../api/v1/auth/oidc/callback` |
| `OIDC_SCOPE` | nein | `openid profile email` | Angeforderte Scopes |
| `OIDC_DEFAULT_ROLE` | nein | `viewer` | Default-Rolle für neu verknüpfte Accounts (PoLA — kein Auto-Admin) |
| `OIDC_ALLOW_SIGNUP` | nein | `false` | `false` = nur Verknüpfung bestehender Accounts per verifizierter E-Mail, kein Auto-Anlegen |
| `WEBAUTHN_ENABLED` | nein | `false` | **WebAuthn/Passkey (FIDO2):** nur `true` aktiviert Routen `/v1/auth/webauthn/*` + Passkey-Button. Ergänzt TOTP-MFA, ersetzt es nicht. Migration `040`. **lokal, noch nicht deployt** |
| `WEBAUTHN_RP_ID` | wenn WebAuthn | — | Registrierbare Domain **ohne** Schema/Port, z. B. `nexora.example` |
| `WEBAUTHN_ORIGIN` | wenn WebAuthn | — | Vollständige erwartete Herkunft **mit** Schema, z. B. `https://nexora.example` |
| `WEBAUTHN_RP_NAME` | nein | `Nexora SOC` | Anzeigename der Relying Party |
| `WEBAUTHN_TIMEOUT_MS` | nein | `60000` | Ceremony-Timeout (ms) |

#### Outbound-Benachrichtigungen (default AUS via `NOTIFICATIONS_OUTBOUND_ENABLED`)

> Sicherheits-Invariante: Kein Outbound ohne `NOTIFICATIONS_OUTBOUND_ENABLED=true` **und**
> konfigurierte Ziel-URL. URLs/Secrets verlassen niemals das Backend —
> `GET /v1/notifications/channels` meldet nur `.configured`-Booleans, keine URLs.

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `NOTIFICATIONS_OUTBOUND_ENABLED` | nein | `false` | Master-Schalter; ohne `true` bleibt jeder Kanal inert |
| `NOTIFY_SLACK_WEBHOOK_URL` | optional | — | Slack-Incoming-Webhook |
| `NOTIFY_WEBHOOK_URL` | optional | — | Generischer Webhook (beliebiges Ziel) |
| `NOTIFY_TEAMS_WEBHOOK_URL` | optional | — | Microsoft-Teams-Incoming-Webhook |
| `NOTIFY_SMTP_HOST` | optional | — | E-Mail/SMTP-Host (nodemailer, lazy). Leer = E-Mail-Kanal inert. **E-Mail-Kanal lokal (nach `41d8d92`)** |
| `NOTIFY_SMTP_PORT` | nein | `587` | SMTP-Port (587 STARTTLS / 465 TLS) |
| `NOTIFY_SMTP_SECURE` | nein | `false` | `true` = 465/TLS, `false` = STARTTLS |
| `NOTIFY_SMTP_USER` | optional | — | SMTP-Auth-User (backend-only) |
| `NOTIFY_SMTP_PASS` | optional | — | SMTP-Auth-Passwort (backend-only) |
| `NOTIFY_EMAIL_FROM` | wenn E-Mail | — | Absenderadresse |
| `NOTIFY_EMAIL_TO` | wenn E-Mail | — | Empfängerliste (kommagetrennt); leer = E-Mail-Kanal inert |

#### Outbound-Ticket-Export (ServiceNow / OTRS, default AUS)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `EXTERNAL_TICKET_EXPORT_ENABLED` | nein | `false` | Nur `true` schaltet `POST /v1/tickets/:id/export` + `.../export/sync-status` frei. Pro Zielsystem zusätzlich erst aktiv, wenn dessen `*_BASE_URL` + Credentials gesetzt sind (siehe „optionale Adapter"). Credentials backend-only |

#### CrowdSec WAN-Integration (LAPI-Poller)

> Optionaler Adapter, der externe Angriffsfläche (HTTP-Bruteforce/Scanner/CVE-Probes/Bad Bots)
> vom Webserver-CrowdSec über die normale Integration-Pipeline in Tickets zieht (erbt
> Dedup/Normalize/Queue). Poller startet **nur**, wenn `CROWDSEC_LAPI_URL` gesetzt ist, und
> bleibt inert, solange URL/Machine-ID/Passwort nicht vollständig sind.

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `CROWDSEC_LAPI_URL` | wenn CrowdSec | — | LAPI-Basis-URL; gesetzt = Processor + Poller werden registriert |
| `CROWDSEC_MACHINE_ID` | wenn CrowdSec | — | LAPI-Machine-ID (Machine-JWT-Auth → `/v1/alerts`) |
| `CROWDSEC_PASSWORD` | wenn CrowdSec | — | LAPI-Machine-Passwort (backend-only) |
| `CROWDSEC_TLS_INSECURE` | nein | `false` | `true` = self-signed LAPI-Zertifikat akzeptieren (Lab) |
| `CROWDSEC_POLL_INTERVAL_MS` | nein | `60000` | Poll-Intervall (ms) |
| `CROWDSEC_SINCE` | nein | `15m` | Zeitfenster je Poll (z. B. `15m`) |

#### Correlation Engine — FQDN-Resolver (read-only, forward-confirm)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `FQDN_RESOLVER_ENABLED` | nein | `false` | Nur `true` aktiviert den DNS-Forward-Confirm-Resolver (füllt nur leere FQDN; A-Record muss == Flow-IP, **kein Fake**). **LIVE** |
| `FQDN_DNS_SERVER` | wenn Resolver | — | DNS-Server für Forward-Lookup, z. B. `10.99.99.10` |
| `FQDN_DOMAIN` | wenn Resolver | — | Suffix für Kandidatennamen, z. B. `nexora.example` |

#### Provisioning-Rate-Limits (P_PROVISION_SECURITY_1, default inaktiv)

> Greifen nur, wenn die jeweiligen `PROV_*`-Variablen gesetzt sind (siehe
> `routes/provisioning.js`). `/enroll` zählt **nur fehlgeschlagene** Versuche pro Quell-IP;
> `/heartbeat` begrenzt Flood pro `nodeId` (NAT-transparent) + Auth-Fehler pro Quell-IP.

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `PROV_ENROLL_WINDOW_MS` | nein | `900000` (15 min) | Fenster für `/enroll`-Limit |
| `PROV_ENROLL_MAX` | nein | `5` | Max. fehlgeschlagene `/enroll`-Versuche pro IP/Fenster |
| `PROV_ENROLL_SKIP_SUCCESSFUL` | nein | `true` | Erfolgreiche Enrolls zählen nicht gegen das Limit |
| `PROV_HEARTBEAT_WINDOW_MS` | nein | `60000` (1 min) | Flood-Fenster pro `nodeId` |
| `PROV_HEARTBEAT_MAX_PER_NODE` | nein | `60` | Max. Heartbeats pro `nodeId`/Fenster (~1/s) |
| `PROV_HEARTBEAT_FAIL_WINDOW_MS` | nein | `900000` (15 min) | Fenster für Heartbeat-Auth-Fehler |
| `PROV_HEARTBEAT_FAIL_MAX_PER_IP` | nein | `20` | Max. Heartbeat-Auth-Fehler pro Quell-IP/Fenster |

#### TLS (nur Prod, vom Host in `web` gemountet)

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `TLS_CERT_PATH` | **Pflicht (prod)** | `/etc/ssl/soc/server.crt` | Host-Pfad zum Zertifikat |
| `TLS_KEY_PATH` | **Pflicht (prod)** | `/etc/ssl/soc/server.key` | Host-Pfad zum Private Key (`chmod 600`) |

#### Optionale Integrations-Adapter (nur wenn genutzt)

Diese Variablen erscheinen **nicht** in `.env.production.example` — sie sind im Code
referenziert und müssen bei Bedarf ergänzt werden (**TODO: kein Beispiel-Eintrag im
Repo**):

| Variable | Zweck |
|---|---|
| `QRADAR_HOST`, `QRADAR_BASE_URL`, `QRADAR_TOKEN`, `QRADAR_TLS_REJECT_UNAUTHORIZED` | QRadar-Adapter/Dashboard + Processor-Registrierung (`server.js` registriert QRadar-Processor nur wenn `QRADAR_HOST` gesetzt) |
| `SPLUNK_HOST`, `SPLUNK_BASE_URL` | Splunk-Adapter + Processor (nur wenn `SPLUNK_HOST` gesetzt) |
| `SERVICENOW_BASE_URL`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD` | ServiceNow-Outbound-Adapter (Ticket-Export; zusätzlich `EXTERNAL_TICKET_EXPORT_ENABLED=true` nötig) |
| `OTRS_BASE_URL`, `OTRS_USERNAME`, `OTRS_PASSWORD`, `OTRS_WEB_SERVICE`, `OTRS_OPERATION` | OTRS-Outbound-Adapter (Ticket-Export; zusätzlich `EXTERNAL_TICKET_EXPORT_ENABLED=true` nötig) |
| `IMAP_HOST`, `IMAP_*`, `WEBHOOK_SECRET_EMAIL` | E-Mail-Intake (Processor + IMAP-Poller nur wenn `IMAP_HOST` gesetzt) |
| `AUDIT_IP_SALT` | Salt für IP-Hashing im Audit-Log (DSGVO) |
| `OLLAMA_UC_TIMEOUT_MS`, `OLLAMA_UC_*` | Timeout für „KI Use-Case Developer"-Generierung |

> **TODO/offen:** Für die optionalen Adapter (QRadar/Splunk/ServiceNow/OTRS/E-Mail)
> liefert das Repo kein vollständiges ENV-Beispiel mit konkreten Werten — nur die
> Variablennamen im Code. Vor produktiver Nutzung müssen Auth/URLs dort verifiziert
> werden.

---

## 5. Datenbank & Migrationen {#5-datenbank--migrationen}

### Mechanismus (aus `backend/src/db/pool.js` + `server.js`)

- Beim Start ruft `bootstrap()` (in `server.js`) — **nur wenn `DB_ENABLED=true`** —
  zuerst `migrate()`, dann `ping()`, **bevor** `app.listen()` Requests annimmt.
- `migrate()` liest alle `*.sql`-Dateien aus `backend/src/db/migrations/`,
  **sortiert sie alphabetisch** (`readdirSync().sort()`) und führt sie der Reihe nach
  aus.
- Alle Migrationen sind **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ALTER … IF NOT
  EXISTS`) — wiederholtes Ausführen ist sicher, es gibt **kein** separates
  Migrations-Framework / keine Versions-Tabelle.

### Aktueller Migrationsstand

**40 Migrationen** (`001` … `040`) — additiv/idempotent, laufen automatisch beim API-Boot:

```
001_create_tickets            021_agent_suggestion_analysis
002_create_users_and_audit    022_use_case_drafts
003_create_threat_hunting     023_ticket_analyst_state
004_ticket_state              024_hunt_finding_verdict
005_ticket_customer           025_qradar_offense_notes
006_ticket_alert_count        026_published_detections
007_ticket_parent_case        027_autonomy_policies
008_wazuh_fp_exceptions       028_user_profile_fields
009_evidence                  029_notifications
010_evidence_sha256           030_api_tokens
011_evidence_custody          031_password_aging
012_yara_rules                032_user_prefs
013_agent_suggestions         033_provisioning
014_hunt_logs_and_context     034_enrollment_tokens
015_hunt_response_actions     035_node_credentials
016_agent_suggestion_verdict  036_nis2
017_ticket_number_seq         037_node_credentials_fk
018_analysis_templates        038_mfa_enrollments
019_use_cases                 039_user_oidc_link
020_ticket_ti_entries         040_webauthn_credentials
```

**Neu seit dem letzten Doku-Stand (`029`–`040`):** `029_notifications`,
`030_api_tokens`, `031_password_aging`, `032_user_prefs`, `033_provisioning`,
`034_enrollment_tokens`, `035_node_credentials`, `036_nis2`,
`037_node_credentials_fk` (FK `node_credentials` → `installed_nodes`),
`038_mfa_enrollments`, `039_user_oidc_link`, `040_webauthn_credentials`. Alle
nutzen `CREATE TABLE/INDEX IF NOT EXISTS` bzw. `ALTER … IF NOT EXISTS` und sind
gegen wiederholtes Ausführen sicher.

### Manuell migrieren (z. B. neue Migration ohne Neustart)

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  exec api node -e "require('./src/db/pool').migrate().then(() => process.exit(0))"
```

> **Wichtig:** Neue Migrationsdateien müssen so benannt sein, dass die alphabetische
> Sortierung der gewünschten Reihenfolge entspricht (führende Nullen, z. B. `029_…`).

---

## 6. Produktions-Deployment

Kontext: Linux/Ubuntu-VM, im Lab auf **Proxmox** (ROADMAP P15). Die aktuelle
Produktiv-Referenz liegt unter **`/opt/SOC-Orchestrator`**. Falls eine Umgebung
historisch abweicht, vor jedem Eingriff zuerst `pwd` und `git branch --show-current`
prüfen statt alte Pfade blind zu übernehmen.

### 6.1 Ersteinrichtung (aus `deploy/README.md`)

```bash
# 1) Secrets erzeugen
openssl rand -hex 64    # JWT_SECRET (min. 64)
openssl rand -hex 20    # DB_PASSWORD (min. 20)
openssl rand -hex 32    # WEBHOOK_SECRET_* (min. 32 je Quelle)

# 2) ENV-Datei anlegen und ausfüllen
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production       # alle CHANGE_ME ersetzen

# 3) TLS-Zertifikat ablegen
mkdir -p /etc/ssl/soc
cp server.crt /etc/ssl/soc/server.crt
cp server.key /etc/ssl/soc/server.key
chmod 600 /etc/ssl/soc/server.key
# Pfade in deploy/.env.production: TLS_CERT_PATH / TLS_KEY_PATH

# 4) Starten (baut api + web mit)
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up -d --build
```

Drei Container starten: `soc_postgres_prod`, `soc_api_prod`, `soc_web_prod`. Nur `web`
ist von außen erreichbar (80/443). Postgres und API haben **keinen** externen Port.

### 6.2 Container-Topologie (`deploy/docker-compose.prod.yml`)

| Service | Image / Build | Ports | Besonderheit |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | keine (nur intern) | Volume `pgdata_prod`, Healthcheck `pg_isready` |
| `api` | Build `backend/Dockerfile` target `production` | keine (nur intern) | `DB_ENABLED=true` fix gesetzt; Healthcheck `/api/v1/health` |
| `web` | Build `frontend/Dockerfile` target `web` (Context = Repo-Root) | `80:80`, `443:443` | nginx.conf ins Image gebacken; TLS-Certs vom Host gemountet |

Netzwerk `internal` (bridge), Volume `pgdata_prod`. Projektname `soc` →
Volume `soc_pgdata_prod`.

> **⚠️ Falle — neue Prod-ENV erreicht den Container nur über den `environment:`-Block:**
> `deploy/docker-compose.prod.yml` reicht ENV an den `api`-Service über einen **expliziten
> `environment:`-Block** durch, **nicht** über `env_file`. Eine neue Variable in
> `deploy/.env.production` wird vom Container daher erst gesehen, wenn sie zusätzlich als
> Zeile im `environment:`-Block des `api`-Service deklariert ist (z. B.
> `MFA_ENABLED: ${MFA_ENABLED}`). Ohne diese Zeile bleibt das Feature inert, obwohl der
> Wert in der ENV-Datei steht. Nach Änderung des Compose-Blocks:
> `./deploy/soc.sh up -d --force-recreate api`.

### 6.3 nginx / TLS (`deploy/nginx/nginx.conf`)

- **HTTP → HTTPS**-Redirect (301).
- TLS 1.2/1.3, HSTS-Header, Sicherheits-Header (`X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`).
- `/api/` → `api:3000` (Timeout 30s); `/api/v1/integrations/` 60s;
  `/api/v1/agent/` und `/api/v1/use-case-drafts/` **600s** (lokales LLM kann lange
  brauchen).
- `/` → React-SPA (`try_files … /index.html`), Assets 30 Tage Cache, HTML no-cache.
- `/health` → proxyt auf API-Health (App + DB).
- `/metrics` (Prometheus) → **nur interne IPs** (`10.99.99.0/24`, `127.0.0.1`).

> **Hinweis:** nginx.conf nutzt `proxy_read_timeout 600s` für den KI-Agent, der Kommentar
> referenziert `OLLAMA_TIMEOUT_MS=600000`. Der App-Default ist niedriger
> (60s/120s) — bei langsamem CPU-Ollama `OLLAMA_TIMEOUT_MS` entsprechend erhöhen,
> damit App- und nginx-Timeout zusammenpassen.

### 6.4 Release-Workflow (`deploy/release.sh` + `deploy/soc.sh`)

`release.sh` (auf dem Server ausführen) macht in dieser Reihenfolge:

1. Aktuelle HEAD-Position merken, aktiven Branch ermitteln und `git pull --ff-only origin <aktueller-branch>`.
2. Neue Commits seit dem letzten Stand anzeigen.
3. `soc.sh build api web` (nur api + web; postgres braucht kein Build).
4. `soc.sh up` (= `docker compose … up -d`). Beim API-Boot laufen die Migrationen
   automatisch (additiv/idempotent) — neue Tabellen entstehen ohne manuellen Schritt.
5. 10 s warten, dann `soc.sh health` (curl auf `https://localhost/health`).
6. „RELEASE OK" oder Fehler + Exit-Code.

```bash
./deploy/release.sh
```

> **Empfohlenes Pre-Deploy-Gate (Operator-Praxis, nicht im Skript):** Vor jedem Release
> mit Migrationen ein **frisches, verschlüsseltes DB-Backup** ziehen (`./deploy/backup-db.sh`,
> siehe Abschnitt 9) und prüfen, dass der Pull ein **Fast-Forward** ist und die neuen
> Migrationen rein **additiv** sind. So ist im Fehlerfall ein sauberer Rückweg vorhanden,
> bevor die Migrationen beim Boot laufen.

> **Deploy-Verifikation über die Version:** `/health` meldet die laufende `version` aus
> `package.json` (`{"status":"ok","db":"ok","version":"0.1.0",…}`). Nach dem Release
> bestätigt der Versionsstring im Health-Response (zusammen mit `git rev-parse HEAD` auf
> dem Server), dass der erwartete Stand läuft.

> **Wichtig für Operatoren:** Veraltete Einzeiler wie `ssh root@...`, `cd /apps` oder
> `git pull origin main` sind absichtlich **nicht** mehr die Referenz. Wenn `./deploy/soc.sh`
> nicht gefunden wird, befindest du dich nicht im geklonten Repo.

`soc.sh` ist ein Wrapper, der `-f docker-compose.prod.yml` und
`--env-file .env.production` automatisch setzt:

```bash
./deploy/soc.sh ps                       # Status
./deploy/soc.sh logs api                 # Logs
./deploy/soc.sh up                       # up -d
./deploy/soc.sh restart api              # Neustart api
./deploy/soc.sh exec api npm run seed:admin
./deploy/soc.sh health                   # curl -k https://localhost/health
```

> `soc.sh` bricht ab, wenn `deploy/.env.production` fehlt.

### 6.5 Frontend nach Änderungen neu bauen

Das React-SPA wird **im `web`-Image** gebaut (Multi-Stage). Kein separater Build-Schritt:

```bash
docker-compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  up -d --build web
```

---

## 7. Externe Dienste anbinden

Für jeden optionalen Dienst: **was setzen · wie verifizieren · Verhalten ohne Config.**

### 7.1 Ollama (lokales LLM, KI-Agent)

Läuft als **eigene LXC** (`192.168.240.78:11434`, `OLLAMA_HOST=0.0.0.0`). Das Modell wird
**dort** geladen, nicht im SOC-Container.

```bash
# Modell auf der Ollama-LXC laden:
ssh root@192.168.240.78 'ollama pull llama3.2:3b'

# In deploy/.env.production:
AGENT_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://192.168.240.78:11434
OLLAMA_MODEL=llama3.2:3b

# API neu starten:
./deploy/soc.sh up   # bzw. up -d --force-recreate api

# Verifizieren (prüft Erreichbarkeit + Modell + Smoke-Test):
./deploy/ollama-setup.sh
# Im Log nach erfolgreicher Provider-Wahl suchen:
./deploy/soc.sh logs api | grep llm_provider_selected
```

**Ohne Ollama:** `AGENT_LLM_PROVIDER=stub` (Default) → deterministische Stub-Antworten,
kein LLM-Call. Der KI-Agent funktioniert, liefert aber keine echte Modell-Analyse.

> **Modell-Empfehlung:** CPU-only → `llama3.2:3b` (~6–12 s). `llama3.1:8b` ist auf CPU
> zäh (20–44 s/Antwort). Timeout (`OLLAMA_TIMEOUT_MS`) und nginx (`proxy_read_timeout`)
> entsprechend abstimmen.

### 7.2 Qdrant / RAG-Wissensbasis

```bash
# In deploy/.env.production:
RAG_ENABLED=true
QDRANT_URL=http://10.99.99.79:6333
RAG_EMBED_MODEL=nomic-embed-text      # über Ollama
RAG_TOP_K=3
```

Verifizieren: RAG-Status-Route im Frontend (Settings → RAG-Karte) bzw. API
`/api/v1/rag/status` (Reindex über `/api/v1/rag/reindex`).

**Ohne Qdrant:** `RAG_ENABLED=false` (Default) → KI-Agent arbeitet ohne
Wissens-Retrieval. Keine Fehler, nur kein RAG-Kontext.

> **TODO/offen:** Das Einlesen der Wissensbasis (MITRE/Hunts/Incidents) ist Phase
> P19b/P19d (laut ROADMAP teils offen). Konkrete Ingest-Befehle sind im Repo nicht als
> Deploy-Skript hinterlegt — Anbindung erfolgt über die `/rag`-Routes.

### 7.3 Wazuh (SIEM)

Zwei Anbindungen, beide optional:

**a) Inbound (Alert → Ticket, Pflicht-Secret):**

```bash
WEBHOOK_SECRET_WAZUH=<openssl rand -hex 32>   # muss mit Wazuh-VM-Script übereinstimmen
WAZUH_MIN_LEVEL=5                              # Rausch-Filter
```

Auf der Wazuh-Manager-Seite richtet `deploy/proxmox-install-wazuh.sh` bzw. ein
Custom-Integration-Script den Webhook ein (HMAC-signiert). Der Webhook-Endpunkt ist
`/api/v1/integrations/wazuh/webhook`. Der Wazuh-Processor ist **immer** registriert
(primäre Quelle).

**b) API-Pull + Indexer (Enrichment + Dashboard, optional):**

```bash
WAZUH_API_URL=https://192.168.240.77:55000
WAZUH_API_USER=wazuh
WAZUH_API_PASSWORD=<…>
WAZUH_INDEXER_URL=https://192.168.240.77:9200
WAZUH_INDEXER_USER=<…>
WAZUH_INDEXER_PASSWORD=<…>
WAZUH_TLS_REJECT_UNAUTHORIZED=true      # in Prod empfohlen (gültiges Cert nötig)
```

Verifizieren: Log `wazuh_api_enrichment {enabled:true}` beim Boot; `/wazuh`-Dashboard
zeigt echte Indexer-Daten.

**Ohne Wazuh-API/Indexer:** Variablen leer lassen → Enrichment aus, Dashboard zeigt
ehrliche Leerzustände (ADR-009). Keine Fehler.

### 7.4 Threat-Intel-Keys (VirusTotal / AbuseIPDB)

```bash
VIRUSTOTAL_API_KEY=<…>
ABUSEIPDB_API_KEY=<…>
```

**Ohne Keys:** Provider-Status `not_configured`, **Mock bleibt Fallback**. Nur
öffentliche IPs werden extern abgefragt (private/multicast/reserved nicht), Ergebnisse
24 h gecacht.

### 7.5 QRadar / Splunk / ServiceNow / OTRS / E-Mail

Registrierung der Processor passiert **conditional** beim Boot (`server.js`): QRadar nur
wenn `QRADAR_HOST` gesetzt, Splunk nur wenn `SPLUNK_HOST`, E-Mail-Poller nur wenn
`IMAP_HOST`. Variablennamen siehe ENV-Tabelle (Abschnitt „optionale Adapter").

> **TODO/offen:** Vollständige, verifizierte ENV-Beispiele für diese Adapter fehlen im
> Repo — vor produktiver Nutzung Auth/URLs prüfen.

---

## 8. Erster Start / Verifikation {#8-erster-start--verifikation}

Smoke-Tests aus `deploy/README.md`, der Reihe nach (`soc.example.com` durch eure Domain
ersetzen):

```bash
# 1) Health (App + DB + laufende Version)
curl -k https://soc.example.com/api/v1/health
#   → {"status":"ok","db":"ok","version":"0.1.0",...}
#     "version" = SemVer aus package.json → bestätigt den deployten Stand

# 2) HTTP→HTTPS-Redirect
curl -I http://soc.example.com/
#   → 301, Location: https://…

# 3) Unauth-Zugriff blockt
curl -k https://soc.example.com/api/v1/tickets
#   → 401 {"error":"UNAUTHORIZED",...}

# 4) Login
curl -k -X POST https://soc.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@firma.de","password":"<ADMIN_PASSWORD>"}'
#   → {"token":"eyJ...","user":{...}}
```

**Komfort-Health über nginx:** `curl -k https://soc.example.com/health` (proxyt auf
API-Health). `soc.sh health` nutzt genau diesen Pfad.

**Persistenz-Restart-Test (P14):** Login → Ticket anlegen → `restart api` → erneut
Login + Ticket noch da? Wenn ja, ist die Postgres-Persistenz scharf. (Vollständige
Befehlskette in `deploy/README.md`.)

> **Bekannte Ausnahme:** Die JWT-Logout-Blocklist ist In-Memory — nach einem Neustart
> sind ausgeloggte, noch nicht abgelaufene Tokens wieder gültig (verfallen ohnehin nach
> `JWT_EXPIRES_IN`).

---

## 9. Betrieb (Backup, Release, Logs)

### Backups

**Verschlüsseltes Auto-Backup (`deploy/backup-db.sh`):**

- `pg_dump` läuft **im Container** (DB-Creds verlassen ihn nie).
- Pipeline `pg_dump | gzip | openssl enc -aes-256-cbc -pbkdf2` → **nie Klartext** auf
  der Platte (DSGVO Art. 32).
- Passphrase aus `~/.soc_backup_pass` (0600, beim ersten Lauf erzeugt).
  **⚠️ Passphrase getrennt sichern — sonst sind alle Backups unwiederherstellbar.**
- Integritätscheck (entschlüsseln + `gzip -t`), Rotation (Default: 14 behalten).

```bash
./deploy/backup-db.sh
# Variablen: SOC_BACKUP_DIR (Default ~/backups/soc), SOC_BACKUP_KEEP (14),
#            SOC_BACKUP_PASS_FILE (~/.soc_backup_pass)
```

**Restore:**

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$HOME/.soc_backup_pass \
  -in soc-<TS>.sql.gz.enc | gunzip | \
  docker exec -i soc_postgres_prod sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

**Cron** (laut Memory: 03:30 auf dem Prod-Host). Beispiel-Cron-Eintrag (TODO: konkreten
Pfad anpassen):

```cron
30 3 * * * cd <repo-root> && ./deploy/backup-db.sh >> /var/log/soc-backup.log 2>&1
```

> Zusätzlich auf Proxmox: VM-Snapshot vor Updates (`qm snapshot <vmid> pre-update`) +
> `vzdump`. App-Backup (Dump) ≠ VM-Backup — beides nutzen.

**Volume-Snapshot (Alternative, Dateiebene):** siehe `deploy/README.md` (Stoppen →
`tar` von `soc_pgdata_prod` → Starten).

### Audit-Log-Rotation

`deploy/prune-audit-log.sh` — kürzt das append-only Audit-Log nach Aufbewahrungsfrist.

### Logs

```bash
./deploy/soc.sh logs api          # API (Winston, strukturiert JSON)
./deploy/soc.sh logs web          # nginx (json_combined access log)
docker logs soc_api_prod          # direkt
```

### Metrics

Prometheus-Endpunkt `/metrics` (über nginx **nur interne IPs**). Grafana im Lab
`10.99.99.55`.

---

## 10. Troubleshooting

| Symptom | Wahrscheinliche Ursache | Fix (aus Repo ableitbar) |
|---|---|---|
| **Start bricht ab: „PRODUKTIONS-KONFIGURATION UNGÜLTIG"** | Pflicht-Secret fehlt/hat Dev-Default (`JWT_SECRET`, `DB_*`), oder `CORS_ORIGINS` enthält `*`/`localhost` | `validateEnv.js` listet die genaue verletzte Regel im Log. Werte in `.env.production` korrigieren |
| **`JWT_SECRET muss in Produktion gesetzt sein (min. 32 Zeichen)`** | In Prod kein/zu kurzer `JWT_SECRET` | `openssl rand -hex 64` setzen (kein Dev-Fallback in Prod erlaubt) |
| **Health zeigt `"db":"error"` / `"status":"degraded"`** | Postgres nicht erreichbar; `DB_HOST`/Creds falsch; Container noch nicht healthy | `soc.sh ps` (postgres healthy?), Creds prüfen, `soc.sh logs api` (`pg_pool_error`/`pg_query_error`) |
| **Nach Neustart keine Daten / Login weg** | `DB_ENABLED` nicht `true` → InMemory-Repos | In Prod ist `DB_ENABLED=true` im Compose fix; bei nativ/Dev explizit setzen |
| **Tabelle fehlt / Spalte unbekannt** | Migration nicht gelaufen (DB war beim Boot down) oder neue Migration nicht ausgeführt | Migration manuell anstoßen (Abschnitt 5); Dateibenennung `NNN_…` für Sortierreihenfolge prüfen |
| **KI-Agent: Timeout / 504** | CPU-Ollama langsamer als Timeout; App- und nginx-Timeout passen nicht zusammen | `OLLAMA_MODEL=llama3.2:3b`, `OLLAMA_TIMEOUT_MS` erhöhen; nginx `/api/v1/agent/` steht auf 600s |
| **KI-Agent liefert nur Stub-Antworten** | `AGENT_LLM_PROVIDER` nicht auf `ollama` (Default `stub`) | Provider setzen + API neu starten; `soc.sh logs api \| grep llm_provider_selected` |
| **Ollama „nicht erreichbar"** | Firewall / `OLLAMA_HOST` nicht `0.0.0.0` / Modell nicht geladen | `./deploy/ollama-setup.sh`; Modell auf LXC `ollama pull <model>` |
| **Webhook → 401/403** | HMAC-Signatur/Secret falsch, Timestamp abgelaufen (Replay-Schutz) | `WEBHOOK_SECRET_*` muss auf beiden Seiten identisch sein; Signatur `sha256=HMAC(timestamp.body)` |
| **Stage-4 FP-Apply → 403** | Safety-Gate aus | Bewusst `WAZUH_FP_APPLY_ENABLED=true` setzen (nur wenn echter Wazuh-Write+Restart gewollt) |
| **TLS-Fehler beim Start von `web`** | `TLS_CERT_PATH`/`TLS_KEY_PATH` zeigen ins Leere oder falsche Rechte | Zertifikate nach `/etc/ssl/soc/` legen, `chmod 600` Key, Pfade in `.env.production` |
| **`soc.sh`: „.env.production fehlt"** | ENV-Datei nicht angelegt | `cp deploy/.env.production.example deploy/.env.production` + ausfüllen |
| **Warnung `WAZUH_TLS_REJECT_UNAUTHORIZED ist nicht "true"`** | TLS-Validierung für Wazuh aus (Lab-Default) | In Prod `true` setzen + gültiges Zertifikat verwenden (nur Warnung, kein Abbruch) |

---

## Anhang — Referenzdateien im Repo

| Datei | Inhalt |
|---|---|
| `docker-compose.dev.yml` | Lokaler Full-Stack (Dev) |
| `deploy/docker-compose.prod.yml` | Produktions-Stack |
| `deploy/.env.production.example` | ENV-Vorlage (kopieren → `.env.production`) |
| `deploy/nginx/nginx.conf` | nginx/TLS/Proxy-Konfiguration |
| `deploy/release.sh` · `deploy/soc.sh` | Release- + Compose-Wrapper |
| `deploy/backup-db.sh` · `deploy/prune-audit-log.sh` | Backup + Audit-Rotation |
| `deploy/ollama-setup.sh` | Ollama-Erreichbarkeit verifizieren |
| `deploy/proxmox-install-wazuh.sh` | Wazuh-Installation/Webhook (Wazuh-VM) |
| `deploy/README.md` | Deploy-Detailanleitung + Smoke-Tests |
| `backend/src/db/migrations/` | 28 SQL-Migrationen (auto bei Boot) |
| `backend/src/config/validateEnv.js` | Fail-Fast-ENV-Validierung (Prod) |
| `ROADMAP.md` | Phasen, Architektur-Regeln, P15-Deploy |
</content>
</invoke>
