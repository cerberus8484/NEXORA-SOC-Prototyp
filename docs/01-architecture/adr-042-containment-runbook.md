# Runbook — Containment Real-Exec scharfschalten (ADR-042, Linux/nftables)

> Ziel: Den menschlich ausgelösten Endpoint-Containment-Kanal (Host-Isolation via SSH +
> nftables) kontrolliert aktivieren, im Lab smoke-testen und sicher wieder abschalten.
> Der Kanal ist **fail-closed**: ohne `HUNT_RESPONSE_REAL_EXEC_ENABLED` UND ohne Deploy-
> Keypair UND ohne `HUNT_RESPONSE_MGMT_CIDR` passiert nichts.
>
> Bezug: `ADR-042` (docs/adr/decisions.md), `containmentRunner.js`, `deploy/isolate-host.sh`,
> `deploy/release-isolation.sh`. **Nur Operator — nicht in CI. Erst Lab, dann Prod.**

---

## ⚠️ Vorwarnung

`isolate_host` fährt auf einem **echten, produktiven Host** eine root-`nftables`-Isolation:
DROP für alles außer dem Management-Kanal. Das ist ein riskanter Schreibpfad. Alles ist
gegated (Kill-Switch + Vier-Augen + Reauth + Drei-Parteien + Host-Key-Pin + Mgmt-Preservation
+ Concurrency-Lock + Audit), aber die **Kern-Invariante liegt beim Operator**: der Management-
Kanal darf nie gekappt werden — sonst ist `release_isolation` nicht mehr zustellbar und der
Host nur noch über die physische/Hypervisor-Konsole erreichbar.

Das Skript erhält den Kanal doppelt: **primär** die tatsächliche SSH-Peer-IP + den echten
Server-Port aus `$SSH_CONNECTION`, **ergänzend** das deklarierte `HUNT_RESPONSE_MGMT_CIDR`.
Trotzdem gilt: die CIDR sauber pflegen und **erst im Lab üben**.

---

## Vorbedingungen (ohne diese kein Live-Containment)

| Baustein | Anforderung | Prüfung |
|---|---|---|
| **Managed Node (Linux)** | Ziel-Host ist in der Registry enrollt, OS = Linux, hat eine eindeutige `ip` (keine Doppel-Records je IP). | `findNodesByIp(ip)` liefert **genau einen** Node (sonst `E_AMBIGUOUS_NODE`). |
| **Gepinnter Host-Key** | `installed_nodes.host_key_pin` (SHA-256) ist erfasst (kein TOFU). | Node-Detail zeigt `hostKeyPin`; sonst zuerst Host-Key erfassen. |
| **Deploy-Keypair** | Platform-Deploy-Keypair existiert (ADR-041), Pubkey liegt in `~/.ssh/authorized_keys` (root) des Ziel-Hosts. | `POST /deploy/keypair/generate` gelaufen; SSH als root klappt. |
| **`nftables`** | `nft` ist auf dem Ziel-Host installiert (kein iptables-Fallback in Slice 3a). | `command -v nft` auf dem Host. |
| **Mgmt-CIDR = echte Egress-IP** | `HUNT_RESPONSE_MGMT_CIDR` deckt die **tatsächliche(n)** Quell-IP(s) ab, mit denen das Nexora-Backend den Ziel-Host per SSH erreicht. | Boot-Log `containment_real_exec_armed` (nicht `_misconfig`). |
| **Rollen** | Anforderer (analyst+), Genehmiger (admin/engineer, ≠ Anforderer), Ausführer (**admin**, ≠ Anforderer) — mindestens 2 verschiedene Menschen. | Drei-Parteien-Gate erzwingt es. |

---

## Schritt 1 — ENV setzen (Prod-Fail-fast)

In `deploy/.env.production` (nie in Git):

```bash
HUNT_RESPONSE_REAL_EXEC_ENABLED=true      # Kill-Switch scharf (default AUS)
HUNT_RESPONSE_MGMT_CIDR=10.0.10.75/32     # ECHTE Backend-Egress-IP(s) — NICHT raten
HUNT_RESPONSE_MGMT_SSH_PORT=22            # SSH-Port, über den Nexora den Host steuert
```

`HUNT_RESPONSE_MGMT_CIDR` so eng wie möglich (idealerweise `/32` der Backend-IP). Bei HA/mehreren
Backends das gemeinsame Mgmt-Subnetz. **Bei jeder Netz-Änderung nachziehen.**

## Schritt 2 — Boot-Healthcheck prüfen

Nach dem Neustart im API-Log:

- ✅ `containment_real_exec_armed {"mgmtCidr":"10.0.10.75/32"}` → Config plausibel.
- ⚠️ `containment_real_exec_misconfig {"issue":"HUNT_RESPONSE_MGMT_CIDR fehlt …"}` → **stoppen**, CIDR/Port fixen, Neustart. (Kein Boot-Abbruch — aber Isolation würde zur Laufzeit fail-closed abbrechen.)

---

## Schritt 3 — Lab-Smoke (Arming-Blocker #5, PFLICHT vor Prod)

Auf einem **Wegwerf-Lab-Host** (kein Prod!), der als managed Node enrollt + host-key-gepinnt ist:

1. **Zweiter Kanal bereithalten** — Hypervisor-/Konsolen-Zugang zum Lab-Host, falls die Isolation den Mgmt-Kanal doch kappt (Recovery, s.u.).
2. **Anfrage** (Analyst): im ThreatHunts-Panel `Host isolieren` für die Ziel-IP anfragen.
3. **Genehmigung** (Admin ≠ Analyst): mit dokumentierter Rechtsgrundlage genehmigen (Vier-Augen).
4. **Ausführung** (Admin ≠ Anforderer): im Abschnitt „Bereit zur Ausführung" Passwort (Reauth) eingeben → `Ausführen`.
5. **Isolation verifizieren** auf dem Lab-Host (über die noch offene Session):
   ```bash
   nft list table inet nexora_containment          # Tabelle existiert, policy drop
   ```
   - Mgmt-SSH funktioniert weiter (diese Session lebt; ein FRISCHER SSH aus dem Mgmt-CIDR klappt).
   - Eine Verbindung aus einem **anderen** Netz zum Host ist geblockt (z.B. Ping/Port von einem Nicht-Mgmt-Host).
6. **Freigabe**: `Isolation aufheben` anfragen → genehmigen → ausführen.
7. **Konnektivität verifizieren**:
   ```bash
   nft list table inet nexora_containment          # → Fehler „No such file" = Tabelle weg
   ```
   Voller Netzzugang wieder da.

**Zusätzlich (Arming-Blocker #2, semantischer Test):** den Struktur-Test lokal fahren —
```bash
bash deploy/tests/containment-scripts.test.sh       # 16 Checks, mockt nft
```
Für die echte netns-Semantik (Session in-/out-of-CIDR) einen Container/Netns-Test auf einem
Linux-Host ergänzen (offen).

---

## Verifikations-Checkliste (vor „Prod scharf")

- [ ] Boot-Log zeigt `containment_real_exec_armed` (nicht `_misconfig`).
- [ ] Lab-Smoke: Isolation aktiv **und** Mgmt-Session überlebt.
- [ ] Lab-Smoke: Freigabe stellt Konnektivität voll wieder her.
- [ ] Drei-Parteien real geübt (3 verschiedene Logins bzw. ≥ 2).
- [ ] `deploy/tests/containment-scripts.test.sh` grün.
- [ ] Recovery-Pfad (Hypervisor-Konsole) für Prod-Hosts dokumentiert/griffbereit.

---

## Rollback / Abschalten (Disarm)

- **Einzelne Isolation aufheben:** über die UI `Isolation aufheben` (bevorzugt), oder direkt am Host:
  ```bash
  nft delete table inet nexora_containment
  ```
- **Kanal komplett stilllegen:** `HUNT_RESPONSE_REAL_EXEC_ENABLED=false` (bzw. Variable entfernen) → Neustart. Ab dann liefert `execute` sofort `E_REAL_EXEC_DISABLED`, ohne den Host zu berühren.

### Notfall — Mgmt-Kanal verloren (Self-Lockout)

Falls ein Host nach `isolate_host` nicht mehr per SSH erreichbar ist (falsche Mgmt-CIDR + kein
`$SSH_CONNECTION`-Treffer):

1. Über **Hypervisor-/physische Konsole** einloggen (nicht SSH).
2. `nft delete table inet nexora_containment` → Isolation weg, Konnektivität zurück.
3. Ursache fixen: `HUNT_RESPONSE_MGMT_CIDR` auf die **echte** Backend-Egress-IP setzen, Neustart, Boot-Log prüfen.

---

## Troubleshooting — Fehlercodes

| Code | HTTP | Bedeutung / Fix |
|---|---|---|
| `E_REAL_EXEC_DISABLED` | 503 | Kill-Switch aus → `HUNT_RESPONSE_REAL_EXEC_ENABLED=true` + Neustart. |
| `E_REAUTH` | 401 | Reauth fehlt/abgelaufen → Passwort im Execute-Feld erneut eingeben. |
| `E_UNSUPPORTED_REAL_EXEC` | 400 | Aktion ist nicht umkehrbar (nur `isolate_host`/`release_isolation` real ausführbar). |
| `E_SELF_EXECUTE` | 403 | Ausführer = Anforderer → anderer Admin muss ausführen (Drei-Parteien). |
| `E_NOT_APPROVED` | 409 | Aktion ist nicht `approved` (erst Vier-Augen-Genehmigung). |
| `E_EXEC_IN_PROGRESS` | 409 | Für den Host läuft bereits eine Ausführung (Concurrency-Lock) → kurz warten. |
| `E_NO_NODE` | 503 | Ziel-Host ist kein enrollter managed Node → zuerst enrollen. |
| `E_AMBIGUOUS_NODE` | 503 | Mehrere Registry-Records teilen die IP → Registry bereinigen (DHCP-Altlast). |
| `E_UNSUPPORTED_OS` | 503 | Windows-Node → Slice 3c (noch nicht verfügbar). |
| `E_NO_HOST` | 503 | Node hat keine IP in der Registry. |
| `E_NO_HOSTKEY` | 503 | Kein gepinnter Host-Key (kein TOFU) → Host-Key erfassen. |
| `E_NO_MGMT_PRESERVE` | 503 | `isolate_host` ohne `HUNT_RESPONSE_MGMT_CIDR` → Selbst-Aussperr-Schutz; CIDR setzen. |
| `E_NO_CHANNEL` | 503 | Kein Deploy-Keypair → `POST /deploy/keypair/generate`. |
| `E_EXEC` / `E_EXEC_FAILED` | 502 | Transport-/Exit-Fehler auf dem Host (stderr nur im Server-Log). Host + `nft` prüfen. |

---

## Windows-Containment (Slice 3c)

Gleiches Bedien-/Genehmigungsmodell wie Linux; Unterschiede:

| Punkt | Linux | Windows |
|---|---|---|
| Mechanismus | nftables (`inet nexora_containment`) | Windows-Firewall (Regel-Gruppe `NexoraContainment` + Default-Block) |
| Skripte | `isolate-host.sh` / `release-isolation.sh` | `isolate-host.ps1` / `release-isolation.ps1` |
| SSH-User | `root` | `Administrator` (muss lokaler Admin sein) |
| Voraussetzung | `nft` vorhanden | OpenSSH-Server + `NetSecurity`-Modul, SSH-User = Administrator |
| Freigabe-Zustand | Tabelle löschen | vorheriger Firewall-Default aus State-Datei (`%ProgramData%\Nexora\containment-fw-state.json`) |

**Wichtig (fail-closed):** Geht die State-Datei zwischen Isolation und Freigabe verloren, verweigert
`release-isolation.ps1` die automatische Freigabe (Lockout-Schutz) — die Isolation bleibt (Mgmt-Kanal
über die Allow-Regeln erhalten), bis manuell wiederhergestellt wird. Recovery via Konsole:
`Get-NetFirewallRule -Group NexoraContainment | Remove-NetFirewallRule` und `Set-NetFirewallProfile`
auf den gewünschten Default zurücksetzen.

**SSH-User:** Default `Administrator` (bzw. `root` auf Linux). Für ein dediziertes IR-Konto das Node-Feld
`sshUser` setzen (z.B. `DOMAIN\svc-ir`) — es übersteuert den Default (validiert). **Windows-Arming-Blocker:**
nur noch der eigene Windows-Lab-Smoke. Struktur-Test: `deploy/tests/containment-scripts.windows.test.ps1`.

## Offen (nach diesem Runbook)

- **Slice 3c:** Windows-Containment (`isolate-host.ps1`, Windows-Firewall) + OS-Routing im Runner — eigener Security-Review.
- **Semantischer netns/Container-Test** der Mgmt-Preservation (Arming-Blocker #2, Linux-Lab).
- **Circuit-Breaker:** Kanal-Sperre nach wiederholten `E_EXEC_FAILED` (analog `apply_safety_lock`).
- **Verteilter Lock** (DB-Advisory) statt In-Process-Lock, sobald mehrere API-Instanzen laufen.
