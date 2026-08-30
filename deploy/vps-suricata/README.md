# VPS-Suricata Collector — IDS-Domäne (dritte Cross-Domain-Quelle)

Bringt die **IDS-Domäne** auf denselben Honeypot-VPS. Ein Suricata-Alert für eine Angreifer-IP setzt
in der Fusion `hasIdsAlert=true` — zusammen mit einem SIEM-`high` (Cowrie) oder einem Firewall-Block
ergibt das **`confirmed_malicious`** (höchstes Verdikt). Bewusst schlank: EINE Regel, knappe memcaps,
kein ET-Open-Ruleset (für 1-Core/kleinen RAM).

> Platzhalter — keine realen IPs/Hosts/Token im Repo.

| Platzhalter | Bedeutung |
|---|---|
| `<HONEYPOT_PUBLIC_IP>` | Honeypot-IP = `HOME_NET` + `ASSET_IPS` (Kopplung ans selbe IP-Paar) |
| `<INTAKE_TUNNEL_IP>` | Intake über den Tunnel (NICHT öffentlich), Port 8081 |
| `<CAPTURE_IFACE>` | Capture-Interface (z.B. `ens6`, `ip -o -4 route show default`) |

## Komponenten
- `nexora.rules` — eine SSH-SYN-Regel (sid 9000001) → Alert je neuer Verbindung.
- `suricata-nexora.service` — schlanke Suricata-Instanz (root, Capture-Pflicht), liest die Regel exklusiv, schreibt `/var/log/suricata/eve.json`.
- `suricata-collector.service` — non-root Collector (`COLLECTOR_KIND=suricata`), tailt `eve.json` → Intake.
- `seed-vps-suricata-collector.sql` — Collector-Identität `vps-suricata` (network_sensor) + Credential-Hash.

## Rollout
```sh
apt-get install -y suricata
systemctl disable --now suricata            # mitgeliefertes Default-Service aus
cp nexora.rules /etc/suricata/nexora.rules
# Units mit ersetzten Platzhaltern nach /etc/systemd/system/, dann:
systemctl daemon-reload && systemctl enable --now suricata-nexora
# Credential (Token lokal, nur Hash ins Lab):
TOKEN=$(openssl rand -hex 32)
printf 'COLLECTOR_CREDENTIAL=%s\n' "$TOKEN" > /etc/nexora/suricata-collector.env
chown nexora:nexora /etc/nexora/suricata-collector.env && chmod 600 /etc/nexora/suricata-collector.env
printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1     # -> <hash>
psql "$DATAPLANE_DB_URL" -v VPS_SURICATA_HASH=<hash> -f seed-vps-suricata-collector.sql
systemctl enable --now suricata-collector
```

## Ressourcen-Hinweis
Auf 1 Core / ~1 GB RAM mit dieser einen Regel: Suricata-RSS ~30 MB. Vor dem Aktivieren `free -m`
prüfen; bei Bedarf memcaps in `suricata-nexora.service` weiter senken.

## Rollback
```sh
systemctl disable --now suricata-collector suricata-nexora
rm -f /etc/systemd/system/suricata-nexora.service /etc/systemd/system/suricata-collector.service \
      /etc/nexora/suricata-collector.env
apt-get remove -y suricata
psql "$DATAPLANE_DB_URL" -c "UPDATE collector_credentials SET status='revoked', revoked_at=now() \
  WHERE collector_id='33333333-3333-3333-3333-3333333300f3';"
```
