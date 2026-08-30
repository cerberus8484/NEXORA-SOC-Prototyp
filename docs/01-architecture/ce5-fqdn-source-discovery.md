# CE-5.1 — FQDN Source Discovery (read-only)

> **Ziel:** Wenn Event-Computer **und** Inventory keinen FQDN liefern — welche **belegbaren**
> Quellen kann Nexora zusätzlich nutzen, ohne Fakes? Read-only-Erkundung im Lab am 2026-06-17.
> **Kein** Code-Change, kein Wazuh-/OPNsense-Write, kein Restart. Ergebnis steuert CE-5.2.

## Befundlage (live geprüft, nexora 10.99.99.75)

### 1. Wazuh Syscollector / Agent-API
- `syscollector/<id>/os` liefert **nur `hostname` (Kurzname)** — Keys: `os, scan, os_release, architecture, hostname, agent_id`. **Kein `domain`, kein `fqdn`.** (Windows **und** Linux gleich.)
- `agents/<id>` liefert `name`, `ip`, `os{…}`, `registerIP` — **kein FQDN/Domain**.
- ⚠️ **Falle:** `agent.name` kann vom echten Hostnamen abweichen — Agent **001** heißt `name="WindowsClient"`, aber `syscollector.hostname="CERBERUS"`. → Host-Quelle = `syscollector.hostname`, **nicht** `agent.name` (CE-4.3 macht das bereits).
- **Fazit:** Wazuh ist **keine** FQDN-Quelle. Bestätigt CE-4.4 (Inventory-FQDN fast immer `null`).

### 2. DNS — AD-DNS direkt (`dig @10.99.99.10`)
| Abfrage | Ergebnis | Bemerkung |
|---|---|---|
| `DC01.nexora.example` (A) | **10.99.99.10** ✓ | domänen-gejoint, registriert |
| `WEC01.nexora.example` (A) | **10.99.99.11** ✓ | domänen-gejoint |
| `opensourcebackup.nexora.example` (A) | **NONE** | Linux, nicht AD-gejoint |
| `cerberus.nexora.example` / `windowsclient.nexora.example` (A) | **NONE** | nicht in AD-DNS (192.168.241.x) |
| Reverse PTR `10.99.99.10/.11/.72/.75` | **NONE** | **keine Reverse-Zone** in AD-DNS |
| FritzBox-PTR `192.168.241.102` | `Cerberus.localdomain` | nur 192.168.241.x, **anderes** Domain-Suffix, geringe Vertrauensstufe |

- **Forward** funktioniert für **AD-gejointe** Hosts (DC01, WEC01). **Reverse PTR ist nicht vorhanden** (keine Zone) — Reverse-DNS ist im Lab **eine Sackgasse**, bis eine PTR-Zone existiert (Infra-Change, außerhalb App).
- Nexoras eigener Resolver zeigt auf **10.99.99.1** (OPNsense-Unbound), nicht direkt aufs AD — ein App-Resolver sollte den **DNS-Server konfigurierbar** ansprechen (z. B. AD-DNS 10.99.99.10).

### 3. AD / LDAP
- Ports **389 (LDAP), 636 (LDAPS), 88 (Kerberos), 3268 (GC)** auf DC01 **OPEN** → erreichbar.
- Computer-Objekte tragen `dNSHostName` = autoritativer FQDN. **Braucht** aber einen read-only Bind-Service-Account (Credentials via ENV) + LDAP-Client. Schwergewichtiger, dafür höchste Vertrauensstufe.

## Quellenmatrix (Eignung für `sourceFqdn` / `destinationFqdn`)

| Quelle | FQDN? | Vertrauen | Deckung | source | dest | Kosten/Risiko |
|---|---|---|---|---|---|---|
| **Event-Computer** (`win.system.computer`) | ja | hoch | Sysmon-source-Host (domänen-gejoint) | ✅ (live, CE-4.4.1) | — (ist der Melder) | 0 (schon da) |
| **DNS forward-confirm** (`<host>.nexora.example`→A, A==Flow-IP) | ja | hoch (gegen IP verifiziert) | nur AD-gejointe Hosts | ✅ | ⚠️ nur wenn Name-Kandidat bekannt | niedrig (read-only, **keine Creds**) |
| **DNS reverse PTR** | — | — | **keine Zone** | ✗ | ✗ | geparkt (Infra) |
| **FritzBox-PTR** (`.localdomain`) | teils | niedrig (fremdes Suffix) | nur 192.168.241.x | ⚠️ Fallback | ⚠️ Fallback | niedrig, aber low-trust |
| **LDAP `dNSHostName`** | ja | sehr hoch (autoritativ) | alle AD-Computer | ✅ | ✅ (per Name) | mittel (Service-Account, neue Dependency) |
| **Wazuh Syscollector/Agent** | nein (Kurzname) | — | — | ✗ | ✗ | — |

### Antworten auf die 5 Leitfragen
1. **Wazuh Hostname/FQDN/Domain?** Nur Kurzname (`hostname`), kein FQDN/Domain. `agent.name` unzuverlässig.
2. **Verwertbare DNS/PTR-Daten?** Forward ja (AD-gejointe Hosts, IP-verifizierbar). **Reverse PTR nein** (keine Zone). FritzBox-PTR nur 192.168.241.x, low-trust.
3. **AD/LDAP-Computer-Objekte?** Erreichbar (389/636/3268 offen), `dNSHostName` autoritativ — braucht read-only Bind-Account.
4. **Welche Quelle für source/dest?** **source:** Event-Computer (live) → DNS forward-confirm. **dest:** schwierig — meist nur Ziel-IP bekannt, Reverse fehlt → bleibt ehrlich `missingReason`, externe Ziele via CE-5-Threat-Intel. LDAP (per Name) wäre die robuste dest-Lösung, kostet aber Creds.
5. **Korrekte MissingReasons?** `field_missing` (Event hätte gekonnt, fehlt), `threat_intel_pending` (externe Ziele, CE-5-TI). **Neu für CE-5:** `dns_no_record` (geprüft, nichts), `dns_unconfirmed` (A vorhanden, ≠ Flow-IP → nicht vertrauen). Nie ein erfundener FQDN.

## Entscheidung für CE-5.2
**Reihenfolge der Wahrheit im `FqdnResolver` (priorisiert, alle mit Provenance):**
1. **Event-Computer** — live (Sysmon source-Host).
2. **DNS forward-confirm** — gegen einen konfigurierbaren DNS-Server (AD-DNS 10.99.99.10): `<syscollector.hostname>.<domain>` → A; **nur setzen, wenn A == Flow-IP** (Vertrauen hoch, kein Fake). Read-only, **keine Credentials**. Deckt AD-gejointe Hosts (DC01/WEC01).
3. **LDAP `dNSHostName`** — autoritativ, **optional/später**, hinter Config + read-only Service-Account (ENV), opt-in (Security/DSGVO).
4. **Reverse PTR** — **geparkt**, bis eine Reverse-Zone existiert (Infra, nicht App).
5. **FritzBox-`.localdomain`** — optionaler low-confidence-Fallback nur 192.168.241.x.

**Empfohlener erster Bau (CE-5.2):** `FqdnResolver`-Interface (`resolve(ip, hostnameHint?, agentId?) → { fqdn, source, confidence, provenance, missingReason }`) + **DNS-forward-confirm-Source** als erste echte Live-Quelle — read-only, ohne neue Credentials, IP-verifiziert (kein Fake). LDAP als spätere opt-in-Source. `sourceFqdn`/`destinationFqdn` bleiben getrennt; `missingReason` bleibt ehrlich.

**Constraints CE-5 (unverändert):** kein Fake-FQDN · immer Provenance · kein Wazuh-/OPNsense-Write · kein Restart · kein Decoder.
