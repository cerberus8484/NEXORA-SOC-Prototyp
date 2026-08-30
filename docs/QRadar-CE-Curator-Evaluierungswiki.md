# QRadar CE / Curator Evaluierungswiki

> Privatdokumentation fuer Evaluierung, Installation, Betrieb, Use Cases und Nachweisfuehrung.
> Stand: 2026-07-08

## Zweck

Dieses Wiki dokumentiert die komplette QRadar-Community-/Curator-Evaluierung so, dass:

- jeder Installationsschritt nachvollziehbar bleibt
- alle kritischen Entscheidungen und Abweichungen festgehalten werden
- Screenshots und operative Belege strukturiert abgelegt werden
- spaetere Use-Case-Erstellung und Demo-Vorbereitung reproduzierbar bleibt
- die Doku professionell genug fuer interne Arbeits- und Uebergabekontexte ist

## Scope

Diese Seite deckt ab:

- Proxmox-Bereitstellung
- VM-Design und Ressourcen
- Installer-/Boot-Besonderheiten
- QRadar-Community-/Curator-Grundinstallation
- Nacharbeiten nach der Installation
- Basis-Haertung und Netzwerkkonfiguration
- Evaluierungs-Use-Cases
- Dokumentations- und Screenshot-Nachweise

## Aktuelle Zielumgebung

### Proxmox

- Cluster-/Host-Kontext:
  - `192.168.0.100` = Proxmox-Host `proxmox`
  - `192.168.0.101` = Proxmox-Node `pve`
- Shared Storage:
  - `nas-backup`
- Produktives Server-VLAN:
  - `vmbr10`

### QRadar-VM

- VMID: `180`
- Name: `QRadar-AIO`
- Node: `pve`
- CPU: `8 vCPU`
- RAM: `32 GB`
- Disk: `300 GB`
- Netzwerk: `virtio` an `vmbr10`
- Boot-Medium:
  - `fastbackup:iso/760-QRADAR-QRFULL-2026.4.0.20260621205226.iso`

## Warum diese Platzierung

Die VM wurde **nicht** auf dem Node `proxmox` fertig aufgebaut, weil dort der freie schnelle Storage
fuer eine saubere QRadar-Installation zu knapp war. Der Node `pve` hat die deutlich bessere Reserve
fuer diese Evaluierungs-VM.

## Chronologischer Installationsstand

### 2026-07-07 - Vorbereitung und VM-Bereitstellung

Erledigt:

1. QRadar-ISO auf Proxmox gefunden:
   - `760-QRADAR-QRFULL-2026.4.0.20260621205226.iso`
2. ISO auf Shared Storage kopiert:
   - Ziel: `nas-backup/template/iso/`
3. QRadar-VM `180` auf Node `pve` angelegt
4. ZFS-Disk-Referenzfehler behoben
5. Serielle Konsole aktiviert:
   - `serial0: socket`
   - `vga: serial0`
6. Installer-Screen erfolgreich erreicht

### Aktueller Installer-Status

Gesehener Screen:

- Warnung, dass vorhandene Partitionen erkannt wurden
- Optionen:
  - `HALT`
  - `REBOOT`
  - `FLATTEN`
  - `WIPE`

Bewertung:

- Fuer diese dedizierte, neu angelegte Evaluierungs-VM ist `FLATTEN` der korrekte Standardpfad.
- `WIPE` waere nur noetig, wenn eine vollstaendige tiefere Loeschung aller erkannten Datentraeger
  ausdruecklich gewuenscht ist.

### Wichtige Erkenntnis 2026-07-07

Der Installer-Screen erschien mehrfach hintereinander. Ursache war **nicht** ein falscher
Installer-Schritt, sondern die Proxmox-Boot-Reihenfolge:

- vorher: `boot: order=ide2`
- Bedeutung: VM bootete nach jedem Reboot wieder vom ISO
- Korrektur: `boot: order=scsi0`

Bewertung:

- `FLATTEN` war korrekt
- die VM muss nach dem Installationsschritt anschliessend von der Systemdisk booten
- ISO kann fuer spaetere Reparaturzwecke eingehangen bleiben, darf aber nicht mehr erstes Bootgeraet sein

### Zusatzerkenntnis 2026-07-07

Die reine Aenderung der Boot-Reihenfolge auf `scsi0` hat die Schleife noch nicht sichtbar genug
gebrochen, solange das ISO weiter eingehangen blieb. Deshalb wurde zusaetzlich:

- das CD-ROM (`ide2`) aus der VM-Konfiguration entfernt
- die VM sauber neu gestartet

Finaler Zustand danach:

- `boot: order=scsi0`
- kein ISO mehr an `ide2`
- VM `180` laeuft nur noch von der Systemdisk

### Konsolenanpassung 2026-07-07

Die serielle Konsole zeigte nur:

- `starting serial terminal on interface serial0`

ohne weiteren nutzbaren Output. Deshalb wurde die VM fuer die weitere Installation
wieder auf normale grafische Proxmox-Konsole umgestellt:

- `vga: std`
- `serial0` entfernt

Aktueller Konsolenpfad fuer die weitere Arbeit:

- normale Proxmox-/noVNC-Konsole der VM `180`

### Partitionsfehler / Root Cause 2026-07-07

Im Anaconda-Textinstaller schlug `Installation Destination` fehl mit:

- `Unable to allocate requested partition scheme.`

Beobachtung im Installer:

- Zielplatte: `QEMU HARDDISK 300 GiB (sda)`
- effektiv frei fuer den Installer: `243.46 GiB`

Bewertung:

- Die VM-Disk ist fuer den angeforderten QRadar-Partitionierungsplan effektiv zu klein.
- Der nominelle Proxmox-Wert `300G` reicht hier nicht sauber, weil Installer-/Dateisystem-/LVM-
  Reserve und die Umrechnung `GB -> GiB` den effektiv nutzbaren Platz reduzieren.
- Der Fehler ist damit kein Bedienfehler im Installer, sondern ein Kapazitaetsproblem der VM.

Entscheidung:

- VM-Disk vergroessern statt im Installer weiter herumzudruecken.
- Fuer die Evaluierung konservativ auf mindestens `500 GB` erweitern, damit die Installation
  reproduzierbar durchlaeuft und spaetere Nacharbeiten nicht direkt am Platzlimit scheitern.

### Umsetzung 2026-07-07

Die VM bekam zunaechst versehentlich **zwei** Platten:

- alte Platte: `scsi0` mit `300G`
- neue Platte: `scsi1` mit `550G`

Damit der Installer nicht zwischen zwei Zielplatten verwechselt oder weiter die zu kleine Platte
bewertet, wurde die VM bereinigt:

- `scsi0` aus der aktiven VM-Konfiguration entfernt
- `scsi1` als einziges Boot-Ziel gesetzt
- Boot-Reihenfolge: `boot: order=scsi1`

Aktiver Zustand danach:

- produktive Zielplatte fuer die Installation: `scsi1` / `550G`
- alte `300G`-Disk nur noch als `unused0` referenziert

### ISO erneut eingehangen 2026-07-07

Fuer die eigentliche Installation wurde die QRadar-ISO wieder an die VM angehaengt.

Aktive Konstellation:

- Boot-Reihenfolge: `ide2;scsi1`
- Installationsmedium: `ide2`
- Zielplatte fuer die Installation: `scsi1` / `550G`
- alte `300G`-Disk bleibt nur als `unused0` ausserhalb der aktiven Installation

Wichtiger Unterschied zu vorher:

- diesmal existiert nur **eine** aktive System-Zielplatte fuer den Installer
- die fruehere zu kleine `300G`-Disk ist nicht mehr als aktive Installationsdisk eingebunden

### ISO wieder entfernt 2026-07-07

Auf ausdruecklichen Wunsch wurde das Installationsmedium wieder entfernt.

Aktiver Zustand danach:

- kein `ide2` mehr in der aktiven VM-Konfiguration
- Boot-Reihenfolge: `boot: order=scsi1`
- einzige aktive Platte: `scsi1` / `550G`
- alte `300G`-Disk bleibt nur als `unused0`

### Installationsabschluss / erster Boot 2026-07-07

Die Installation ist erfolgreich bis zum ersten System-Login durchgelaufen.

Beobachtete Hinweise auf dem Screen:

- `Installed QRadar version 7.6.0.0 GA`
- Logdatei:
  - `/var/log/setup-2026.4.0.20260621205226/qradar_setup.log`
- Hinweis des Installers:
  - falls noch kein Admin-Passwort gesetzt wurde:
    `sudo /opt/qradar/support/changePasswd.sh -a`
- System endet am Prompt:
  - `localhost login:`

Bewertung:

- QRadar/Curator ist grundsaetzlich installiert.
- Der naechste Block ist jetzt:
  - lokaler Login
  - Admin-Passwort setzen/pruefen
  - Netzwerk/IP pruefen
  - GUI-Erstzugriff testen

### Sonderfall: kein lokaler Login bekannt

In dieser Evaluierung wurde waehrend der automatisierten Installation **kein bewusst gesetzter lokaler
OS-Login** dokumentiert. Dadurch ist am Prompt `localhost login:` kein sicher bekannter Account
vorhanden.

Sauberer Recovery-Pfad:

1. VM rebooten
2. im GRUB-Menue den Linux-Eintrag bearbeiten
3. an die Kernel-Zeile `rd.break` anhaengen
4. in der Rescue-Shell Root-Dateisystem beschreibbar mounten
5. `chroot` in `/sysroot`
6. Root-Passwort setzen
7. `/.autorelabel` setzen
8. rebooten

Ziel:

- bekannter lokaler `root`-Login fuer die VM
- danach QRadar-Admin-Passwort getrennt ueber
  `sudo /opt/qradar/support/changePasswd.sh -a`

## Operativer Zugriff

### Proxmox GUI

- Proxmox Web:
  - `https://192.168.0.100:8006/`
- Relevanter Node:
  - `pve`
- Relevante VM:
  - `180 QRadar-AIO`

### Shell-Zugriff

- Proxmox Host:
  - `ssh root@192.168.0.100`
- QRadar-Node direkt:
  - `ssh root@192.168.0.101`

## Dokumentationsregeln ab jetzt

Ab diesem Punkt wird jeder relevante Schritt in diesem Wiki nachgezogen:

- Installer-Schritte
- Netzwerk- und IP-Konfiguration
- Benutzer-/Passwort-Setups
- Dienste-/Health-Pruefungen
- UI-Erstzugriff
- Use-Case-Erstellung
- Aenderungen an Regeln, Referenzsets, Offense-Handling oder Integrationen

## Screenshot-Nachweise

Fuer jeden groesseren Meilenstein sollen Screenshots gesammelt werden:

1. Proxmox-VM-Konfiguration
2. Installer-Start
3. `FLATTEN`-/Installationsschritt
4. Netzwerkkonfiguration
5. Erstlogin QRadar
6. System-/License-/Status-Ansichten
7. Erste Use-Case-/Rule-Objekte
8. Offense-/Event-Sichten

Empfohlene Ablage:

- `Z:\Papa_IT_Dokumentation\Doku\assets\qradar-ce-eval\`

## Nachweisblock / Evidence Log

### Evidence 001 - ISO vorhanden

- Ort:
  - `nas-backup/template/iso/760-QRADAR-QRFULL-2026.4.0.20260621205226.iso`
- Status:
  - bestaetigt

### Evidence 002 - VM angelegt

- VMID:
  - `180`
- Node:
  - `pve`
- Status:
  - bestaetigt

### Evidence 003 - Installer erreicht

- Installer-Warnscreen mit `FLATTEN`-/`WIPE`-Auswahl sichtbar
- Status:
  - bestaetigt

### Evidence 004 - Root Cause fuer QRadar-Netzsetup isoliert

- Zugriff:
  - Host-seitig per `ssh root@192.168.0.101`
  - QRadar-Disk read-only via `guestmount`
- Bestaetigter Fehler in
  - `/var/log/setup-2026.4.0.20260621205226/qradar_netsetup.log`
- Relevante Exception:
  - `IsADirectoryError: [Errno 21] Is a directory: '/etc/resolv.conf'`
- Bedeutung:
  - `qradar_netsetup.py` scheiterte nicht primaer an VGA oder noVNC, sondern daran, dass
    `/etc/resolv.conf` im Gast als Verzeichnis statt als Datei vorlag
- Status:
  - bestaetigt

### Evidence 005 - Host-seitiger Repair ausgefuehrt

- VM:
  - `180`
- Repair-Pfad:
  1. VM sauber gestoppt
  2. Systemdisk host-seitig per `guestmount` eingehangen
  3. fehlerhaftes Verzeichnis
     - `/etc/resolv.conf`
     nach
     - `/etc/resolv.conf.dir-backup-20260707`
     verschoben
  4. neue Datei `/etc/resolv.conf` erstellt mit:
     - `search nexora.local`
     - `nameserver 10.0.10.1`
  5. Hostname/FQDN vereinheitlicht auf:
     - `qradarce.nexora.local`
  6. `/etc/hosts` vereinheitlicht auf:
     - `10.0.10.90 qradarce.nexora.local qradarce`
  7. VM wieder gestartet
- Status:
  - abgeschlossen

### Evidence 006 - Direkter Root-SSH-Zugang host-seitig wiederhergestellt

- Ursache:
  - Gast hatte keinen nutzbaren Remote-Zugang fuer mich
  - `PermitRootLogin` war erlaubt, aber es fehlte ein verwertbarer Host-seitiger Zugang
- Host-seitige Schritte:
  1. QRadar-Disk per `guestmount` eingehangen
  2. `root`-SSH-Key in `/root/.ssh/authorized_keys` injiziert
  3. Auth-Dateien repariert:
     - `/etc/passwd` Root-Eintrag wieder auf Shadow-Nutzung (`x`) gesetzt
     - `/etc/shadow` aus `/etc/shadow-` wiederhergestellt
     - temporaerer Root-Notfallzugang gesetzt
- Ergebnis:
  - direkter Root-SSH-Zugang auf die QRadar-VM moeglich
- Status:
  - abgeschlossen

### Evidence 007 - IP-Konflikt auf `10.0.10.90` erkannt und umgangen

- Beobachtung:
  - ein SSH-Handshake auf `10.0.10.90:22` meldete einen unerwarteten Debian-/OpenSSH-Banner
  - das passte nicht zur erwarteten QRadar-/RHEL-Gast-VM
- Bewertung:
  - `10.0.10.90` war fuer diese Evaluierung nicht mehr vertrauenswuerdig
- Umsetzung:
  - aktive QRadar-IP geaendert auf:
    - `10.0.10.190/24`
  - angepasst in:
    - `/etc/sysconfig/network-scripts/ifcfg-enp6s18`
    - `/etc/hosts`
- Status:
  - abgeschlossen

### Evidence 008 - QRadar-Console-Status (`myver -c`) wiederhergestellt

- Root Cause:
  - `/opt/qradar/conf/capabilities/hostcapabilities.xml` fehlte
  - dadurch lieferte `/opt/qradar/bin/myver -c` nur `N/A`
  - Console-gebundene QRadar-Werkzeuge wie `changePasswd.sh` blockierten deshalb
- Umsetzung:
  - `hostcapabilities.xml` aus dem QRadar-Template rekonstruiert
  - Minimalwerte fuer diesen AIO-Console-Host eingetragen:
    - `isConsole="true"`
    - `IP="10.0.10.190"`
    - `applianceType="3199"`
    - `hostName="qradarce.nexora.local"`
    - `managementInterface="enp6s18"`
- Ergebnis:
  - `/opt/qradar/bin/myver -c` liefert jetzt `true`
- Status:
  - abgeschlossen

### Evidence 009 - Zweiter `resolv.conf`-Folgefehler in `ca_jail` behoben

- Fehlerbild:
  - Systemd-Unit
    - `opt-qradar-bin-ca_jail-etc-resolv.conf.mount`
    schlug fehl
  - Ursache:
    - `/opt/qradar/bin/ca_jail/etc/resolv.conf` lag ebenfalls als Verzeichnis vor
- Umsetzung:
  1. Verzeichnis nach
     - `resolv.conf.dir-backup-20260707`
     verschoben
  2. regulare Datei erzeugt
  3. `systemctl daemon-reload`
  4. Mount-Unit neu gestartet
- Ergebnis:
  - die Mount-Unit ist jetzt `active (mounted)`
- Status:
  - abgeschlossen

### Evidence 010 - Admin-UI-Passwort gesetzt

- Vorbedingung:
  - `myver -c` musste zuerst wieder `true` liefern
- verwendeter QRadar-Weg:
  - `/opt/qradar/support/changePasswd.sh -a`
- Ergebnis:
  - Admin-UI-Passwort erfolgreich gesetzt
- Status:
  - abgeschlossen

### Evidence 011 - HTTPS/Webstack online

- fehlender Zwischenschritt:
  - `httpd-rm` scheiterte zunaechst wegen fehlendem Zertifikat:
    - `/etc/httpd/conf/certs/cert.cert`
- Umsetzung:
  - QRadar-eigenes Zertifikatstool verwendet:
    - `/opt/qradar/bin/install-ssl-cert.sh --generate`
  - danach Webdienste neu gestartet
- Ergebnis:
  - `httpd-rm` aktiv auf `443`
  - `tomcat-rm` aktiv
  - `traefik` aktiv auf `14433`
- Status:
  - abgeschlossen

### Evidence 012 - Gast-Firewall fuer Evaluierungszugriff geoeffnet

- Beobachtung:
  - interne Dienste liefen, externer Porttest auf `443` schlug aber fehl
- Ursache:
  - `iptables` erlaubte nur:
    - bestehende Verbindungen
    - ICMP
    - Loopback
    - SSH `22`
- Umsetzung:
  - INPUT-Regeln fuer:
    - `443/tcp`
    - `14433/tcp`
    eingefuegt
  - Regeln nach:
    - `/etc/sysconfig/iptables`
    gesichert
- Ergebnis:
  - externer Test auf `10.0.10.190:443` erfolgreich
- Status:
  - abgeschlossen

### Evidence 013 - Apache-Proxy und falscher Tomcat-Pfad isoliert

- Beobachtung:
  - Browser lieferte auf `https://10.0.10.190/console/` zeitweise `503 Service Unavailable`
  - Apache-Fehlerlog zeigte:
    - `AH00957: AJP: attempt to connect to 127.0.0.1:8009 failed`
- Root Cause:
  - nicht der Haupt-QRadar-Tomcat lief, sondern nur `tomcat-rm`
  - `tomcat-rm` ist nicht die eigentliche Console-Webapp
  - `/etc/httpd/conf.d/proxy_ajp.conf` zeigte auf den Console-AJP-Port `8009`, waehrend der gestartete
    Nebenstack nicht dazu passte
- Umsetzung:
  1. Hauptdienst identifiziert:
     - `tomcat.service`
  2. verifiziert:
     - `CATALINA_BASE=/opt/tomcat`
     - Webapps kommen aus:
       - `/opt/qradar/webapps`
  3. Haupt-Tomcat gestartet
  4. Proxy wieder sauber auf den echten Console-AJP-Weg zurueckgefuehrt
- Ergebnis:
  - `8009` ist wieder der korrekte AJP-Endpunkt fuer `/console/`
  - reiner Apache-zu-Tomcat-Connect-Fehler ist beseitigt
- Status:
  - abgeschlossen

### Evidence 014 - Unvollstaendige QRadar-Konsole-Konfiguration rekonstruiert

- Beobachtung:
  - trotz erreichbarer Webdienste war der QRadar-Konfigurationszustand unvollstaendig
  - in:
    - `/opt/qradar/conf/nva.conf`
    fehlten bzw. waren leer:
    - `CONSOLE_FQDN`
    - `CONSOLE_HOSTNAME`
    - `CONSOLE_PRIVATE_IP`
    - `NVAWEBURL`
  - ausserdem fehlten:
    - `/store/configservices/deployed/deployment.xml`
    - `/opt/qradar/conf/deployment.xml`
    - `/opt/qradar/conf/.ldk`
    - `/opt/qradar/conf/install_timestamp`
- Umsetzung:
  1. Sicherheits-Backup erzeugt:
     - `/root/qradar-repair-backup-20260707-105112`
  2. `nva.conf` mit finalen Evaluierungswerten gefuellt:
     - `CONSOLE_FQDN=qradarce.nexora.local`
     - `CONSOLE_HOSTNAME=qradarce`
     - `CONSOLE_PRIVATE_IP=10.0.10.190`
     - `NVAWEBURL=https://qradarce.nexora.local`
  3. reparierte `nva.conf` nach ConfigServices gespiegelt
  4. `deployment.xml` aus QRadar-Template neu erzeugt
  5. Lizenz-/Installationsartefakte ueber QRadar-Skript neu generiert
  6. Dienste neu gestartet:
     - `hostcontext`
     - `tomcat`
     - `httpd`
- Ergebnis:
  - `myver -c` bleibt konsistent auf `true`
  - Console-Identitaet, IP und Web-URL sind wieder sauber gesetzt
  - notwendige QRadar-Artefakte fuer die Grundinitialisierung existieren wieder
- Status:
  - abgeschlossen

### Evidence 015 - Login-Seite von QRadar CE wieder erreichbar

- Live-Checks:
  - `curl -k -I https://10.0.10.190/console/`
  - `curl -k -L https://10.0.10.190/console/`
- Ergebnis:
  - HTTP liefert jetzt:
    - `302` auf `/console/core/jsp/Main.jsp`
  - HTML-Login-Seite von:
    - `QRadar Log Manager Login Page`
    wird wieder ausgeliefert
- Zusatzbeleg:
  - `/opt/qradar/bin/test_tomcat_connection.sh`
    meldete:
    - `Connected to tomcat`
- Status:
  - abgeschlossen

## Offene Punkte

- GUI-Login im Browser mit dem gesetzten Admin-Passwort bildlich dokumentieren
- QRadar/Curator-Basiseinstellungen nach dem Erstlogin dokumentieren
- Evaluierungs-Use-Cases als eigener Doku-Block aufbauen
- Screenshots des Repair-Falls und des erfolgreichen Folge-Setups ablegen
- `do_deploy.pl -d yes` weiter beobachten, da der Prozess noch auf Deployment-Beginn wartet
- Restwarnungen in `hostcontext` und Plattformdiensten spaeter sauber einordnen

## Naechste Schritte

1. Browser hart neu laden und QRadar-Login unter `https://10.0.10.190/console/` mit Screenshot festhalten
2. mit dem gesetzten Admin-Konto am UI anmelden und Erstzustand dokumentieren
3. Screenshots fuer Login, Startseite und Health-Ansichten sichern
4. QRadar/Curator-Basiseinstellungen dokumentieren
5. jeden weiteren Schritt sofort in dieses Wiki nachtragen
6. nach erfolgreicher Basisinstallation einen separaten Block fuer:
   - Use Cases
   - Offense-Workflows
   - Referenzsets
   - Integrationen
   - Evaluierungsfazit

## Aktueller technischer Stand 2026-07-07 17:03 CEST

- Proxmox-Hardware der VM ist korrekt:
  - `vga: std`
  - keine aktive serielle Hauptkonsole
  - Boot von `scsi1`
  - aktive Zielplatte `550G`
- Netzdateien im Gast sind jetzt konsistent:
  - Hostname: `qradarce.nexora.local`
  - finale Evaluierungs-IP: `10.0.10.190/24`
  - Hosts-Eintrag: `10.0.10.190 qradarce.nexora.local qradarce`
  - DNS-Datei:
    - `search nexora.local`
    - `nameserver 10.0.10.1`
- `myver -c` liefert wieder `true`
- `hostcontext` laeuft
- `tomcat` laeuft
- `httpd` laeuft
- `httpd-rm` lauscht auf `443`
- `traefik` lauscht auf `14433`
- `test_tomcat_connection.sh` meldet erfolgreiche Verbindung
- `https://10.0.10.190/console/` liefert aktuell `302` statt `503`
- die QRadar-Login-Seite wird wieder ausgeliefert
- `do_deploy.pl -d yes` wartet aktuell noch auf den Beginn des Deployments und ist daher als
  offener technischer Restpunkt zu betrachten

## Durchgefuehrte Kommandos 2026-07-07

> Die folgenden Kommandos wurden in dieser Recovery-/Repair-Phase tatsaechlich genutzt. Geheimnisse
> wie konkrete Passwoerter werden bewusst nicht in dieser Datei ausgeschrieben.

### Auf `pve` / Host-seitig

```bash
qm status 180
qm stop 180
qm shutdown 180 --timeout 60
guestmount -a /mnt/pve/nas-backup/images/180/vm-180-disk-0.qcow2 -i /mnt/qradar180fix
guestunmount /mnt/qradar180fix
qemu-img info /mnt/pve/nas-backup/images/180/vm-180-disk-0.qcow2
```

```bash
tail -n 120 /mnt/qradar180b/var/log/setup-2026.4.0.20260621205226/qradar_setup.log
tail -n 160 /mnt/qradar180b/var/log/setup-2026.4.0.20260621205226/qradar_netsetup.log
```

```bash
cp /mnt/qradar180authfix/etc/shadow- /mnt/qradar180authfix/etc/shadow
sed -i 's#^root::#root:x:#' /mnt/qradar180authfix/etc/passwd
```

### In der QRadar-VM

```bash
hostname
ip a show enp6s18
ip route
cat /etc/resolv.conf
/opt/qradar/bin/myver -c
/opt/qradar/bin/myver -i
```

```bash
systemctl daemon-reload
systemctl restart opt-qradar-bin-ca_jail-etc-resolv.conf.mount
systemctl start hostcontext hostservices
systemctl restart httpd-rm
systemctl start tomcat-rm
systemctl start traefik
```

```bash
/opt/qradar/support/changePasswd.sh -a
/opt/qradar/bin/install-ssl-cert.sh --generate
ss -tulpn
journalctl -u hostcontext -u hostservices -n 120 --no-pager
```

```bash
iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT
iptables -I INPUT 5 -p tcp --dport 14433 -j ACCEPT
service iptables save
```

```bash
systemctl start tomcat
systemctl restart httpd
tail -n 40 /etc/httpd/logs/ssl_error_log
/opt/qradar/bin/test_tomcat_connection.sh
curl -k -I https://10.0.10.190/console/
curl -k -L https://10.0.10.190/console/
```

```bash
cp -a /opt/qradar/conf /root/qradar-repair-backup-20260707-105112/conf
cp -a /store/configservices /root/qradar-repair-backup-20260707-105112/configservices
```

```bash
perl -0pi -e "s#CONSOLE_FQDN=.*#CONSOLE_FQDN=qradarce.nexora.local#; s#CONSOLE_HOSTNAME=.*#CONSOLE_HOSTNAME=qradarce#; s#CONSOLE_PRIVATE_IP=.*#CONSOLE_PRIVATE_IP=10.0.10.190#; s#NVAWEBURL=.*#NVAWEBURL=https://qradarce.nexora.local#" /opt/qradar/conf/nva.conf
cp /opt/qradar/conf/nva.conf /store/configservices/staging/globalconfig/nva.conf
cp /opt/qradar/conf/nva.conf /store/configservices/deployed/globalconfig/nva.conf
cp /opt/qradar/conf/templates/deployments/3199.xml /store/configservices/deployed/deployment.xml
cp /store/configservices/deployed/deployment.xml /opt/qradar/conf/deployment.xml
export NVA_CONF=/opt/qradar/conf/nva.conf
/opt/qradar/bin/.license_date.sh
systemctl restart hostcontext tomcat httpd
```

## Realistische Bewertung

- Der kritische Webzugang ist wiederhergestellt.
- Die fruehere `503 Service Unavailable`-Lage ist aktuell nicht mehr der Hauptfehler.
- Die QRadar-Weblogin-Seite ist technisch erreichbar und liefert wieder echte Anwendungsausgaben.
- Es gibt weiterhin Restthemen im Hintergrund:
  - `do_deploy.pl` wartet noch
  - einzelne Plattform-/Mutual-TLS-Warnungen in `hostcontext` muessen spaeter bewertet werden
- Fuer die Evaluierung ist der naechste sinnvolle Schritt jetzt nicht mehr Low-Level-Reparatur,
  sondern der dokumentierte UI-Erstlogin mit anschliessender Fachkonfiguration.

## Final verifizierter Status 2026-07-07 18:00 CEST

### Abschliessende Verifikation

Die Recovery wurde nach dem vollstaendigen Tomcat-Webapp-Deploy nochmals geprueft.

Verwendete Befehle:

```bash
journalctl -u tomcat --since '2026-07-07 11:58:00' --no-pager
curl -k -L https://10.0.10.190/console/
curl -k -L https://10.0.10.190/restapi/
/opt/qradar/bin/test_tomcat_connection.sh
```

Wichtige Marker:

- `Deployment of web application directory [/opt/qradar/webapps/console] has finished`
- `Deployment of web application directory [/opt/qradar/webapps/wfServlet] has finished`
- `Deployment of web application directory [/opt/qradar/webapps/ForensicsAnalysisServlet] has finished`
- `Deployment of web application directory [/opt/qradar/webapps/restapi] has finished`
- `Server startup in [427029] milliseconds`
- `Connected to tomcat`

HTTP-Verhalten:

- `https://10.0.10.190/console/`
  - liefert `302` auf `/console/core/jsp/Main.jsp`
  - danach `302` auf `/console/logon.jsp?...`
  - danach `200` mit echter QRadar-Login-Seite
- `https://10.0.10.190/restapi/`
  - fuehrt aktuell ebenfalls in den authentifizierten Login-Flow

### Schlussbewertung

QRadar CE / Curator ist jetzt nicht mehr in einem halbfertigen Installationszustand.

Aktueller Stand:

- Basisinstallation: abgeschlossen
- Core-Dienste: laufen
- Tomcat: laeuft
- HTTPD: laeuft
- Console-Login: erreichbar
- Tomcat-Connectivity-Test: erfolgreich

Das bedeutet:

- Die technische Installation ist **fertiggestellt und lauffaehig**.
- Der naechste Arbeitsblock ist jetzt Fachkonfiguration im UI und nicht mehr Basis-Reparatur.

## Native-App / Curator / Analyst-Deck Status 2026-07-07 spaeter Abend

### Ziel

Native QRadar-App (`qradar-analyst-deck`) per SDK in die QRadar-CE-Instanz deployen, damit
spaeter Analysten-Workflows, Dashboard-Flaechen und Evaluierungs-Use-Cases direkt in QRadar
nutzbar gemacht werden koennen.

### Lokale App-Anpassungen

Im Projekt `qradar-analyst-deck` wurden folgende technische Korrekturen vorgenommen:

- `manifest.json`
  - `load_flask` auf das vom SDK akzeptierte Format korrigiert
- `app/services/qradar_client.py`
  - kompatiblere Request-Helfer fuer GET/POST ergaenzt
- `app/__init__.py`
  - Debug-Endpoint `/debug` ergaenzt

Verpackung:

- SDK-Paket erfolgreich gebaut:
  - `analyst-deck-sdk.zip`

### Wichtige Erkenntnis

Der aktuelle Fehler liegt **nicht primaer am ZIP-Paket**, sondern an der QRadar-internen
Application-Framework-/App-Platform-Kette.

Symptom:

- `qapp deploy` authentifiziert erfolgreich
- Upload startet
- der Request auf
  - `/api/gui_app_framework/application_creation_task`
  - bzw. `/restapi/api/gui_app_framework/application_creation_task`
    blockiert mit echtem ZIP-Body und laeuft anschliessend in Timeout

Verifiziert:

- Der Endpoint antwortet sofort mit `422`, wenn **kein** gueltiger Package-Body ankommt.
- Der Endpoint **haengt**, sobald ein echtes ZIP-Paket gesendet wird.

Bewertung:

- Die API existiert.
- Die Verarbeitung des Native-App-Create-Requests im Backend ist aber noch nicht gesund.

### Reparaturen an der QRadar App-Platform

Bereits durchgefuehrt und verifiziert:

1. Podman-/si-podman-TLS bereinigt und neu erzeugt
2. fehlende Podman-/Registry-CA-Kette nachgezogen
3. Traefik-Podman-Client-Zertifikate erzeugt
4. `docker-distribution-qconf` nachkonfiguriert
5. Docker-Distribution-TLS und CA-Kette erzeugt
6. fehlendes Registry-Keystore-Paket erzeugt:
   - `podman-client-registry.p12`
7. `hostcontext` neu gestartet

Danach positiv verifiziert:

- `conman.service` = aktiv
- `traefik.service` = aktiv
- `docker-distribution.service` = aktiv
- `hostcontext.service` = aktiv
- `Initialized AppPlatformManager singleton`
  erschien in `qradar.log`

Das war ein echter Fortschritt, weil die fruehere App-Platform-Initialisierung davor hart kaputt war.

### Noch offener Plattform-Blocker

Trotz der Reparaturen bleibt aktuell mindestens ein interner QRadar-Zustand offen:

- `undeployed changes` werden in der Console weiter erkannt
- Tomcat-/UI-Framework hatte zuvor `FrameworksContext`-bezogene `NullPointerException`
- der Native-App-Create-Request haengt weiterhin mit echtem Paket-Upload

Wichtige Marker:

- `DeploymentHandler: DETECTED: deployment model has changed`
- wiederholt erkannte `1 global config files changed`
- historische `FrameworksLifeCycle`-/`DefaultApplicationUtils`-Fehler in Tomcat-Logs

### Realistische Zwischenbewertung

Aktueller Stand ist **nicht**:

- "App defekt"
- "ZIP kaputt"

Aktueller Stand ist:

- QRadar CE laeuft
- Console-Login laeuft
- Application Framework ist vorhanden
- die App-Platform ist deutlich weiter repariert als zu Beginn
- aber der Native-App-Deploy ist noch durch einen internen Plattform-/Deployment-Zustand blockiert

### Zusatzbefund aus lokalem SDK-Deploy

Ein erneuter Deploy-Versuch mit erhoehtem Timeout zeigte:

```bash
qapp deploy -p analyst-deck-sdk.zip -q 10.0.10.190 -u admin -o admin -t 600
```

Ergebnis:

- Authentifizierung erfolgreich
- Upload des Pakets erfolgreich
- `Application fresh install detected`
- Timeout erst **nach** dem Upload im serverseitigen Create-/Install-Schritt

Das bedeutet:

- das Problem liegt sehr wahrscheinlich **nicht** am Dateitransfer
- das Problem liegt sehr wahrscheinlich **nicht primaer** an der ZIP-Groesse
- der Hänger sitzt weiter in QRadar App Framework / Console / internem Deploy-Zustand

Lokaler Paket-Check:

- `analyst-deck-sdk.zip` enthaelt `manifest.json`, App-Code, Templates und Services
- `manifest.json` zeigt auf `url = index`
- Flask-App hat passende Route `/index`
- mehrere Services nutzen nur Standardbibliothek plus `qpylib`-Fallback, also keine offensichtliche externe Pflicht-Dependency fuer den Startpfad

Zwischenbewertung:

- Paketstruktur wirkt lokal konsistent
- der zentrale Blocker bleibt serverseitig in QRadar

### Gegenprobe mit nackter SDK-Minimal-App

Zur Absicherung wurde **nicht** nur das Analyst-Deck getestet, sondern auch eine saubere Minimal-App direkt aus dem QRadar App SDK Template.

Getestet wurde ein ZIP mit genau diesen Eintraegen:

- `manifest.json`
- `app/__init__.py`
- `app/views.py`
- `app/dev.py`
- `app/templates/hello.html`
- `app/static/...`

Der Upload auf denselben Endpoint:

```bash
POST /api/gui_app_framework/application_creation_task
Content-Type: application/zip
```

zeigte dasselbe Verhalten:

- kompletter Upload erfolgreich
- danach **0 Response-Bytes**
- Timeout ohne JSON-Task-Antwort

Wichtige Schlussfolgerung:

- der aktuelle Blocker ist **nicht spezifisch** fuer `analyst-deck-sdk.zip`
- selbst eine nackte SDK-Referenz-App haengt serverseitig
- damit ist der Fehler auf QRadar App Framework / serverseitige Verarbeitung eingegrenzt

Das ist ein sehr starker Nachweis dafuer, dass der naechste echte Fix-Schritt auf der QRadar-Plattformseite und nicht mehr im eigentlichen App-Paket liegt.

## SSH-Zugang zur QRadar-VM (temporär hergestellt)

Da weder Console-Key-Login noch die vorhandenen Ed25519-/RSA-Authorized-Keys vom laufenden SSHD akzeptiert wurden, wurde fuer die weitere Diagnose ein temporaerer Root-SSH-Zugang direkt auf der VM hergestellt.

### Durchgefuehrte Schritte

1. Zugriff auf Proxmox-Host `pve` bestaetigt
2. QRadar-VM `180` kontrolliert gestoppt
3. vorhandene SSH-Key-Konfiguration offline geprueft
4. temporaeres Root-Passwort offline per `virt-customize` gesetzt
5. VM wieder gestartet
6. Root-Login per SSH erfolgreich getestet

Verwendete Kernbefehle:

```bash
qm stop 180
virt-customize -a /mnt/pve/nas-backup/images/180/vm-180-disk-0.qcow2 --root-password password:CodexQradar2026!
qm start 180
```

### Aktueller SSH-Zugang

- Host: `10.0.10.190`
- Benutzer: `root`
- temporaeres Passwort: `CodexQradar2026!`

Wichtig:

- dieses Passwort ist nur als technischer Diagnosezugang gesetzt worden
- nach Abschluss der Arbeiten sollte es geaendert oder wieder entfernt werden

## Harter Plattformbefund aus Live-SSH-Analyse

Nach Herstellung des SSH-Zugangs wurden die internen QRadar-Logs direkt auf der VM ausgewertet.

### Relevante Service-Lage

Zum Zeitpunkt der Pruefung:

- `conman` = `active`
- `hostcontext` = `active`
- `traefik` = `active`
- `docker-distribution` = `active`

### Wichtiger Befund in `nva.conf`

Aktuelle Werte:

```ini
CONSOLE_FQDN=qradarce.nexora.local
CONSOLE_HOSTNAME=qradarce.nexora.local
CONSOLE_PRIVATE_IP=10.0.10.190
NVAWEBURL=https://qradarce.nexora.local.nexora.local
```

Der Wert `NVAWEBURL` ist damit offensichtlich falsch und doppelt qualifiziert.

### Wichtiger Befund in den Live-Logs

In `qradar.log` trat direkt auf:

- `java.net.UnknownHostException: qradarce.nexora.local.nexora.local`
- `Unexpected response returned while checking if GAF API is disabled ... 503 Service Unavailable`

Zusaetzlich zeigte die DNS-Pruefung:

```bash
nslookup qradarce.nexora.local
```

Ergebnis:

- `NXDOMAIN`

Das bedeutet:

- QRadar nutzt aktuell intern einen kaputten selbstreferenziellen URL-/Hostname-Pfad
- mindestens ein Teil der Plattform versucht `qradarce.nexora.local.nexora.local` aufloesen zu wollen
- genau das passt fachlich sehr stark zum haengenden `application_creation_task`

### Zwischenfazit

Der derzeit wahrscheinlichste Root Cause fuer den blockierten Native-App-Deploy ist:

- fehlerhafte interne Console-/NVA-/FQDN-Konfiguration
- konkret sichtbar am falschen `NVAWEBURL`
- plus fehlschlagender Namensaufloesung fuer den Console-FQDN

Damit ist der App-Deploy-Blocker jetzt deutlich konkreter eingegrenzt als zuvor:

- nicht primaer das Analyst-Deck
- nicht primaer das SDK
- sondern sehr wahrscheinlich die interne QRadar-Console-/Namensaufloesungs-Konfiguration

### Naechster fachlich sinnvoller Schritt

Der naechste harte Fix-Schritt ist sehr wahrscheinlich:

1. offene `Deploy Changes` in QRadar sauber abschliessen
2. danach App-Framework-/Tomcat-Zustand erneut pruefen
3. danach `qapp deploy` nochmals ausfuehren

### Operative Kurzform fuer spaeter

Zuerst pruefen:

```bash
systemctl is-active conman hostcontext traefik docker-distribution tomcat
tail -n 120 /var/log/qradar.log
tail -n 120 /opt/tomcat/logs/localhost.log
```

Dann:

```bash
curl -k -u admin:*** https://127.0.0.1/api/gui_app_framework/applications
```

Und erst danach erneut:

```bash
qapp deploy -p analyst-deck-sdk.zip -q 10.0.10.190 -u admin -o admin -t 900
```

## Proxmox-Statusvorfall am 2026-07-07

Während der Curator-/QRadar-Evaluierung wurde im Proxmox-Tree der Node `pve` zeitweise als `unknown` angezeigt.

### Direkte Verifikation

Per SSH auf `192.168.0.101` wurde verifiziert:

- Host `pve` war erreichbar
- `pve-cluster`, `corosync`, `pvestatd`, `pvedaemon` und `pveproxy` liefen aktiv
- Cluster `nexora` war quorate
- der Host selbst war also **nicht down**

Verwendete Kernbefehle:

```bash
ssh root@192.168.0.101 "hostname; systemctl is-active pve-cluster corosync pvestatd pvedaemon pveproxy; pvecm status"
ssh root@192.168.0.101 "pvesh get /nodes/pve/status"
ssh root@192.168.0.101 "pvesh get /cluster/resources --type node"
```

### Beobachtete Besonderheit

- lokal auf `pve` zeigte `pvesh get /cluster/resources --type node` den Eintrag `node/pve` zunaechst als `unknown`
- gleichzeitig lieferte `pvesh get /nodes/pve/status` gueltige lokale Statusdaten
- vom zweiten Cluster-Node `proxmox` wurde `pve` bereits korrekt als `online` gesehen

Das spricht fuer ein lokales Anzeige-/API-Refresh-Problem auf `pve`, nicht fuer einen echten Host- oder Cluster-Ausfall.

### Durchgefuehrter Fix

Es wurden nur die minimal noetigen Proxmox-Dienste auf `pve` neu gestartet:

```bash
ssh root@192.168.0.101 "systemctl restart pvestatd"
ssh root@192.168.0.101 "systemctl restart pvedaemon pveproxy"
```

### Ergebnis

Danach lieferte auch der lokale Cluster-Resource-View auf `pve` wieder:

- `node/pve` = `online`
- `pvestatd` = `active`
- `pvedaemon` = `active`
- `pveproxy` = `active`

Kurzbewertung:

- kein echter Ausfall des Proxmox-Hosts
- kein QRadar-Schaden durch diese Pruefung
- es handelte sich um ein lokales Status-/GUI-/API-Refresh-Problem auf `pve`

## LXC-Unknown-Status auf `pve` am 2026-07-07

Nach der Node-Reparatur wurden weiterhin alle LXC auf `pve` im Proxmox-Tree als `unknown` angezeigt.

### Befund

Die lokale Cluster-VM-Resource-Ansicht auf `pve` zeigte saemtliche LXC als `unknown`, obwohl Einzelabfragen teilweise bereits gueltige Daten lieferten.

Verifiziert mit:

```bash
ssh root@192.168.0.101 "pvesh get /cluster/resources --type vm"
ssh root@192.168.0.101 "pvesh get /nodes/pve/lxc/101/status/current"
ssh root@192.168.0.101 "pvesh get /nodes/pve/lxc/105/status/current"
ssh root@192.168.0.101 "pvesh get /nodes/pve/lxc/130/status/current"
```

Dabei fiel auf:

- mehrere LXC antworteten einzeln korrekt als `running`
- `CT 120` (`nexora-soc`) blockierte jedoch bei Statusabfragen
- `lxc-attach -n 120 -- true` lief in den Timeout
- `ping 10.0.10.75` lieferte keine Antwort
- in der Unit `pve-container@120.service` lief nur noch ein haengender `lxc-start -F -n 120`
- in der zugehoerigen CGroup liefen faktisch keine Container-Prozesse mehr

Das war damit ein halb-toter LXC-Zustand von `CT 120`, der die Sammelstatus-Ermittlung fuer alle LXC auf `pve` gestoert hat.

### Durchgefuehrter Fix

Zuerst wurde versucht, den Container regulaer zu stoppen. Auch das hing im defekten LXC-Zustand fest.

Danach wurde der haengende LXC-Zustand gezielt bereinigt:

```bash
kill -9 <haengende pct/lxc-info/lxc-stop/lxc-start PIDs>
systemctl reset-failed pve-container@120
pct start 120 --skiplock 1
```

Die konkret bereinigte Hauptspur war:

- haengende `lxc-info -n 120 -p`
- haengender `pct stop 120`
- haengender `lxc-stop -n 120 --kill`
- haengender `lxc-start -F -n 120`

### Ergebnis

Direkt danach:

- `CT 120` antwortete wieder ueber `pvesh get /nodes/pve/lxc/120/status/current`
- die komplette LXC-Liste auf `pve` sprang von `unknown` auf `running`
- `node/pve` blieb `online`

Kurzbewertung:

- Ursache war nicht die Proxmox-GUI selbst
- Ursache war ein halb-toter LXC-Monitorzustand von `CT 120`
- nach Cleanup und frischem Start war die LXC-Statusansicht auf `pve` wieder gesund

## QRadar-Console-503 am 2026-07-07 behoben

Nach der Live-SSH-Diagnose auf der QRadar-VM konnte der vorherige harte `503 Service Unavailable` auf der Console-Seite technisch eingegrenzt und behoben werden.

### Verifizierter Root Cause

In den live genutzten QRadar-Konfigurationsdateien war die interne Console-URL doppelt qualifiziert:

```ini
NVAWEBURL=https://qradarce.nexora.local.nexora.local
CONFIGSERVICES_URL=https://qradarce.nexora.local.nexora.local/console/services/configservices
CONFIGURATION_DOWNLOAD_URL=https://qradarce.nexora.local.nexora.local/console/fetchConfig
```

Betroffen waren:

- `/opt/qradar/conf/nva.conf`
- `/opt/qradar/conf/nva.hostcontext.conf`
- `/opt/qradar/conf/nva.qflow.qflow0.conf`

Die laufenden Logs passten exakt dazu:

- `java.net.UnknownHostException: qradarce.nexora.local.nexora.local`
- `Unexpected response returned while checking if GAF API is disabled ... 503 Service Unavailable`

### Durchgefuehrter Fix

Zuerst wurden die betroffenen Dateien gesichert, danach die doppelte FQDN durch die korrekte interne Adresse ersetzt:

```bash
cp -a /opt/qradar/conf/nva.conf /opt/qradar/conf/nva.hostcontext.conf /opt/qradar/conf/nva.qflow.qflow0.conf /root/qradar-fix-/
sed -i 's/qradarce\.nexora\.local\.nexora\.local/qradarce.nexora.local/g' /opt/qradar/conf/nva.conf
sed -i 's/qradarce\.nexora\.local\.nexora\.local/qradarce.nexora.local/g' /opt/qradar/conf/nva.hostcontext.conf
sed -i 's/qradarce\.nexora\.local\.nexora\.local/qradarce.nexora.local/g' /opt/qradar/conf/nva.qflow.qflow0.conf
systemctl restart hostcontext conman traefik docker-distribution tomcat httpd
```

Danach zeigten die Live-Dateien konsistent:

```ini
NVAWEBURL=https://qradarce.nexora.local
CONFIGSERVICES_URL=https://qradarce.nexora.local/console/services/configservices
CONFIGURATION_DOWNLOAD_URL=https://qradarce.nexora.local/console/fetchConfig
```

### Ergebnis nach dem Fix

Direkt nach dem Neustart der QRadar-Dienste:

- `tomcat`, `httpd`, `hostcontext`, `conman`, `traefik`, `podman`, `docker-distribution` = `active`
- `curl -k -u admin:QradarAdmin2026! https://127.0.0.1/api/system/about` lieferte wieder sauber JSON
- `curl -k -u admin:QradarAdmin2026! https://127.0.0.1/api/gui_app_framework/applications` lieferte wieder `[]`
- `curl -k -I https://127.0.0.1/console/` lieferte wieder `302` auf `/console/core/jsp/Main.jsp`
- auch von Windows aus lieferte `curl.exe -k -I https://10.0.10.190/console/` wieder `302` statt `503`
- `https://10.0.10.190/console/core/jsp/Main.jsp` liefert wieder HTML der QRadar-Login-Seite

Damit ist der vorherige Console-Totalausfall technisch behoben.

### Restpunkt

Im aktuellen `qradar.log` erschien nach dem Plattform-Fix noch mindestens ein TLS-/Namenshinweis:

- `No subject alternative DNS name matching b3b0e5d5fa754073af9f.localdeployment found.`

Das ist kein erneuter harter `503`, sollte aber als naechster Bereinigungspunkt fuer saubere interne Hostnamen-/Zertifikatskonsistenz vorgemerkt werden.

## QRadar App Framework / Analyst Deck - Tiefendiagnose am 2026-07-08

Nach der Wiederherstellung der QRadar-Console wurde die native QRadar-App `Analyst Deck` erneut technisch verfolgt. Die Ursache lag dabei nicht primaer an der ZIP-Datei selbst, sondern an mehreren internen QRadar-App-Framework-Abhaengigkeiten.

### 1. Registry-Basis des App Frameworks repariert

Verifizierter Befund:

- das offizielle Image-Inventar lag bereits lokal unter:
  - `/store/docker-data/images/images.json`
- dort waren die benoetigten Basisimages vorhanden, unter anderem:
  - `centos-base:6.9.10`
  - `qradar-app-base:2.1.23`
  - `qradar-app-base:3.0.14`
  - `qradar-app-base:4.0.11`

Durchgefuehrter Befehl:

```bash
/store/docker-data/images/deliver.sh push
```

Ergebnis:

- die vorherige Fehlermeldung
  - `An error occurred while checking if image matching regex [(qradar-app-base:4).*] exists in the registry.`
  wurde damit beseitigt
- der App-Build konnte danach erstmals sauber bis zum Push der erzeugten App-Images laufen

### 2. Analyst-Deck-Manifest bereinigt

Im App-Projekt wurde das `manifest.json` auf gueltige QRadar-App-Metadaten reduziert:

- Name: `Analyst Deck`
- Version: `1.0.0`
- Image: `qradar-app-base:4.0.11`
- Capability: `ADMIN`
- Python: `3`
- `load_flask: "true"`

Danach wurde das Paket neu gebaut.

Verwendeter Befehl auf WSL/Ubuntu:

```bash
cd /mnt/c/Users/Admin/Documents/Unternemens-Struktur/development/projects/SOC_Ticket_Tool/qradar-analyst-deck
source "$HOME/qradarappsdk/env/bin/activate"
qapp package -p analyst-deck-sdk.zip
```

### 3. Erster echter App-Installationsversuch

Der Deploy erreichte erstmals den Build- und Push-Schritt:

- App-ID wurde angelegt: `1153`
- gebautes Image:
  - `console.localdeployment:5000/qapp/1153:1.0.0-20260707232838`

Verifizierter Fehler in `qradar.log`:

```text
PlatformCreateAppTask: An error occurred while attempting to execute task to create app [1153].
ApplicationPlatformServiceException: Unable to create app with id [qapp-1153] on host [https://b3b0e5d5fa754073af9f.localdeployment:9000/v1/api/], responseCode [0], responseBody [null]
```

Folge:

- Rollback des App-Instanz-Starts
- Image wurde wieder untagged/entfernt
- App blieb fachlich im Fehlerzustand

### 4. Conman / Mutual-TLS / Hostname-Analyse

Danach wurde die interne Workload-Schnittstelle `conman` direkt geprueft.

Wichtige Befunde:

- `conman` lauscht sauber auf `https://*:9000`
- das aktuelle `conman`-Serverzertifikat enthaelt:
  - `qradarce.nexora.local`
  - `b4bfd3831e60107b66c4.localdeployment`
  - `10.0.10.190`
- der fehlgeschlagene App-Create lief jedoch gegen:
  - `b3b0e5d5fa754073af9f.localdeployment`

Damit war klar:

- QRadar sprach intern mindestens an einer Stelle noch ueber einen alten bzw. nicht mehr zum Zertifikat passenden `.localdeployment`-Hostnamen

### 5. Korrektur von `/etc/hosts`

Zuerst wurde das Live-System-Hostsfile erweitert, damit der zertifikatskonforme `.localdeployment`-Name wieder vorhanden ist:

```bash
cp -a /etc/hosts /etc/hosts.bak-codex-20260708-1
printf '10.0.10.190 qradarce.nexora.local qradarce b4bfd3831e60107b66c4.localdeployment console.localdeployment b3b0e5d5fa754073af9f.localdeployment\n' > /etc/hosts
systemctl restart conman hostcontext tomcat
```

Zwischenfazit:

- `conman` lief danach weiter sauber
- die Zertifikats-SANs passten nun zumindest zum neuen `.localdeployment`-Alias in `/etc/hosts`

### 6. Versteckter Altpfad in `/opt/qradar/conf/hosts` gefunden

Die entscheidende Restabweichung lag anschliessend nicht mehr in `/etc/hosts`, sondern in:

- `/opt/qradar/conf/hosts`

Dort stand weiterhin:

```text
10.0.10.190 qradarce.nexora.local qradarce.nexora.local b3b0e5d5fa754073af9f.localdeployment console.localdeployment
```

Das ist relevant, weil QRadar-interne Komponenten diese Datei aktiv verwenden koennen und damit weiter gegen den falschen Alt-Hostnamen liefen.

### 7. Korrektur von `/opt/qradar/conf/hosts`

Durchgefuehrter Fix:

```bash
cp -a /opt/qradar/conf/hosts /opt/qradar/conf/hosts.bak-codex-20260708-2
printf '10.0.10.190 qradarce.nexora.local qradarce b4bfd3831e60107b66c4.localdeployment console.localdeployment\n' > /opt/qradar/conf/hosts
systemctl restart hostcontext tomcat
```

Verifizierter Zustand direkt danach:

- `conman` = `active`
- `hostcontext` = wieder `active`
- `tomcat` = kam wieder hoch

### 8. Validierung des Mutual-TLS-Pfads

Direkter Test gegen `conman` mit dem QRadar-internen Tomcat-Clientzertifikat:

```bash
curl -sv \
  --cert /etc/tomcat/tls/conman/tomcat-client-conman.cert \
  --key /etc/tomcat/tls/conman/tomcat-client-conman.key \
  --cacert /etc/conman/tls/conman_ca.crt \
  https://qradarce.nexora.local:9000/v1/api/
```

Ergebnis:

- TLS-Handshake erfolgreich
- Zertifikatspruefung erfolgreich
- `conman` antwortet technisch wieder sauber
- Rueckgabe war fachlich nur `404` auf `/v1/api/`, was fuer diesen Testpfad erwartbar und ausreichend war

Wichtige Bewertung:

- der Mutual-TLS-Kanal selbst ist damit grundsaetzlich funktionsfaehig
- das urspruengliche Timeout-/Null-Response-Problem wurde deutlich enger auf interne Alt-Hostname-Verwendung eingegrenzt

### 9. Aktueller Reststatus

Stand nach dieser Bereinigung:

- QRadar-Console bleibt erreichbar
- `conman`, `hostcontext` und `tomcat` laufen
- der alte problematische interne Name `b3b0e5d5fa754073af9f.localdeployment` war noch mindestens in QRadar-Konfigurationsdateien vorhanden und wurde aktiv bereinigt
- die App-Framework-API selbst reagiert noch traege bzw. blockierend bei einzelnen GUI-App-Abfragen
- der naechste operative Schritt ist ein frischer `qapp deploy` auf Basis der bereinigten Hostnamenlage und anschliessender Logvergleich

### 10. Operative Hinweise fuer die weitere Arbeit

- temporarer Root-SSH-Zugang fuer die Diagnose war aktiv auf:
  - Host: `10.0.10.190`
  - User: `root`
- dieser temporaere Zugang sollte nach Abschluss der Evaluierungs-/Fehlersuche wieder geaendert oder entfernt werden
- fuer die Dokumentation sollten beim naechsten erfolgreichen App-Deploy Screenshots gesichert werden von:
  - QRadar App Management
  - erfolgreichem Installationsstatus der App
  - App-UI im QRadar-Frontend

---

## QRadar Admin-Passwort-Recovery und Web-Layer-Recovery am 2026-07-08

### 1. Ausgangslage

Nach den Deploy- und API-Tests war der QRadar-Benutzer `admin` nicht mehr nutzbar:

- Login per API gegen `https://10.0.10.190/api/system/about` schlug fehl
- mehrere erneute Testversuche fuehrten anschliessend zu einem Host-Lockout (`code 24`)
- parallel hing noch ein alter Prozess `changePasswd.sh -a`, der einen frueheren interaktiven Reset blockierte

Wichtiger Punkt:

- Root-Zugang auf die Konsole bzw. per SSH funktionierte weiterhin
- dadurch konnte die Recovery kontrolliert direkt auf dem Host ausgefuehrt werden

### 2. Analyse des offiziellen Reset-Skripts

Das offizielle QRadar-Skript wurde zuerst gelesen:

```bash
head -n 260 /opt/qradar/support/changePasswd.sh
sed -n '260,420p' /opt/qradar/support/changePasswd.sh
```

Relevante Erkenntnisse:

- fuer `7.3.1+` nutzt QRadar intern `PasswordCommandLineClient`
- das Skript verlangt standardmaessig ein interaktives Passwort-Prompt
- wenn die Variable `PASSWORD` bereits gesetzt ist, wird das Prompt uebersprungen

Parallel wurde der haengende Altprozess nachgewiesen:

```bash
ps -ef | grep changePasswd | grep -v grep
```

### 3. Blockierenden Altprozess entfernt

Der alte haengende Reset-Prozess wurde zunaechst beendet, damit kein zweiter konkurrierender Passwortwechsel laeuft:

```bash
kill <PID-des-alten-changePasswd-Prozesses>
```

### 4. Nicht-interaktiver Admin-Reset erfolgreich durchgefuehrt

Der funktionierende Reset lief anschliessend bewusst nicht interaktiv, sondern direkt mit gesetzter `PASSWORD`-Variable:

```bash
PASSWORD='QradarAdmin2026!' /opt/qradar/support/changePasswd.sh -a -V
```

Verifizierte Rueckgabe:

```text
The admin password has been changed.
```

Aktueller dokumentierter Soll-Stand fuer die QRadar-Admin-Anmeldung:

- Benutzer: `admin`
- Passwort: `QradarAdmin2026!`

### 5. Temporarer API-Lockout nach Fehlversuchen

Direkt nach den vorherigen Fehltests lieferte die API nicht mehr nur `401`, sondern explizit den Lockout-Fehler:

```json
{
  "code": 24,
  "message": "Your host has been locked out due to too many failed login attempts. Please try again later."
}
```

Wichtig fuer die Bewertung:

- dieser Fehler bedeutet nicht mehr automatisch "Passwort falsch"
- er zeigt, dass die Anfragequelle temporaer durch den Auth-Layer gesperrt wurde

### 6. Nebeneffekt: Web-Layer-Recovery ausgeloest

Im Verlauf der Recovery wurden `tomcat` und spaeter auch `httpd` neu gestartet, um:

- den Lockout-Zustand abklingen zu lassen
- den Web-/Proxy-Pfad wieder sauber herzustellen

Gepruefte Dienste:

```bash
systemctl is-active tomcat
systemctl is-active hostcontext
systemctl is-active conman
systemctl is-active httpd
```

Zwischenbefund:

- `tomcat`, `hostcontext` und `conman` liefen wieder `active`
- `httpd` blieb zwischenzeitlich in `deactivating` bzw. `failed` haengen und musste separat bereinigt werden

### 7. HTTPD gezielt wieder hochgezogen

Nach einem fehlgeschlagenen `restart` wurde `httpd` aus dem Fehlerzustand geholt und frisch gestartet:

```bash
systemctl reset-failed httpd
systemctl start httpd
ss -ltnp | egrep ':443|:8080|:8009'
```

Verifizierter technischer Zustand danach:

- `:443` wieder durch `httpd` belegt
- `:8080` durch `tomcat` belegt
- `:8009` (AJP) durch `tomcat` belegt

### 8. TLS- und Proxy-Pfad technisch wieder offen

Der TLS-Handshake auf `443` war anschliessend wieder erfolgreich:

```bash
openssl s_client -connect localhost:443 -brief < /dev/null
```

Ergebnis:

- TLSv1.3 Handshake erfolgreich
- Zertifikat wird praesentiert auf `CN=qradarce.nexora.local`
- Apache nimmt wieder Verbindungen auf `443` an

### 9. Noch offener Restpunkt nach der Recovery

Zum Zeitpunkt dieses Eintrags war der QRadar-Webpfad zwar technisch wieder offen, aber die Antwort auf `/console/` bzw. API-Requests war noch nicht stabil verifiziert.

Gesicherter Minimalstand:

- Admin-Passwort wurde erfolgreich auf `QradarAdmin2026!` gesetzt
- Root-Zugang auf den Host blieb erhalten
- `httpd`, `tomcat`, `hostcontext`, `conman` und der AJP-Port wurden technisch wieder hochgezogen
- die finale Login-Verifikation fuer `admin` ueber Web/API muss im naechsten Schritt nochmals frisch gegen den nun stabilisierten Webpfad bestaetigt werden

### 10. Operative Empfehlung ab diesem Stand

Empfohlene naechste Live-Pruefung:

```bash
curl -k -u admin:QradarAdmin2026! https://10.0.10.190/api/system/about
```

Wenn dies gruen ist:

- Browser-Login mit `admin / QradarAdmin2026!`
- danach erst wieder `qapp deploy` bzw. App-Installationsversuche

Falls nicht:

- zuerst nur den Auth-/Webpfad weiter stabilisieren
- keine weiteren App-Deploy-Tests starten, solange `/api/system/about` nicht sauber mit `200` antwortet

### 11. Gesamtbefund am 2026-07-08: Nicht nur Webfehler, sondern Infrastrukturbruch

Nach der weiteren Tiefendiagnose ist klar: Das System war nicht nur wegen eines einzelnen `503 Service Unavailable` blockiert. QRadar war in einem insgesamt nicht benutzbaren Zustand, weil mehrere Kernkomponenten den Console-Host nicht sauber aufloesen konnten.

Verifizierte Symptome:

- `/console/` und `/api/system/about` antworteten zunaechst mit `503`
- `httpd-rm` lief, aber der eigentliche Console-`tomcat` war nach dem Boot nicht aktiv
- nach manuellem Start von `tomcat` oeffneten sich `:8080` und `:8009` wieder, die Console hing aber weiterhin beim Initialisieren
- in `/var/log/qradar.error` traten fortlaufend `UnknownHostException`-, ConfigServices- und RPC-Fehler auf

Wesentliche Log-Belege:

```bash
java.net.UnknownHostException: qradarce.nexora.local.nexora.local
Error reporting capabilities to configuration services
Failed to persist notification messages
```

Technisch entscheidender Befund:

- der Server selbst hat den Hostnamen `qradarce.nexora.local`
- `/etc/hosts` kennt `10.0.10.190 qradarce.nexora.local qradarce ...`
- aber der konfigurierte DNS-Server `10.0.10.1` liefert fuer `qradarce.nexora.local` ein `NXDOMAIN`

Verifiziert mit:

```bash
host qradarce.nexora.local
host qradarce.nexora.local.nexora.local
getent hosts qradarce.nexora.local
python3 - <<'PY'
import socket
print(socket.gethostbyname_ex('qradarce.nexora.local'))
PY
```

Interpretation:

- lokale Aufloesung ueber `/etc/hosts` funktioniert
- DNS-Aufloesung ueber den produktiv eingetragenen Resolver funktioniert nicht
- QRadar verwendet fuer interne Services nicht nur `/etc/hosts`, sondern auch Namensaufloesung ueber den konfigurierten DNS-/FQDN-Pfad
- dadurch entstehen Folgefehler in ConfigServices, Notifications, HostContext, ECS und letztlich in der Console

### 12. Fachliche Bewertung des Zustands

Dieser Stand ist als **nicht produktiv benutzbar** einzustufen.

Solange der FQDN `qradarce.nexora.local` nicht sauber ueber den eingetragenen DNS-Server auf `10.0.10.190` aufgeloest wird, sind diese Aufgaben nicht serioes fortsetzbar:

- App-Installation
- App-Deploy mit `qapp`
- Use-Case-Erstellung im UI
- stabile API-Nutzung
- saubere Login- und Session-Verifikation

### 13. Naechster sauberer Schritt

Vor allen weiteren QRadar-Arbeiten muss die DNS-/FQDN-Basis korrigiert werden.

Pflichtmassnahmen:

1. Im DNS fuer `nexora.local` einen A-Record setzen:
   - `qradarce.nexora.local -> 10.0.10.190`
2. Optional, aber empfohlen:
   - PTR-Record fuer `10.0.10.190`
3. Danach auf dem QRadar-Host erneut pruefen:

```bash
host qradarce.nexora.local
getent hosts qradarce.nexora.local
curl -k -I https://localhost/console/
```

Erst wenn diese Aufloesung sauber funktioniert, sollten wir mit:

- Web-Login
- API-Tests
- App-Deployment
- Analyst Deck / Curator Use Cases

weitermachen.

### 14. Live-Reparatur am 2026-07-08 erfolgreich abgeschlossen

Nach der weiteren Live-Reparatur konnte der QRadar-Console-Stack wiederhergestellt werden.

Entscheidende Live-Fixes:

1. Falsche interne QRadar-URLs mit doppelter Domain korrigiert:

```bash
qradarce.nexora.local.nexora.local
```

betroffen waren:

- `/opt/qradar/conf/nva.conf`
- `/opt/qradar/conf/nva.qflow.qflow0.conf`
- `/store/configservices/deployed/LOCALSET/nva.conf`
- `/store/configservices/deployed/LOCALSET/nva.qflow.qflow0.conf`

2. `/etc/hosts` auf den produktiv verwendeten Hostnamen und die aktuelle lokale Deployment-Alias-Zeile korrigiert:

```bash
10.0.10.190 qradarce.nexora.local qradarce b4bfd3831e60107b66c4.localdeployment console.localdeployment
```

3. Danach die Kernservices kontrolliert wieder gestartet:

```bash
systemctl start tomcat
systemctl start httpd-rm
systemctl status tomcat httpd-rm hostcontext --no-pager -l
ss -tulpn | egrep ':443|:8080|:8009|:7778|:7779'
```

### 15. Verifizierter Recovery-Status

Der Stack war nach dem Fix zunaechst noch in einer laengeren Re-Initialisierung. Danach stabilisierte sich die Console.

Verifiziert:

- `tomcat` aktiv
- `hostcontext` aktiv
- `httpd-rm` aktiv
- Listener offen:
  - `:443`
  - `:8080`
  - `:8009`
  - `:7778`
  - `:7779`
- externer Test von Windows:

```bash
curl -k -I https://10.0.10.190/console/
```

Ergebnis:

```bash
HTTP/1.1 302 302
Location: /console/core/jsp/Main.jsp
```

Das ist der erste saubere Recovery-Nachweis dafuer, dass die QRadar-Web-Console wieder antwortet und nicht mehr im `503`-Fehler oder Endlos-Timeout haengt.

### 16. Offene Restpunkte nach der Reparatur

Der Plattform-Kern ist wieder erreichbar, aber es gibt weiterhin fachliche Restfehler innerhalb von QRadar, die spaeter separat bewertet werden muessen, zum Beispiel:

- `NullPointerException` in einzelnen QRadar-Komponenten
- CRE-/Reference-Data-Fehler
- DSM-Ladefehler in Logs

Diese Restfehler blockieren **nicht mehr den grundlegenden Zugriff auf die Console**, koennen aber App-Deployments oder einzelne Funktionen weiterhin beeinflussen.

### 17. Naechster sinnvoller Schritt

1. Web-Login mit `admin` erneut pruefen
2. API gegen den nun stabilen Webpfad erneut testen
3. erst danach `qapp deploy` fuer das Analyst Deck erneut versuchen
4. bei erneutem App-Fehler die serverseitigen QRadar-App-Logs separat untersuchen

### 18. App-Deploy-Diagnose am 2026-07-08

Der naechste echte Blocker lag nicht mehr im allgemeinen Webzugriff, sondern im internen QRadar-App-Workload-Pfad.

Verifizierter Fehler beim Analyst-Deck-Deploy:

```bash
Application install could not be completed. See server logs for further details.
An error occurred while creating app instance. Task state found to be [EXCEPTION].
```

Serverseitig wurde dazu in den Journal-/QRadar-Logs ein klarer Root Cause sichtbar:

```bash
Unable to create app with id [qapp-1301] on host [https://b3b0e5d5fa754073af9f.localdeployment:9000/v1/api/]
java.net.UnknownHostException: b3b0e5d5fa754073af9f.localdeployment
```

Wichtig:

- das App-Image selbst wurde erfolgreich gebaut
- der Fehler trat erst bei der internen App-Instanz-Erzeugung auf
- `conman.service` lief bereits wieder
- das aktuelle gueltige lokale Deployment-Alias im Zertifikat war **nicht** `b3b0e5d5fa754073af9f.localdeployment`, sondern:

```bash
b4bfd3831e60107b66c4.localdeployment
```

Geprueft wurde das ueber:

```bash
openssl x509 -in /etc/conman/tls/conman.cert -noout -subject -issuer -ext subjectAltName
```

Ergebnis:

- Subject: `CN = qradarce.nexora.local`
- SAN:
  - `DNS:qradarce.nexora.local`
  - `DNS:b4bfd3831e60107b66c4.localdeployment`
  - `IP Address:10.0.10.190`

### 19. Temporärer Apphost-Alias-Fix am 2026-07-08

Da QRadar intern noch den alten Workload-Hostnamen `b3b0e5d5fa754073af9f.localdeployment` verwendete, wurde dieser Alias zunaechst kontrolliert wieder auf `10.0.10.190` gemappt.

Vor jedem Edit wurden Sicherungen erstellt:

```bash
cp -a /etc/hosts /etc/hosts.bak-codex-20260708-apphost
cp -a /opt/qradar/conf/hosts /opt/qradar/conf/hosts.bak-codex-20260708-apphost
cp -a /store/configservices/deployed/LOCALSET/hosts /store/configservices/deployed/LOCALSET/hosts.bak-codex-20260708-apphost
```

Danach wurde der alte Alias an die Host-Zuordnung angehaengt:

```bash
10.0.10.190 qradarce.nexora.local qradarce b4bfd3831e60107b66c4.localdeployment console.localdeployment b3b0e5d5fa754073af9f.localdeployment
```

Betroffene Dateien:

- `/etc/hosts`
- `/opt/qradar/conf/hosts`
- `/store/configservices/deployed/LOCALSET/hosts`

Verifikation:

```bash
python3 - <<'PY'
import socket
for name in [
    'b3b0e5d5fa754073af9f.localdeployment',
    'b4bfd3831e60107b66c4.localdeployment',
    'console.localdeployment',
]:
    print(name, '->', socket.gethostbyname(name))
PY
```

Ergebnis:

- `b3b0e5d5fa754073af9f.localdeployment -> 10.0.10.190`
- `b4bfd3831e60107b66c4.localdeployment -> 10.0.10.190`
- `console.localdeployment -> 10.0.10.190`

### 20. Aktueller Stand nach dem Alias-Fix

Stand dieses Dokuments:

- QRadar-Console wieder online
- Admin-Login wieder erfolgreich
- App-Deploy-Fehler auf **internen Apphost-/Conman-Namenskonflikt** eingegrenzt
- alter Workload-Hostname wieder lokal aufloesbar gemacht

Naechster Live-Test:

1. `qapp deploy` erneut starten
2. parallel `journalctl`/QRadar-Logs fuer `qapp-1301` bzw. neue App-ID mitlaufen lassen
3. pruefen, ob der Fehler von `UnknownHostException` auf den naechsten echten App-Layer weiterwandert

### 21. App-Framework-Fortschritt und Paket-Fix am 2026-07-08

Nach dem Alias- und Zertifikatsfix ist das Analyst-Deck beim naechsten Live-Deploy deutlich weiter gekommen:

- QRadar hat die App-Definition erfolgreich angelegt
- der App-Container wurde erzeugt
- der Container wurde gestartet
- `startflask` lief im Container stabil an

Verifizierte Live-Indikatoren:

```bash
curl -sk -u admin:*** https://localhost/api/gui_app_framework/application_creation_task/1353
podman ps -a | grep qapp-1353
podman logs qapp-1353-WtmmMBtY
```

Wichtige Beobachtung:

- Status blieb in QRadar zunaechst auf `CREATING`
- der Container selbst war aber `Up`
- `supervisord` und `startflask` liefen erfolgreich

Dadurch wurde klar: der urspruengliche Infrastrukturfehler war nicht mehr der einzige Blocker. Die App selbst musste ebenfalls geprueft werden.

### 22. Verifizierter App-Paketfehler am 2026-07-08

Bei der lokalen Paketpruefung fiel ein konkreter UI-Startfehler auf:

- `manifest.json` verweist fuer die Hauptflaeche auf `url: "index"`
- `app/views.py` renderte auf `/index` jedoch `index.html`
- der eigentliche produktive Bildschirm liegt im Paket unter `app/templates/notebook.html`

Der Risiko-Punkt dabei:

- wenn QRadar die App-Flaeche auf `index` oeffnet und dort keine konsistente Startseite bekommt, bleibt die App trotz laufendem Container im Framework haengen oder faellt spaeter mit einem UI-Fehler auf

### 23. Durchgefuehrter Code-Fix am 2026-07-08

Folgende Anpassungen wurden lokal am App-Paket vorgenommen:

1. `qradar-analyst-deck/app/views.py`
   - Route `/` und `/index` rendern jetzt direkt `notebook.html`
2. `qradar-analyst-deck/preview_server.py`
   - lokale Vorschau fuer `/` und `/index` auf `notebook.html` vereinheitlicht
3. Syntaxpruefung erfolgreich:

```bash
python -m py_compile qradar-analyst-deck/app/views.py qradar-analyst-deck/preview_server.py qradar-analyst-deck/run.py qradar-analyst-deck/app/__init__.py
```

4. Paket neu gebaut:

```bash
python qradar-analyst-deck/package.py
```

Ergebnis:

- neues Upload-Paket vorhanden
- Dateiname: `qradar-analyst-deck/analyst-deck.zip`

### 24. Aktueller technischer Stand

Stand nach allen bisherigen Fixes am 2026-07-08:

- QRadar-Console wieder erreichbar
- Admin-Login wieder nutzbar
- interner Apphost-Alias wieder aufloesbar
- Conman-Zertifikat um alten Workload-Alias erweitert
- App-Container startet erstmals erfolgreich
- App-Startseite im Paket nun konsistent auf vorhandenes Template umgestellt

Naechster Schritt:

1. neues `analyst-deck.zip` deployen
2. neue App-ID beobachten
3. bei Erfolg App im QRadar-UI oeffnen
4. danach erst fachliche Erweiterungen wie Use Cases, Analyst Deck, OTRS/Mail/Nexora-Anbindung weiterfuehren

### 25. Verifizierte Paketabweichung beim Live-Deploy am 2026-07-08

Im laufenden Deployment wurde eindeutig bestaetigt, dass zwei unterschiedliche ZIP-Artefakte im Umlauf waren:

- altes Artefakt:
  - `qradar-analyst-deck/analyst-deck-sdk.zip`
  - Groesse: `168755` Bytes
- neues korrektes Artefakt:
  - `qradar-analyst-deck/analyst-deck.zip`
  - Groesse: `82506` Bytes

Wichtige Einordnung:

- das alte `analyst-deck-sdk.zip` enthielt noch den frueheren unguenstigen Zustand
- das neue `analyst-deck.zip` ist das manuell korrigierte und neu gepackte App-SDK-Paket

Lokal verifiziert wurde dies ueber:

```powershell
Get-ChildItem .\qradar-analyst-deck
```

### 26. Erste gesunde App-Instanz `1355` am 2026-07-08

Die neue App-ID `1355` ist die erste bislang verifizierte Instanz, bei der der App-Container selbst fachlich gesund hochkommt.

Live-Pruefungen:

```bash
curl -sk -u admin:*** https://localhost/api/gui_app_framework/application_creation_task/1355
curl -sk -u admin:*** https://localhost/api/gui_app_framework/applications/1355
podman ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep qapp-1355
curl -sk http://127.0.0.1:43335/
curl -sk http://127.0.0.1:43335/debug
```

Verifizierter Befund:

- QRadar-Taskstatus: weiterhin `CREATING`
- laufender Container:
  - `qapp-1355-oLlR2K2n`
- Port-Mapping:
  - `0.0.0.0:43335->5000/tcp`
- Root-URL `/` liefert die HTML-Oberflaeche
- `/debug` liefert:

```json
{"ok":true,"status":"pong"}
```

Wesentliche Schlussfolgerung:

- der fruehere App-Code-/UI-Blocker ist fuer `1355` beseitigt
- die verbleibende Stoerung sitzt nun in der QRadar-Plattform-Finalisierung und nicht mehr primaer im Flask-App-Code

### 27. Kontrollierter Plattform-Repair am 2026-07-08

Da `1355` trotz gesundem Container im Zustand `CREATING` verblieb, wurden zwei gezielte Plattform-Schritte ausgefuehrt.

#### 27.1 Hostcontext-Restart

Durchgefuehrt:

```bash
systemctl restart hostcontext
systemctl is-active hostcontext
curl -sk -u admin:*** https://localhost/api/gui_app_framework/application_creation_task/1355
```

Ergebnis:

- `hostcontext` kam sauber wieder hoch
- die App `1355` blieb trotzdem auf `CREATING`

#### 27.2 Tomcat-Restart

Durchgefuehrt:

```bash
systemctl restart tomcat
systemctl is-active tomcat
journalctl -u tomcat --since '2026-07-08 02:37:00' --no-pager | tail -n 120
ss -ltnp | egrep ':443|:8080|:8443|:8009'
```

Wichtige Beobachtungen:

- `tomcat` musste beim Stoppen per Timeout hart beendet werden
- danach wurde `tomcat` sauber neu gestartet
- Listener danach wieder aktiv:
  - `*:443`
  - `*:8080`
  - `127.0.0.1:8009`
- beim Neustart wurden Warnungen zu nicht mehr vorhandenen JAR-Dateien geloggt:
  - `jackson-annotations-2.15.4.jar`
  - `jackson-core-2.15.4.jar`
  - `jackson-databind-2.15.4.jar`

Diese Warnungen muessen beobachtet werden, sind aber aktuell noch nicht als alleinige Root Cause bestaetigt.

### 28. Aktueller Live-Befund nach beiden Service-Restarts

Stand waehrend dieses Dokuments:

- `hostcontext` laeuft wieder
- `tomcat` laeuft wieder
- `httpd` lauscht wieder auf `443`
- der App-Container `qapp-1355-oLlR2K2n` bleibt stabil `Up`
- QRadar pollt den Container weiterhin zyklisch
- der App-Create-Task wurde bis zu diesem Stand noch nicht von `CREATING` nach `RUNNING` oder `ERROR` umgeschaltet

Einordnung:

- App-Schicht: aktuell gesund
- QRadar-App-Framework-/Finalisierungsschicht: weiterhin haengend
- weiterer Fokus:
  1. Abschluss des `tomcat`-Warmups abwarten
  2. App-Task `1355` erneut gegen die API pruefen
  3. falls weiter `CREATING`, gezielt GUI-App-Framework-/Quartz-/Tomcat-Folgelogs auswerten

### 29. Finaler Registry-/Deploy-Repair und erfolgreicher Analyst-Deck-Start am 2026-07-08

Nach der weiteren Live-Diagnose wurde der letzte echte Deploy-Blocker sauber isoliert und beseitigt.

#### 29.1 Verifizierter Root Cause

Der zunaechst sichtbare QRadar-Fehler war:

```text
An error occurred while checking if image matching regex [(qradar-app-base:4).*] exists in the registry.
Task state found to be [EXCEPTION].
```

Die entscheidende Diagnose war:

- die lokale Registry selbst war erreichbar
- `qradar-app-base` existierte bereits mit Tag:
  - `4.0.11`
- aber `docker-distribution` loggte bei jedem Deploy-Versuch TLS-Handshake-Fehler fuer den Registry-Client

Verifizierter Registry-Befund:

```bash
curl -k --cert /etc/podman/tls/registry/podman-client-registry.cert \
  --key /etc/podman/tls/registry/podman-client-registry.key \
  https://localhost:5000/v2/_catalog

curl -k --cert /etc/podman/tls/registry/podman-client-registry.cert \
  --key /etc/podman/tls/registry/podman-client-registry.key \
  https://localhost:5000/v2/qradar-app-base/tags/list
```

Ergebnis:

- Repository `qradar-app-base` vorhanden
- Tag `4.0.11` vorhanden

Der eigentliche Fehler lag tiefer:

- `/etc/podman/tls/registry/podman-client-registry.cert` war bereits korrekt repariert
- aber die davon abgeleiteten Kopien unter
  - `/etc/containers/certs.d/console.localdeployment:5000/`
  - `/etc/containers/certs.d/qradarce.nexora.local:5000/`
  - `/etc/containers/certs.d/b4bfd3831e60107b66c4.localdeployment:5000/`
  waren noch alt und kryptographisch ungueltig

Verifiziert wurde das mit:

```bash
openssl verify -partial_chain \
  -CAfile /etc/docker-distribution/tls/docker-distribution_ca.crt \
  /etc/containers/certs.d/console.localdeployment:5000/podman-client-registry.cert
```

Vor dem Fix kam dort:

- `certificate signature failure`

#### 29.2 Durchgefuehrter Fix

Zuerst wurde das korrekte Client-Zertifikat in die drei aktiven `certs.d`-Verzeichnisse verteilt.

Verwendetes IBM-/QRadar-Skript:

```bash
/opt/ibm/si/si-podman/bin/place-registry-client-certs.sh \
  /etc/podman/tls/registry \
  b4bfd3831e60107b66c4.localdeployment \
  qradarce.nexora.local \
  console.localdeployment
```

Danach wurden alle drei Zielkopien erneut geprueft:

```bash
openssl verify -partial_chain \
  -CAfile /etc/docker-distribution/tls/docker-distribution_ca.crt \
  /etc/containers/certs.d/console.localdeployment:5000/podman-client-registry.cert
```

Ergebnis danach:

- alle drei Zielzertifikate `OK`

#### 29.3 Verifizierter Effekt des Fixes

Beim naechsten echten Deploy-Versuch lief der zuvor blockierende QRadar-Task erstmals erfolgreich durch:

- `RegistryAvailableTask` = `COMPLETED`
- `RegistryImageRegexQueryTask` = `COMPLETED`

Danach wurden weitere Build-/Create-Tasks sichtbar:

- `BuildImageTask`
- `PushImageTask`
- `PlatformCreateAppTask`

Wichtiger technischer Nachweis:

- der Build-Prozess lief real auf dem Host:

```bash
podman build -t console.localdeployment:5000/qapp/1452:1.0.0-20260708040831 /storetmp/AppFW_1452
```

- der Push war erfolgreich:
  - `PushImageTask` = `COMPLETED`

#### 29.4 Erfolgreicher App-Deploy

Der erfolgreiche Deploy wurde mit dem reparierten Artefakt ausgefuehrt:

```bash
qapp deploy -p analyst-deck.zip -q 10.0.10.190 -u admin -o admin -t 600
```

Verifizierter Endstatus:

```text
Application 1452: COMPLETED
Final application state: RUNNING 1.0.0
```

API-Nachweis:

```bash
curl -k -s -H 'SEC: <Authorized-Service-Token>' -H 'Version: 16.0' \
  https://localhost/api/gui_app_framework/application_creation_task/1452

curl -k -s -H 'SEC: <Authorized-Service-Token>' -H 'Version: 16.0' \
  https://localhost/api/gui_app_framework/applications
```

Ergebnis:

- Create-Task `1452` = `COMPLETED`
- App-Status = `RUNNING`

Container-Nachweis:

```bash
podman ps -a --format '{{.Names}} {{.Status}} {{.Image}}' | grep 1452
```

Ergebnis:

- `qapp-1452-vScXPhUg`
- Status:
  - `Up`

Container-Log-Nachweis:

```text
INFO spawned: 'startflask' with pid 65
INFO success: startflask entered RUNNING state
```

#### 29.5 Aktueller belastbarer Stand

Stand nach dem Repair:

- QRadar-Console online
- Admin-Login nutzbar
- Registry-TLS fuer App-Deploy repariert
- Analyst-Deck erfolgreich deployed
- laufende produktive Test-App:
  - App-ID `1452`
  - Version `1.0.0`
  - Status `RUNNING`

#### 29.6 Operative Folgeempfehlung

Die Infrastruktur ist jetzt ausreichend stabil fuer den naechsten Evaluierungsblock.

Sinnvolle unmittelbare Folgepunkte:

1. App im QRadar-UI oeffnen und Screenshot sichern
2. Authorized Service / Berechtigungen fuer App-Zugriffe dokumentieren
3. Curator-/Analyst-Use-Cases auf Basis der jetzt laufenden App aufbauen
4. weitere Screenshots ablegen fuer:
   - App Management
   - laufende App `1452`
   - Analyst-Deck-Oberflaeche
   - Offense-/Use-Case-Ansichten
