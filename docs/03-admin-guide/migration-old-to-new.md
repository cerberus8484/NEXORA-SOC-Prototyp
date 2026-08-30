# Migration: Nexora SOC vom alten auf den neuen Host (mit Daten)

> Umzug einer **produktiven** Nexora-Installation (echte Tickets/User/Audit) vom alten
> Proxmox-Host auf einen frischen **Proxmox-9-Host** — eigenständig (kein Cluster).
> Stop-alt/Start-neu mit kontrolliertem Cutover. Cluster-Aufbau ist ein **separater
> Schritt danach** (siehe Entscheidung: erst Umzug, dann clustern).

---

## ⚠️ Zwei goldene Regeln (sonst geht Daten/Config verloren)

1. **Backup-Passphrase mitnehmen.** Die Backups sind AES-256-verschlüsselt. Ohne
   `~/.soc_backup_pass` vom **alten** Host sind sie **unwiederherstellbar**. Diese Datei
   zuerst sichern und auf den neuen Host bringen.
2. **Secret-Kontinuität — die alte `.env.production` mitnehmen, NICHT neu generieren.**
   Verschlüsselte Einstellungen in der DB (OIDC-Config, Integrations-Credentials …) sind
   mit dem alten `SETTINGS_ENC_KEY` bzw. `JWT_SECRET` verschlüsselt (`secretsCrypto.js`).
   Ein **neuer** JWT_SECRET macht sie unlesbar. Außerdem hängen Webhook-Secrets
   (`WEBHOOK_SECRET_*`) und der Audit-IP-Hash (`AUDIT_IP_SALT`) an diesen Werten.
   → Beim Datenumzug die **alte `.env.production` kopieren** und nur Host-Spezifisches
   anpassen (`CORS_ORIGINS` = neue Domain). **Nicht** `gen-env-production.sh` nutzen —
   das ist nur für eine echte Neuinstallation ohne Altdaten.

---

## Voraussetzungen
- Neuer Host: Proxmox 9, VM mit Linux (Docker + Docker Compose v2 + git + openssl + curl).
- Netzwerkzugang vom neuen Host zum GitHub-Repo.
- Vom alten Host griffbereit: aktuelles Backup, `~/.soc_backup_pass`, `deploy/.env.production`.

---

## Schritt für Schritt

### 1. Auf dem ALTEN Host — frisches Backup + Secrets sichern
```bash
cd /opt/SOC-Orchestrator
./deploy/backup-db.sh                       # erzeugt ~/backups/soc/soc-<TS>.sql.gz.enc
ls -t ~/backups/soc/*.sql.gz.enc | head -1  # neueste Datei merken
```
Diese drei Dinge auf den neuen Host übertragen (z. B. per `scp`):
- das neueste `soc-<TS>.sql.gz.enc`
- `~/.soc_backup_pass`  (die Passphrase!)
- `deploy/.env.production`  (Secret-Kontinuität!)

### 2. Auf dem NEUEN Host — vorbereiten + Repo klonen + alte Secrets einsetzen
Auf einer **frischen** VM nimmt der Bootstrap die Host-Vorbereitung (Docker + Tools) und
das Klonen ab:
```bash
# Einmalig auf der frischen Debian/Ubuntu-VM (Proxmox 9): Docker + Tools + Repo
curl -fsSL <repo-raw>/deploy/proxmox-vm-bootstrap.sh -o /tmp/bootstrap.sh   # oder Repo manuell klonen
sudo bash /tmp/bootstrap.sh --repo <repo-url> --branch main
```
Manuell geht es weiterhin auch:
```bash
sudo git clone <repo-url> /opt/SOC-Orchestrator
sudo chown -R "$USER:$USER" /opt/SOC-Orchestrator
cd /opt/SOC-Orchestrator
cp /pfad/zur/uebertragenen/.env.production deploy/.env.production
chmod 600 deploy/.env.production
# Nur Host-Spezifisches anpassen, falls die Domain/IP sich ändert:
#   CORS_ORIGINS=https://<neue-domain>
cp /pfad/zur/.soc_backup_pass ~/.soc_backup_pass && chmod 600 ~/.soc_backup_pass
```

### 3. Stack hochfahren (nutzt die vorhandene .env.production unverändert)
> **Vorab (empfohlen):** `./deploy/preflight-check.sh --restore-file ~/backups/soc/soc-<TS>.sql.gz.enc`
> Read-only — prüft Tools/Docker, dass die kopierte `.env.production` keine `CHANGE_ME`-Reste
> hat, dass die **Backup-Passphrase lesbar** und das **Archiv mit ihr entschlüsselbar** ist
> (Probe-Decrypt, ohne echten Restore), dass die Ports 80/443 frei sind und genug Platz da ist.
> Erst bei „PREFLIGHT GRÜN" weiter.
```bash
./deploy/install-prod-fresh.sh --domain <neue-domain>
# Da deploy/.env.production schon existiert, wird sie NICHT überschrieben.
# Self-signed TLS wird erzeugt, falls die Zert-Pfade leer sind.
```
Der Stack startet mit leerer DB (Migrationen + Admin-Seed laufen) — diese leere DB wird im nächsten Schritt durch die Altdaten **ersetzt**.

### 4. Altdaten einspielen
```bash
./deploy/restore-db.sh --file ~/backups/soc/soc-<TS>.sql.gz.enc
# Bestätigung 'RESTORE'. Stoppt API, ersetzt DB, startet API (führt neuere
# Migrationen idempotent aus, z. B. 047 must_change_password).
```

### 5. Verifizieren
```bash
./deploy/soc.sh health         # {status:ok, db:ok}
./deploy/soc.sh logs api | tail -30
```
- Login mit den **alten** Zugangsdaten (die Konten kommen aus dem Backup).
- Stichprobe: Ticket-Anzahl plausibel? Settings/Integrationen sichtbar (Secret-Kontinuität ok)?

### 6. Data-Plane (Korrelator + Kollektoren) — optional, falls genutzt
**Variante A — Konfig vom alten Host übernehmen** (1:1-Umzug der bestehenden Quellen):
```bash
cd deploy/nexora-intake
cp /pfad/zur/nexora-intake/.env .env           # Collector-Creds + DATAPLANE_WEBHOOK_SECRET
cp /pfad/zur/nexora-intake/hub.config.json .   # Hub-Config (operator-privat)
cp -r /pfad/zur/nexora-intake/keys ./keys      # read-only SSH-Keys zu den Quellen
docker compose up -d --build
```
**Variante B — frisches Scaffold per Installer** (neue Quellen):
```bash
cd deploy/nexora-intake
./install-dataplane.sh        # erzeugt .env (Secrets), hub.config.json (Vorlage), keys/collector
# Übernimmt DATAPLANE_WEBHOOK_SECRET aus ../​.env.production (Backend-Kontinuität).
# Danach: hub.config.json mit echten Quell-Hosts füllen + keys/collector.pub auf den Quellen installieren.
docker compose up -d --build
```

### 7. Cutover
- Quellen (Wazuh/SIEM/Firewalls) auf den neuen Host umstellen ODER die alte IP/Domain
  auf den neuen Host umziehen (DNS/Reverse-Proxy). Webhook-Secrets sind dank
  Secret-Kontinuität identisch — **keine Neukonfiguration der Quellen nötig**.
- Erst wenn der neue Host live verifiziert ist: alten Nexora-Stack stoppen
  (`./deploy/soc.sh down` auf dem alten Host).

---

## Rollback (wenn etwas schiefgeht)
Der **alte** Host bleibt bis zum erfolgreichen Cutover unangetastet und live. Geht auf
dem neuen Host etwas schief: einfach beim alten bleiben (oder dorthin zurückzeigen) —
es wurde nichts am alten gelöscht. Der neue Host lässt sich beliebig neu aufsetzen.

## Backup-Cron auf dem neuen Host (nicht vergessen)
Die Cron-Jobs (`backup-db.sh` 03:30, `prune-audit-log.sh` 03:45) sind hostspezifisch und
ziehen NICHT automatisch mit. Auf dem neuen Host neu einrichten:
```bash
crontab -e
# 30 3 * * * cd /opt/SOC-Orchestrator && ./deploy/backup-db.sh >> /home/<user>/backups/soc/backup.log 2>&1
# 45 3 * * * cd /opt/SOC-Orchestrator && ./deploy/prune-audit-log.sh >> /home/<user>/backups/soc/audit-retention.log 2>&1
```

---

## Danach: Cluster (separater Schritt)
Erst wenn der neue Host stabil läuft: alten Host **Proxmox 8 → 9** upgraden, dann beide
in einen Cluster (corosync), **NAS-NFS als shared Storage**, und eine **dritte
Quorum-Stimme** extern (das NAS kann kein QDevice → kleiner Raspberry Pi mit
`corosync-qnetd`). Details: Cluster-Entscheidung im Projekt-Memory.
