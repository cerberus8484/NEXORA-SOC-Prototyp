# QRadar-Integration — Go-Live-Checkliste (Operator)

Die QRadar-Integration ist **im Code fertig** (Offense→Ticket-Webhook, Dedup,
Dashboard-REST). Was hier beschrieben wird, sind die **operativen Schritte mit echten
Credentials** — die können nicht im Code passieren, sondern nur durch dich auf dem
Produktiv-Host und in QRadar selbst.

> **Datenfluss:**
> QRadar Offense → (QRadar-seitiges Forwarding/Skript, HMAC-signiert)
> → `POST /api/v1/integrations/qradar/webhook` → HMAC-Prüfung → Adapter
> (validieren → normalisieren) → `QRadarProcessor` → Ticket (create/update, dedupliziert)
> → Audit-Log.

Verifizierte Quellen im Code:
`backend/src/routes/integrations.js`, `backend/src/integrations/hmac.js`,
`backend/src/server.js`, `backend/src/integrations/adapters/qradar/*`,
`backend/src/config/index.js` (`api.prefix = /api/v1`).

---

## Relevante Umgebungsvariablen (im Code verifiziert)

| Variable | Zweck | Gelesen in | Pflicht für … |
|---|---|---|---|
| `WEBHOOK_SECRET_QRADAR` | HMAC-Secret für eingehende QRadar-Webhooks | `routes/integrations.js` (`WEBHOOK_SECRET_${source.toUpperCase()}`) | Offense→Ticket-Pfad |
| `QRADAR_HOST` | aktiviert die Registrierung des `QRadarProcessor` beim Boot | `server.js` | Offense→Ticket-Pfad (Worker) |
| `QRADAR_BASE_URL` | Basis-URL der QRadar-REST-API + Deep-Links in Tickets | `adapters/qradar/QRadarDashboardProvider.js`, `QRadarAdapter.js` | Dashboard-Pull / Offense-Links |
| `QRADAR_TOKEN` | QRadar API-Token (SEC-Header, **nicht** User/Passwort) | `QRadarDashboardProvider.js` (`_authHeaders → { SEC: ... }`) | Dashboard-Pull (`/api/v1/qradar/*`) |

Hinweise:
- **Offense→Ticket** braucht `WEBHOOK_SECRET_QRADAR` (HMAC) **und** `QRADAR_HOST`
  (sonst wird der `QRadarProcessor` beim Start nicht registriert — der Webhook würde
  zwar HMAC-geprüft, aber es liefe kein Verarbeiter dafür).
- **Dashboard-Pull** (`GET /api/v1/qradar/stats|offenses`) ist erst aktiv, wenn
  `QRADAR_BASE_URL` **und** `QRADAR_TOKEN` gesetzt sind (`isEnabled()` prüft genau das).
- Fehlt `WEBHOOK_SECRET_QRADAR`, fällt der Webhook auf `WEBHOOK_SECRET_GENERIC` zurück
  (falls gesetzt) — für Produktion **explizit** ein QRadar-eigenes Secret setzen.

---

## Schritt 1 — ENV setzen *(Operator, echte Credentials)*

In `deploy/.env.production` ergänzen (Werte sind Platzhalter — durch echte ersetzen,
**niemals committen**):

```ini
# Offense → Ticket (Webhook)
WEBHOOK_SECRET_QRADAR=<langes-zufaelliges-secret>     # gleicher Wert wie QRadar-seitig
QRADAR_HOST=qradar.example.internal                   # nur Trigger zum Registrieren des Processors

# Optional: Dashboard-Pull / Offense-Deep-Links
QRADAR_BASE_URL=https://qradar.example.internal
QRADAR_TOKEN=<qradar-api-token-SEC-header>
```

Secret erzeugen, z. B.:

```bash
openssl rand -hex 32
```

Container mit neuer Konfiguration neu starten:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
  up -d --force-recreate api
```

Registrierung verifizieren (Log-Zeile muss erscheinen):

```bash
docker logs soc_api_prod | grep integration_processor_registered
# erwartet: {"source":"qradar","host":"qradar.example.internal", ...}
```

---

## Schritt 2 — QRadar-seitiges Forwarding konfigurieren *(Operator, in QRadar)*

QRadar muss neue/aktualisierte Offenses an unseren Endpoint POSTen und dabei die
HMAC-Header mitschicken. Das geht typischerweise über eine **Custom Action / ein
Forwarding-Skript**, das bei einer Offense-Rule-Response ausgelöst wird.

**Ziel-Endpoint:**

```
POST https://<nexora-host>/api/v1/integrations/qradar/webhook
Content-Type: application/json
X-Webhook-Timestamp: <unix-sekunden>
X-Webhook-Signature: sha256=<hmac>
```

**HMAC-Berechnung (muss exakt so sein, sonst 401):**
HMAC-SHA256 über die Zeichenkette `"<timestamp>.<rawBody>"` mit `WEBHOOK_SECRET_QRADAR`
als Schlüssel; Ergebnis hex-codiert, mit Präfix `sha256=`. Der `timestamp` ist
identisch mit dem `X-Webhook-Timestamp`-Header.

> **Replay-Schutz:** Der Timestamp darf max. **300 s** alt (und max. 60 s in der Zukunft)
> sein — die sendende Seite muss eine korrekte Uhr haben (NTP).

Referenz-Signatur in Bash (zum Testen / als Vorlage fürs QRadar-Skript):

```bash
SECRET='<WEBHOOK_SECRET_QRADAR>'
TS=$(date +%s)
BODY='{"id":999001,"description":"Go-Live Test Offense","severity":7,"magnitude":6}'
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
```

Den erwarteten Payload-Aufbau (Pflichtfelder) liefert
`backend/src/integrations/adapters/qradar/qradarSchemas.js` (`offensePayloadSchema`) —
die QRadar-Felder dort spiegeln, da der Adapter sonst `400 ValidationError` wirft.

---

## Schritt 3 — Verifikation: Test-Offense → Ticket

Eine Test-Offense an den Endpoint senden (Variablen aus Schritt 2):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<nexora-host>/api/v1/integrations/qradar/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Timestamp: $TS" \
  -H "X-Webhook-Signature: $SIG" \
  --data "$BODY"
```

Erwartete Antworten:

| HTTP | Bedeutung |
|---|---|
| `202` | Event angenommen → Ticket wird erstellt/aktualisiert |
| `200` | Duplikat erkannt (gleiche Offense erneut) → bestehendes Ticket wurde aktualisiert |
| `400` | Payload ungültig (Pflichtfeld fehlt / Schema) |
| `401` | HMAC fehlt/falsch oder Timestamp zu alt |
| `404` | Quelle unbekannt (Pfad falsch) |

Erfolg gegenprüfen:

- **Log:** `docker logs soc_api_prod | grep qradar_ticket_created` (bzw.
  `qradar_ticket_updated` beim zweiten, identischen Send).
- **UI/API:** Ticket mit `source = qradar` und der erwarteten `offenseId`
  (`qradar:offense:<id>`) erscheint in der Ticket-Liste.
- **Audit-Log:** Eintrag `QRADAR_TICKET_CREATED` bzw. `QRADAR_TICKET_UPDATED`.

Dedup-Test: dieselbe Offense ein zweites Mal senden → Antwort wird zu `200`/Update,
`alertCount` am Ticket erhöht sich (kein zweites Ticket). Das gilt **restart-sicher**,
weil gegen die Tickets-Tabelle dedupliziert wird, nicht gegen In-Memory-State.

Optional (nur wenn `QRADAR_BASE_URL` + `QRADAR_TOKEN` gesetzt): Dashboard-Pull testen
(authentifizierter Aufruf mit gültigem Nexora-Login/JWT):

```bash
curl -s -H "Authorization: Bearer <jwt>" "https://<nexora-host>/api/v1/qradar/stats"
```

---

## Rollback

QRadar-Anbindung ohne Code-Änderung deaktivieren:

1. **QRadar-seitig** das Forwarding (Custom Action / Rule-Response) anhalten — keine
   neuen POSTs mehr.
2. In `deploy/.env.production` `QRADAR_HOST` (und optional `QRADAR_BASE_URL`,
   `QRADAR_TOKEN`) entfernen/auskommentieren → beim nächsten Neustart wird der
   `QRadarProcessor` nicht mehr registriert.
3. Container neu starten:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production \
     up -d --force-recreate api
   ```
4. Bei kompromittiertem Secret: `WEBHOOK_SECRET_QRADAR` **rotieren** (neuen Wert hier
   **und** in QRadar setzen) — eingehende Webhooks mit altem Secret werden danach mit
   `401` abgewiesen.

Bereits erzeugte QRadar-Tickets bleiben erhalten; ohne registrierten Processor werden
nur keine neuen mehr verarbeitet.

---

## Was reiner Operator-Schritt ist (nicht im Code lösbar)

- Setzen der echten Secrets/Tokens in `deploy/.env.production` (kein Secret im Repo).
- QRadar-seitiges Forwarding inkl. korrekter HMAC-Signierung (passiert in QRadar).
- NTP/Uhr-Synchronität der sendenden QRadar-Seite (wegen 300-s-Replay-Fenster).
- TLS-Terminierung/Erreichbarkeit des Endpoints `https://<nexora-host>/api/v1/...`.
