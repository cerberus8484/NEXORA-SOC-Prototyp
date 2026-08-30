# Network as Code in Nexora — Konzept und Praxis

> **Ehrlicher Stand (2026-08-01).** Was hier als *gebaut* markiert ist, läuft und ist
> getestet. Was als *geplant* markiert ist, existiert noch nicht — dieser Abschnitt
> beschreibt die Absicht, nicht die Realität. Nichts in diesem Dokument beschreibt
> eine Fähigkeit, die es nicht gibt.

---

## 1. Was „Network as Code" hier bedeutet

Nicht: „ein YAML beschreibt das Netz und irgendetwas macht das schon."

Sondern: **Jede Veränderung an der Infrastruktur ist ein nachvollziehbarer, geprüfter
und umkehrbarer Vorgang** — beschrieben als Daten, ausgeführt über einen Kanal, der
protokolliert, was passiert ist.

Drei Eigenschaften machen den Unterschied zu „ein Skript rennt über die Server":

| Eigenschaft | Wie Nexora es einlöst |
|---|---|
| **Beschreibbar** | Was installiert werden kann, steht als Modul-Katalog im Code — nicht als Freitext-Kommando. Ein Deploy ist eine `DeploySpec` (Daten), kein Shell-Aufruf. |
| **Prüfbar vor der Wirkung** | `plan` rechnet trocken durch und schreibt nichts. Erst `approve` (Vier-Augen) + `apply` (frische Passwort-Bestätigung) verändern etwas. |
| **Nachvollziehbar danach** | Jeder Schritt landet im Deploy-Audit: wer, wann, was, mit welchem Ergebnis. Secrets sind dort nie enthalten. |

Der Kern ist bewusst **kein** frei ausführbarer Fernzugriff. Es gibt keine Funktion
„führe Befehl X auf Host Y aus". Es gibt nur: *wähle ein Modul aus dem Katalog,
fülle dessen deklarierte Parameter, lass es planen, genehmigen, anwenden.*

---

## 2. Die Bausteine (alle gebaut)

```
   Modul-Katalog          DeploySpec            Run (FSM)            Adapter
   (was ist möglich)   →  (was konkret)      →  planned/approved  →  (wie ausführen)
   Code-Allowlist         validiert gegen        /applying/…           SSH-Transport
                          paramSchema            deployed/rolled_back  Host-Key-Pinning
```

**Modul-Katalog** (`backend/src/deploy/deployModuleCatalog.js`) — die Allowlist
dessen, was überhaupt deploybar ist. Zwei Arten:

- `vm-clone` — neue VM aus einem Golden-Template (Greenfield), z. B. `windows-server`
- `agent-install` — Software auf einen **bestehenden** Host (Brownfield), z. B.
  `linux-client`, `windows-client`, `firewall-collector`

**paramSchema** — jedes Modul deklariert seine Parameter mit Typ, Pflicht, Default und
Muster. Das ist die *eine* Quelle der Wahrheit: das Backend validiert dagegen, und das
Formular im Deployment Center wird daraus erzeugt. Ein neues Modul braucht deshalb
**keine** UI-Änderung.

**Connector** — die Verbindung zum Ziel. Beim SSH-Connector liegen privater Schlüssel
und Passphrase AES-256-GCM verschlüsselt; der **Host-Key ist gepinnt** (kein
Vertrauen-beim-ersten-Kontakt). Ein Connector = ein Host.

**Adapter + Runner** — führt auf dem Ziel ein Skript aus einer **Allowlist** aus
(`scriptId`, nie ein freier Befehl). Parameter gehen ausschließlich als validierte
Umgebungsvariablen, nie in eine Kommandozeile.

**Gates** — `DEPLOY_ENABLED` (Kill-Switch, Standard aus) · Vier-Augen-Genehmigung ·
frische Reauth beim Anwenden · Rollback-Semantik · Audit.

---

## 3. So macht man es heute — Schritt für Schritt

Beispiel: **Firewall-Collector auf einen bestehenden Linux-Host.**

### Voraussetzungen

1. `DEPLOY_ENABLED=true` in `deploy/.env.production` (Standard ist `false` = alles inert)
2. Ein SSH-Connector für den Zielhost (siehe 3.1)
3. Das Collector-Artefakt an einer erreichbaren Stelle + seine SHA256 (siehe Abschnitt 4)
4. Zwei Admins — einer plant, ein **anderer** genehmigt

### 3.1 Connector anlegen (einmalig pro Zielhost)

Deployment Center → *Connector anlegen* → Typ **SSH**:

| Feld | Bedeutung |
|---|---|
| Host | Ziel-Host (IP/DNS) |
| SSH-Benutzer / -Port | Zugang auf dem Ziel |
| Private Key | wird verschlüsselt gespeichert, ist danach nie wieder lesbar |
| Host-Key-Pin | SHA256-Fingerprint des Ziel-Hostkeys |

Den Fingerprint des Ziels ermittelst du **vorher selbst** — nicht raten:

```bash
ssh-keyscan -t ed25519 10.0.10.90 2>/dev/null | ssh-keygen -lf - -E sha256
```

> Das Anlegen verlangt eine frische Passwort-Bestätigung (Step-up), weil dabei ein
> Geheimnis gespeichert wird.

### 3.2 Modul wählen + Parameter füllen

Deployment Center → Gruppe **Kollektoren / Data-Plane** → *Firewall-Collector*.

Die Felder erscheinen automatisch aus dem `paramSchema`:

| Feld | Beispiel | Pflicht |
|---|---|---|
| Collector-Version | `v1.2.0` | ja |
| SHA256-Prüfsumme | 64 Hex-Zeichen | **ja** |
| Nexora-Intake-URL | `https://10.0.10.75/api/v1/dataplane/events` | ja |
| Bezugsquelle | leer = Standard, oder `https://10.0.10.75/artifacts` | nein |

Ziel-Host, SSH-Benutzer und -Port werden **nicht** abgefragt — sie kommen aus dem
Connector. Der gepinnte Host-Key gilt genau für diesen Host; eine zweite Eingabe
könnte auseinanderlaufen.

### 3.3 Plan (Trockenlauf — schreibt nichts)

Erzeugt eine `DeploySpec` und einen Run im Zustand `planned`. Es wird **nichts** auf
dem Ziel ausgeführt. Der Plan zeigt, was passieren würde.

### 3.4 Genehmigen + Anwenden

- **Genehmigung** durch einen *anderen* Admin (Vier-Augen)
- **Apply** verlangt eine frische Passwort-Bestätigung des anwendenden Admins

Erst jetzt läuft der Installer auf dem Ziel. Der Run wandert
`applying → deployed` oder bei Fehlschlag in einen dokumentierten Fehlerzustand.

### 3.5 Was der Installer auf dem Ziel tut

1. Prüft die übergebenen Werte **selbst** noch einmal (Defense-in-Depth)
2. Lädt das Artefakt über HTTPS (`--proto '=https' --tlsv1.2`)
3. **Vergleicht die SHA256** — stimmt sie nicht: Abbruch, Datei löschen, nichts installieren
4. Installiert Binary + systemd-Unit (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`)
5. Schreibt die Konfiguration mit `0600`, **bevor** sie befüllt wird (kein kurzes
   world-readable Fenster für das Token)
6. Startet den Dienst

Idempotent: Läuft bereits dieselbe Version, bleibt das Binary unangetastet.

---

## 4. Das Artefakt bereitstellen

Der Collector liegt im **privaten** Data-Plane-Repo. Ausgeliefert wird ein gebautes
Binary. Zwei gleichwertige Wege — die Integrität sichert in beiden Fällen die
Prüfsumme, nicht die Herkunft:

### Weg A — GitHub-Release (Standard)

```bash
# im privaten Data-Plane-Repo bauen
GOOS=linux GOARCH=amd64 go build -o nexora-firewall-collector_v1.2.0_linux_amd64 ./cmd/firewall

# Prüfsumme bilden — DIESEN Wert gibst du später im Deployment Center an
sha256sum nexora-firewall-collector_v1.2.0_linux_amd64

# als Release-Asset ins ÖFFENTLICHE Control-Plane-Repo hochladen
gh release create v1.2.0 nexora-firewall-collector_v1.2.0_linux_amd64 \
  --repo cerberus8484/Nexora-Control-Plane --notes "Firewall-Collector v1.2.0"
```

Erwarteter Dateiname: `nexora-firewall-collector_<version>_linux_<amd64|arm64>`

### Weg B — Interner Webserver (kein GitHub nötig)

Datei unter einer HTTPS-URL ablegen, die dem Muster
`<Bezugsquelle>/<version>/<dateiname>` folgt:

```
https://10.0.10.75/artifacts/v1.2.0/nexora-firewall-collector_v1.2.0_linux_amd64
```

Dann im Feld **Bezugsquelle** `https://10.0.10.75/artifacts` eintragen. Für
Air-Gap-Umgebungen ist das der vorgesehene Weg.

> **Warum die Prüfsumme trotzdem Pflicht bleibt:** Gerade bei einer selbst gehosteten
> Quelle gibt es keine externe Signatur, die für dich bürgt. Der SHA256-Vergleich ist
> dann das Einzige, was „richtige Datei" von „irgendeine Datei" unterscheidet.

---

## 5. Live-Smoke — das erste echte Deploy

Bis hierher ist alles **inert**: `DEPLOY_ENABLED` ist standardmäßig `false`, es kann
nichts passieren. Der erste scharfe Lauf gehört bewusst geplant.

**Vorbedingungen:**

- [ ] Ein **Wegwerf-Zielhost** (keine Produktion) mit SSH-Zugang
- [ ] Artefakt + SHA256 erreichbar (Abschnitt 4)
- [ ] `DEPLOY_ENABLED=true` gesetzt, Stack neu gestartet
- [ ] Zweiter Admin für die Genehmigung verfügbar
- [ ] Rückweg klar: `systemctl disable --now nexora-firewall-collector` + Binary löschen

**Ablauf:** Abschnitt 3 durchgehen. Erfolgskriterium:

```bash
systemctl status nexora-firewall-collector    # active (running)
journalctl -u nexora-firewall-collector -n 20 # keine Fehler
```
…und im Nexora-Intake kommen Events an.

**Wenn es schiefgeht:** Der Run steht im Deploy-Audit mit Grund. Rohe Fehlertexte des
Ziels stehen bewusst **nicht** in der Antwort (sie könnten Pfade oder Tokens
enthalten) — sie stehen serverseitig im Log.

---

## 6. Was noch fehlt (Phase 4, geplant — NICHT gebaut)

Heute beschreibt man **einen** Deploy zur Zeit über die Oberfläche. Das ist bereits
nachvollziehbar und geprüft, aber es ist noch nicht *deklarativ*: Es gibt keine Datei,
die den Soll-Zustand des gesamten Netzes beschreibt.

Der geplante Schritt:

```yaml
# nexora-network.yaml  (BEISPIEL — dieses Format existiert noch nicht)
nodes:
  - host: 10.0.10.90
    connector: fw-edge
    modules:
      - firewall-collector:
          version: v1.2.0
          sha256: "…"
          intakeUrl: https://10.0.10.75/api/v1/dataplane/events
  - host: 10.0.20.15
    connector: client-01
    modules:
      - linux-client: { wazuhManager: 10.0.10.77 }
```

→ `plan` errechnet die **Differenz** zwischen Soll und Ist → Genehmigung → `apply`
wendet nur die Differenz an. Dieselben Gates, dieselben Adapter — nur eben für viele
Knoten auf einmal, aus einer versionierbaren Datei.

Die Bausteine dafür sind vorhanden (Katalog, Schema-Validierung, Spec, Gates, Audit).
Was fehlt, ist der Differenz-Rechner und das Dateiformat.

---

## 7. Grenzen (bewusst so)

- **Kein freier Fernzugriff.** Es gibt keine „führe Befehl aus"-Funktion. Nur Module
  aus dem Katalog, nur Skripte aus der Allowlist.
- **Keine Secrets in der Spec.** Zugangsdaten werden zur Anwendungszeit injiziert, nicht
  im Plan gespeichert — sonst stünden sie in Plan, Audit und Historie.
- **Kein Vertrauen beim ersten Kontakt.** Ohne gepinnten Host-Key kein SSH.
- **Nichts läuft ungeprüft.** Paketquellen sind GPG-gepinnt, MSI-Dateien
  Authenticode-geprüft, eigene Binaries SHA256-verifiziert.

---

## Verwandte Dokumente

- [Deployment Center — Architektur](deployment-center-architecture.md)
- [Modul-Autoren-Leitfaden](deployment-center-module-authoring.md) — ein neues Modul bauen
- [Runbook: Scharfschalten (vm-clone)](deployment-center-runbook.md) — der VM-Klon-Weg
- [Capability-Map](deployment-capability-map.md) — was grundsätzlich möglich ist
