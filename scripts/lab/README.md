# Nexora SOC Lab — One-Shot Deployer

Baut das komplette Lab (OPNsense · AD-Domain · Wazuh · SOC · Ollama · Kali)
in **idempotenten Phasen** vom Proxmox-Host aus. Jede Phase überspringt, was
schon existiert — abgebrochene Läufe einfach erneut starten.

> **Wichtig:** Läuft auf dem **Proxmox-Host als root**, nicht auf dem PC.
> Kopiere den Ordner `scripts/lab/` z.B. nach `/root/lab/`.

## Was automatisch geht — und was nicht

| Phase | Automatik | Manuelles Tor |
|---|---|---|
| `network` `storage` `isos` | ✅ voll | — |
| `opnsense` | VM-Erstellung ✅ | GUI-Erstkonfig (VLAN/DHCP/FW/Unbound) ⚠️ einmalig |
| `linux` (Wazuh/SOC/Ollama/Kali) | ✅ voll (cloud-init) | — |
| `windows` (DC01/WEC01) | ✅ unattended | — (autounattend.xml) |
| `ad` (Promotion/Join/WEC) | ✅ voll (guest-exec) | — |
| `verify` | ✅ voll | — |

Die zwei unvermeidbaren Handgriffe: **Windows-Server-ISO** vorab ablegen
(EvalCenter-Login) und **OPNsense-Erstkonfig** in der GUI (oder `config.xml`
nach `assets/opnsense-config.xml` legen → wird beim Tor angeboten).

## Quickstart

```bash
# 1. Auf Proxmox kopieren
scp -r scripts/lab root@<proxmox>:/root/lab && ssh root@<proxmox>

# 2. Tools (einmalig)
apt-get install -y genisoimage wget bzip2 dnsutils

# 3. Konfig prüfen — NIC-Namen sind kritisch!
ip link show                 # echte NIC-Namen
nano /root/lab/lab.conf      # BR_WAN_PORT / BR_LAN_PORT anpassen

# 4. Secrets setzen
cp /root/lab/secrets.env.example /root/lab/secrets.env
nano /root/lab/secrets.env   # Passwörter eintragen
set -a; source /root/lab/secrets.env; set +a

# 5. Windows-ISO ablegen (EvalCenter)
#    → /mnt/pve/VMStorage/template/iso/WinServer2022.iso

# 6. Los
cd /root/lab
./deploy-lab.sh all
```

## Phasenweise (empfohlen beim ersten Mal)

```bash
./deploy-lab.sh network storage isos   # Fundament
./deploy-lab.sh opnsense                # dann GUI konfigurieren
./deploy-lab.sh linux                   # Server hochziehen
./deploy-lab.sh windows                 # Windows installiert ~20 Min selbst
./deploy-lab.sh ad                      # wartet automatisch auf Guest-Agent
./deploy-lab.sh docs                     # Live-Doku DC01/WEC01 erzeugen
./deploy-lab.sh verify
```

## Auto-Doku (DC01 / WEC01) — immer aktuell

Die Phase `docs` fragt DC01 und WEC01 **live** ab (`qm guest exec`) und schreibt
[dc01-config.md](../../docs/07-operations/network/dc01-config.md) und
[wec01-config.md](../../docs/07-operations/network/wec01-config.md) neu: laufende Dienste,
DNS-Zonen/Forwarder, AD-/FSMO-Rollen, Netzwerk, WEC-Subscriptions, Wazuh-Agent.

Die Dateien sind **generiert — nie von Hand editieren.** Sie aktualisieren sich:

- **automatisch nach jeder AD-Änderung** (am Ende der Phase `ad`),
- **manuell** per `./deploy-lab.sh docs`,
- **periodisch** per Cron:

```bash
./install-doc-cron.sh install 15   # alle 15 Min spiegeln (+ auto-commit)
./install-doc-cron.sh status
./install-doc-cron.sh remove
```

`DOC_GIT_COMMIT=1` (in `lab.conf` oder vom Cron gesetzt) committet Änderungen
automatisch, wenn das Doku-Verzeichnis in einem Git-Repo liegt. Zielverzeichnis
steuert `DOC_OUT_DIR` (leer = `<repo>/docs/network`, sonst `generated-docs/`).

## Sicherheit

- **Keine Passwörter im Code** — alles aus `secrets.env` (in `.gitignore`).
- `autounattend-<vmid>.iso` enthält das lokale Admin-PW im Klartext. Nach dem
  Setup entfernen: `rm /mnt/pve/VMStorage/template/iso/autounattend-*.iso`.
- `ifreload -a` stoppt OPNsense vorher automatisch (Tap-Schutz, aus Lab-Erfahrung).
- Proxmox-Default-Gateway **muss** `10.99.98.1` sein (in `lab.conf` gesetzt).

## Dateien

```
scripts/lab/
├── deploy-lab.sh            Master-Orchestrator (Phasen-Auswahl)
├── install-doc-cron.sh      Cron fuer periodische Auto-Doku
├── lab.conf                 zentrale Konfiguration (IPs, VMIDs, ISOs)
├── secrets.env.example      Passwort-Template (→ secrets.env, nicht committen)
├── lib/common.sh            Logging, Guards, Idempotenz, guest-exec-Helfer
└── phases/
    ├── 10-network.sh        Bridges + MGMT-IP + NAS-Route
    ├── 15-opnsense.sh       OPNsense-VM + GUI-Checkliste
    ├── 20-storage.sh        NFS registrieren
    ├── 30-isos.sh           ISOs/Images laden
    ├── 40-linux-vms.sh      cloud-init VMs
    ├── 50-windows-vms.sh    autounattend Windows
    ├── 60-ad-domain.sh      AD-Promotion/Join/WEC (+ Auto-Doku)
    ├── 70-docs.sh           Live-Doku DC01/WEC01 → docs/07-operations/network/*.md
    └── 90-verify.sh         End-to-End-Checks
```

Referenz-Doku: [lab-build-guide.md](../../docs/07-operations/network/lab-build-guide.md) ·
[ad-lab-setup.md](../../docs/07-operations/network/ad-lab-setup.md) ·
[vlan-migration.md](../../docs/07-operations/network/vlan-migration.md)
```
