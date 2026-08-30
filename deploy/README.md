# Deployment — SOC Ticket Tool

## Voraussetzungen

- Docker + Docker Compose auf der VM
- Ubuntu 22.04 LTS empfohlen
- TLS-Zertifikat (intern CA oder Let's Encrypt)
- DNS-Eintrag: `soc.example.com` → VM-IP

## Architektur des Deployments

```
                 ┌──────────────────────────────────────────┐
   Browser ──► 443 │  web (nginx)                            │
                 │   ├─ serviert React-SPA (frontend/dist)   │
                 │   ├─ /docs → HTML-Dokumentation           │
                 │   └─ /api  → proxy ──► api:3000           │
                 │                         │                 │
                 │            api (Node) ──┴──► postgres:5432│
                 └──────────────────────────────────────────┘
```

Drei Container: **web** (nginx + gebautes Frontend), **api** (Node-Backend),
**postgres**. Nur `web` ist von außen erreichbar (80/443).

> **Persistenz (P14):** Bei `DB_ENABLED=true` sind **Tickets, User, Audit und
> Threat Hunts** vollständig in Postgres persistiert und überleben Container-/
> API-Neustarts. Der Login funktioniert nach Restart unverändert weiter.
> Einzige bewusste Ausnahme: die JWT-Logout-Blocklist ist In-Memory — nach
> einem Restart sind ausgeloggte, noch nicht abgelaufene Tokens wieder gültig
> (Tokens verfallen ohnehin nach `JWT_EXPIRES_IN`, Default 8h).

---

## Ersteinrichtung

### 1. Secrets erzeugen

```bash
# JWT Secret (min. 64 Zeichen)
openssl rand -hex 64

# DB Password (min. 20 Zeichen)
openssl rand -hex 20

# Webhook Secrets (min. 32 Zeichen)
openssl rand -hex 32
```

### 2. ENV-Datei anlegen

```bash
cp deploy/.env.production.example deploy/.env.production
# Alle CHANGE_ME Werte ersetzen
nano deploy/.env.production
```

### 3. TLS-Zertifikat ablegen

```bash
mkdir -p /etc/ssl/soc
cp server.crt /etc/ssl/soc/server.crt
cp server.key /etc/ssl/soc/server.key
chmod 600 /etc/ssl/soc/server.key
```

Pfade in `deploy/.env.production` eintragen:
```
TLS_CERT_PATH=/etc/ssl/soc/server.crt
TLS_KEY_PATH=/etc/ssl/soc/server.key
```

### 4. Starten

```bash
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up -d --build
```

### 5. Migrationen

Bei `DB_ENABLED=true` führt der **api-Container die Migrationen beim Start
automatisch aus** (`server.js` → `migrate()` vor `listen()`). Es legt die
Tabellen `tickets`, `users`, `audit_log`, `hunt_*` an.

Manuell erzwingen (z. B. nach neuer Migration ohne Neustart):

```bash
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production \
  exec api node -e "require('./src/db/pool').migrate().then(() => process.exit(0))"
```

### 6. Frontend

Das React-SPA wird **im `web`-Image gebaut** (Multi-Stage, `frontend/Dockerfile`).
Kein separater Build-Schritt nötig — `up -d --build` baut es mit.
Nach Frontend-Änderungen:

```bash
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up -d --build web
```

---

## Smoke Tests

Nach dem Start alle Checks der Reihe nach ausführen.

### 0. Header-/CSP-Schnelltest

```bash
sh deploy/smoke-csp.sh
# optional gegen echte Domain:
SOC_SMOKE_BASE_URL=https://soc.example.com sh deploy/smoke-csp.sh
```

Erwartung:
- `/` liefert HSTS + strenge SPA-CSP
- `/docs/` liefert HSTS + relaxtere Doku-CSP
- `/nginx-health` verliert HSTS nicht durch nginx-`add_header`-Schatten

Zusätzlich läuft derselbe Check in der GitHub-CI gegen das echte gebaute nginx-Web-
Image (`.github/workflows/ci.yml`, Job `Web Headers (nginx · CSP/HSTS)`).

### 1. Healthcheck

```bash
curl -k https://soc.example.com/api/v1/health
# Erwartetes Ergebnis:
# {"status":"ok","db":"ok",...}
```

### 2. HTTPS-Redirect

```bash
curl -I http://soc.example.com/
# Erwartetes Ergebnis:
# HTTP/1.1 301 Moved Permanently
# Location: https://soc.example.com/
```

### 3. Unauthentifizierter Zugriff

```bash
curl -k https://soc.example.com/api/v1/tickets
# Erwartetes Ergebnis:
# HTTP 401 + {"error":"UNAUTHORIZED",...}
```

### 4. Login

```bash
curl -k -X POST https://soc.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@firma.de","password":"IhrPasswort"}'
# Erwartetes Ergebnis:
# {"token":"eyJ...","user":{...}}
```

### 5. Persistenz-Restart-Test (P14)

Beweist, dass produktive Daten einen `api`-Neustart überleben.

```bash
# a) Initialen Admin sicherstellen — beim Container-Start automatisch angelegt,
#    wenn ADMIN_EMAIL/ADMIN_PASSWORD in .env.production gesetzt sind (idempotent).
#    Manuell erneut anstoßen (z. B. nach späterem Setzen der Variablen):
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  exec api npm run seed:admin
#    Erwartung: "Admin angelegt: …" bzw. "Admin existiert bereits: …" (kein Passwort im Log)

# b) Login + Ticket anlegen (E-Mail/Passwort = ADMIN_EMAIL/ADMIN_PASSWORD)
TOKEN=$(curl -k -s -X POST https://soc.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@firma.de","password":"StrongPass123!"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')

curl -k -s -X POST https://soc.example.com/api/v1/tickets \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Persistenz-Test","priority":"low"}'

# c) api NEU STARTEN
docker-compose -f deploy/docker-compose.prod.yml restart api
sleep 8

# d) Erneut einloggen (User überlebt) + Ticket noch da?
TOKEN=$(curl -k -s -X POST https://soc.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@firma.de","password":"StrongPass123!"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')

curl -k -s https://soc.example.com/api/v1/tickets \
  -H "Authorization: Bearer $TOKEN"
# Erwartet: Login erfolgreich + das "Persistenz-Test"-Ticket ist in der Liste.
```

Wenn Login **und** Ticket nach dem Restart noch da sind, ist die Postgres-Persistenz
korrekt scharf.

### 6. Webhook-Test (mit korrektem HMAC)

```bash
TIMESTAMP=$(date +%s)
BODY='{"title":"Smoke Test Webhook","priority":"low"}'
SECRET="IhrWebhookSecret"
SIG="sha256=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)"

curl -k -X POST https://soc.example.com/api/v1/integrations/generic/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -H "X-Webhook-Timestamp: $TIMESTAMP" \
  -d "$BODY"
# Erwartetes Ergebnis:
# HTTP 202 + {"status":"accepted","eventId":"..."}
```

---

## Tägliche Befehle

```bash
# Logs anzeigen
docker-compose -f deploy/docker-compose.prod.yml logs -f api

# Status
docker-compose -f deploy/docker-compose.prod.yml ps

# Neu starten (nach Update)
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up -d --build api

# Stoppen
docker-compose -f deploy/docker-compose.prod.yml down

# Frontend nach Update neu bauen
docker-compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production up -d --build web
```

---

## Backup & Restore (Postgres-Volume)

Alle persistenten Daten (Tickets, User, Audit, Hunts) liegen im Docker-Volume
`pgdata_prod`. **Sichern = logischer Dump UND/ODER Volume-Snapshot.**

### Logischer Dump (empfohlen, portabel)

```bash
# Backup
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" | gzip > soc_backup_$(date +%Y%m%d_%H%M).sql.gz

# Restore (in leere DB)
gunzip -c soc_backup_YYYYMMDD_HHMM.sql.gz | \
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"
```

### Volume-Snapshot (Dateiebene)

```bash
# Stoppen, damit das Volume konsistent ist
docker compose -f deploy/docker-compose.prod.yml down
# Volume in ein tar sichern
docker run --rm -v soc_pgdata_prod:/data -v "$PWD":/backup alpine \
  tar czf /backup/pgdata_$(date +%Y%m%d).tar.gz -C /data .
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```

> Auf **Proxmox** zusätzlich: VM-Snapshot vor Updates (`qm snapshot <vmid> pre-update`)
> und regelmäßige `vzdump`-Sicherung der VM. App-Backup (Dump) ≠ VM-Backup — beides nutzen.

### Tägliches Backup automatisieren (cron auf der VM)

```bash
# /etc/cron.d/soc-backup  (täglich 02:30)
30 2 * * * root cd /opt/SOC-Orchestrator && docker compose -f deploy/docker-compose.prod.yml \
  --env-file deploy/.env.production exec -T postgres pg_dump -U soc_api soc_tickets_prod \
  | gzip > /var/backups/soc/soc_$(date +\%Y\%m\%d).sql.gz
```

---

## Sicherheits-Checkliste

```
□ JWT_SECRET gesetzt, min. 64 Zeichen, kein Default
□ DB_PASSWORD gesetzt, min. 20 Zeichen, kein Default
□ WEBHOOK_SECRET gesetzt für alle aktiven Quellen
□ CORS_ORIGINS nur interne Domain (kein * oder localhost)
□ TLS-Zertifikat gültig, Private Key nur root lesbar (chmod 600)
□ Kein externer Zugriff auf Port 3000 (Firewall)
□ Kein externer Zugriff auf Port 5432 (Firewall)
□ deploy/.env.production NICHT im Git-Repository
□ NODE_ENV=production gesetzt
□ ADMIN_PASSWORD stark (min. 8, besser 16+); nach erstem Login Passwort im
  Frontend ändern und ADMIN_PASSWORD aus .env.production entfernen
□ Secrets rotieren, falls sie je sichtbar im Terminal/Log auftauchten
  (neu generieren → Container mit `up -d --force-recreate` neu erstellen)
```

> **Initialer Admin:** Beim ersten `up` legt der API-Container automatisch einen
> Admin aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` an — **idempotent**, d. h. nur wenn dieser
> Account noch nicht existiert. Das Passwort wird nie geloggt. Manuell anstoßbar via
> `docker compose … exec api npm run seed:admin`.
