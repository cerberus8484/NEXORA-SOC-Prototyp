# Nexora Linux Bootstrap Installer (P_INSTALL_1)

Registriert einen Linux-Host an der Nexora Control-Plane und startet einen
Heartbeat-Agenten. **Bootstrap-only**: installieren, enrollen, read-only
Systemdaten melden — mehr nicht.

## Ablauf

```
Admin mintet Enrollment-Token (Provisioning-UI)   ← einmalig gültig
  → Host führt bootstrap.sh aus
  → POST /provisioning/enroll  (Token im Body, genau einmal)
  → Backend gibt nodeId + eigenes Node-Credential zurück (Klartext EINMALIG)
  → bootstrap.sh speichert NUR das Node-Credential (root-only), NIE den Token
  → Agent sendet Heartbeats ausschließlich mit dem Node-Credential
  → Node erscheint in der Provisioning-Registry
```

## Credential-Modell (Slice 2)

Zwei klar getrennte Credentials:

| Credential | Präfix | Zweck | Lebensdauer |
|---|---|---|---|
| **Enrollment-Token** | `enr_` | **nur** die einmalige Enrollment-Anfrage | Single-Use — nach dem Enroll verbraucht |
| **Node-Credential** | `ncr_` | **nur** Heartbeats (Betrieb), an die Node gebunden | langlebig, revoke-bar |

- Der Enrollment-Token wird **niemals** auf die Platte geschrieben und nach dem
  Enrollment serverseitig verbraucht — er kann danach weder erneut enrollen noch
  als Heartbeat-Credential dienen.
- Das Node-Credential (256-bit) erscheint im Klartext **genau einmal** in der
  Enrollment-Antwort. Das Backend speichert nur SHA-256-Hash + Präfix + Metadaten.
- Ein Heartbeat mit dem Enrollment-Token wird abgelehnt (401); ein Credential
  einer fremden Node wird abgelehnt (403, Node-Bindung).
- **Lifecycle (P_PROVISION_SECURITY_1, lokal — noch nicht deployt):** ein Admin
  kann ein Node-Credential widerrufen (`POST /provisioning/nodes/:id/credentials/:credId/revoke`)
  oder die ganze Node stilllegen (`POST /provisioning/nodes/:id/retire`, widerruft
  zuerst alle aktiven Credentials). **Danach scheitert jeder weitere Heartbeat des
  Agents mit 401** (widerrufenes Credential) bzw. die Node nimmt keine Heartbeats
  mehr an. Der Agent kennt keinen Re-Enroll-Automatismus — eine stillgelegte Node
  wird bewusst durch erneutes Enrollment (neuer Token) wieder aufgenommen.
- **Verlorene Enrollment-Antwort:** der Token ist verbraucht. Es gibt bewusst
  **keinen** unsicheren Recovery — der Admin mintet einfach ein neues Token.

## Nutzung

```sh
sudo ./bootstrap.sh --server https://nexora.example --token enr_xxxxxxxx
```

| Option | Bedeutung |
|---|---|
| `--server <url>` | Backend-Basis-URL (Pflicht) |
| `--token <enr_…>` | Enrollment-Token aus dem Admin-UI (Pflicht, einmalig gültig) |
| `--dir <pfad>` | Installationsverzeichnis (Default `/opt/nexora-agent`) |

Dateien:
- `bootstrap.sh` — Preflight, einmaliges Enrollment, Agent-Einrichtung
- `nexora-agent.sh` — Heartbeat-Loop (read-only Inventar, Auth nur per Node-Credential)
- `nexora-agent.service` — systemd-Unit (gehärtet: `NoNewPrivileges`, `ProtectSystem=strict`)
- `test/e2e_local.sh` + `test/mock_server.js` — lokale E2E-Harness (siehe unten)

`agent.env` (`chmod 600`, nur root) enthält ausschließlich:

```
NEXORA_SERVER=...
NEXORA_NODE_ID=...
NEXORA_NODE_CREDENTIAL=ncr_...
```

— **kein** Enrollment-Token. Secrets gehen bei `curl` über stdin (`--data-binary @-`
bzw. `-K -`), nicht als Kommandozeilen-Argument — so sind sie nicht via `ps` /
`/proc/PID/cmdline` sichtbar.

## Lokaler E2E-Test

```sh
sh deploy/install/test/e2e_local.sh
```

Fährt `bootstrap.sh` real gegen einen lokalen Mock-Server (127.0.0.1, ephemerer
Port, `systemctl` gestubbt → kein dauerhafter Dienst) und prüft: `agent.env`
enthält nur das Node-Credential, Heartbeat mit Credential → 200, Heartbeat mit
Enrollment-Token → 401. Alle temporären Dateien/Prozesse werden aufgeräumt.
**Kein echter Host, kein Lab, kein Netzwerk-Setup.** Zusätzlich deckt
`backend/tests/install/credentialHandoffE2E.test.js` denselben Fluss gegen das
echte (InMemory-)Backend ab.

## Sicherheitsgarantie (CI-erzwungen)

Der Installer **ändert niemals** IP, DHCP, Gateway, DNS, VLAN, NAT, Routing,
Sniffing/Mitschnitt, Firewall, Wazuh oder OPNsense. Diese Regel ist nicht nur
Vorsatz: `backend/tests/install/installerSafety.test.js` scannt jede ausführbare
Zeile der Skripte gegen eine Forbidden-Liste solcher Werkzeuge — findet der Scan
auch nur eine, wird CI rot. Der Heartbeat wertet die Server-Antwort nicht aus;
es gibt **keinen Command-/Apply-Kanal** zum Host.

## Was hier (noch) nicht passiert

- Keine echte Paket-Installation/Abhängigkeiten (folgt als eigener Slice).
- Kein Remote-Command, kein Self-Update, keine Host-Härtung außerhalb des
  Agent-Verzeichnisses.
- Rate-Limit auf `/enroll`/`/heartbeat` + Admin-Revoke/Retire + FK-Cascade sind
  in **P_PROVISION_SECURITY_1 gebaut (lokal, noch nicht deployt)**. Offen bleibt
  bewusst die **Credential-Rotation** (neues Credential + Übergangsfenster, eigener Block).
- Noch kein Lab-VM-Test (Slice 3, erst nach explizitem GO; weiterhin nur
  read-only Inventory + Heartbeat, nie Netzwerkkonfiguration).
