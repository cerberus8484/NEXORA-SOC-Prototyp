# Nexora SOC — Self-hosted Mailserver (docker-mailserver)

> Umsetzung von **ADR-037** (revidiert: Stalwart → docker-mailserver, weil Stalwart
> wizard-first ist und nicht headless automatisierbar — DMS ist voll über `setup`-CLI +
> Config-Dateien steuerbar). Liefert die zwei Schnittstellen, die Nexora nutzt:
> **SMTP** (Notification-Outbound, ADR-027) + **IMAP-Postfach** (Phishing-Ingest).
>
> **Status (2026-06-27):** LIVE auf Proxmox-CT 108 (`10.0.10.85`). Intern voll funktionsfähig,
> end-to-end verifiziert (Prod-`soc_api_prod` → SMTP → `soc@`-Postfach). Externe Zustellung
> via Smarthost = optionaler Folgeschritt.

---

## Was läuft

| Richtung | Nexora-Komponente | Mailserver |
|---|---|---|
| **Raus** (Alerts/NIS2/Lockout) | `notificationOutbound.js` | SMTP :25 → lokales Postfach `soc@` |
| **Rein** (Phishing → Ticket) | `imapPoller.js` | IMAP-Postfach `phishing@` (ENV in Prod noch setzen, s.u.) |

Konten: `notify@` (Absender) · `phishing@` (IMAP-Ingest) · `soc@` (Empfänger der Notifications).
Passwörter liegen in `./dms/config/postfix-accounts.cf` (gehasht) — Klartext bei Anlage gemerkt.

## Deploy (LXC auf Proxmox, Docker nesting=1,keyctl=1)
```bash
cd deploy/mailserver && docker compose up -d   # zieht ghcr.io/docker-mailserver/...
# Konten anlegen (headless, CLI):
docker exec nexora-mail setup email add notify@nexora.local   '<pw>'
docker exec nexora-mail setup email add phishing@nexora.local '<pw>'
docker exec nexora-mail setup email add soc@nexora.local      '<pw>'
# (optional, für später) DKIM:
docker exec nexora-mail setup config dkim
# Interner Smoke-Test:
docker exec nexora-mail swaks --server localhost:25 --from notify@nexora.local --to soc@nexora.local --body test
```

> **Stolpersteine (im Compose berücksichtigt):** Debian-LXC bringt **Postfix auf :25** mit
> (`systemctl disable --now postfix; systemctl mask postfix@-`); Container-**DNS** auf `1.1.1.1/8.8.8.8`
> (geerbter Resolver blockt aus dem Docker-Subnetz).

## Nexora verdrahten (Prod)
`/opt/SOC-Orchestrator/deploy/.env.production` auf VM 120 — **bereits gesetzt (2026-06-27):**
```bash
NOTIFICATIONS_OUTBOUND_ENABLED=true
NOTIFY_SMTP_HOST=10.0.10.85
NOTIFY_SMTP_PORT=25
NOTIFY_SMTP_SECURE=false        # intern kein TLS; Port 25 lokale Zustellung, keine Auth nötig
NOTIFY_EMAIL_FROM=notify@nexora.local
NOTIFY_EMAIL_TO=soc@nexora.local
```
Recreate: `cd deploy && bash soc.sh up -d api`. Danach im UI **„Test-Benachrichtigung senden"** (C3-UI).

## Offen
- **Phishing-Ingest (IMAP):** der Prod-Compose (`docker-compose.prod.yml`) reicht `IMAP_*`
  an die API durch. In `deploy/.env.production` noch setzen: `IMAP_HOST=10.0.10.85
  IMAP_PORT=143 IMAP_TLS=false IMAP_USER=phishing@nexora.local IMAP_PASSWORD=…`;
  danach API recreaten.
- **Externe Zustellung:** `SSL_TYPE` + Smarthost (`RELAY_HOST`/`RELAY_PORT` + `postfix-sasl-password.cf`)
  ergänzen — braucht Smarthost-Provider-Creds + reale Versanddomain (nexora.local stellt extern nicht zu).

## Betrieb
- `./dms/` (Konten, Mails, DKIM, State) **sichern**. Web-UI gibt es nicht (CLI-/Config-gesteuert).
- Admin/Verwaltung: `docker exec nexora-mail setup help`.
