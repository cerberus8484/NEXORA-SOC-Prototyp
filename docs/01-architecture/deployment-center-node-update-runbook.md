# Runbook — Node-Update scharfschalten (verwaltete Windows-/Linux-Nodes)

> Ziel: Den „updatebar"-Pfad kontrolliert aktivieren und einen verwalteten Node
> (Windows-Server aus vm-clone **oder** Linux-Agent-Host) live aktualisieren:
> Deploy-Keypair → Host-Key pinnen → Update auslösen (gated, reauth, auditiert).
>
> Stand 2026-07-04. Bezug: `ADR-041`, `deployment-center-runbook.md` (vm-clone-Teil),
> `deployment-capability-map.md`. **Nur Operator — nicht in CI.**

---

## ⚠️ Vorwarnung
Ein Update führt ein **allowlisted Skript als root (Linux) bzw. Administrator (Windows)**
auf dem Ziel-Host aus (Remote-Code). Das ist ein privilegierter Schreibpfad. Alles ist
fail-closed gegated (Arm-Flag + Reauth + Host-Key-Pinning/kein-TOFU + Audit), aber die
Verantwortung für den Golden-Template-Zustand, den Host-Key-Abgleich und die Netz-Isolation
liegt beim Operator. **Erst im Lab, dann Prod.**

---

## Was der Pfad tut (Kurzüberblick)

```
vm-clone-Deploy (Windows-Server)                     bestehender Host (Linux-Agent)
        │  Auto-Register + Option-1 Host-Key-Auto-Capture     │  Enroll (Provisioning)
        ▼                                                      ▼
                 Provisioning-Registry (installed_nodes)
                        │  os = windows | linux | Linux
                        ▼
   Deploy-Keypair (ed25519, Private-Key AES-256-GCM at-rest, nie herausgegeben)
                        │  Public-Key in authorized_keys des Ziel-Hosts
                        ▼
   POST /deploy/nodes/:id/update  →  ssh (In-Memory-Key + gepinnter Host-Key)
                        │            →  update-wazuh-agent-windows.ps1 (Administrator)
                        │            →  update-wazuh-agent.sh          (root)
                        ▼
              Agent aktualisiert · Version-Report im nächsten Heartbeat
```

---

## Vorbedingungen

| Baustein | Anforderung | Prüfung |
|---|---|---|
| **Verwalteter Node in der Registry** | Windows-Server via Deployment Center ausgerollt (auto-registriert) **oder** Linux-Host enrollt. | `GET /api/v1/provisioning/nodes` bzw. Deployment Center → „Verwaltete Nodes". |
| **Deploy-Keypair** | Generiert (ed25519). Private-Key liegt AES-256-GCM verschlüsselt in `platform_settings`; nur der Public-Key/Fingerprint ist sichtbar. | Deployment Center → „Deploy-Keypair" = **aktiv**; `GET /deploy/keypair` → `isSet:true`. |
| **Public-Key im Ziel-Host** | Der Deploy-Public-Key steht in `authorized_keys` des SSH-Users (Windows: `Administrator`, Linux: `root`). Windows-Server aus vm-clone bekommt ihn automatisch (Renderer). **Brownfield-Linux: manuell setzen** (Copy-Button im Panel). | Test-SSH mit dem Deploy-Key gegen den Host (out-of-band). |
| **Gepinnter Host-Key** | SHA-256-Pin des Server-Host-Keys erfasst (Option 1 auto beim Deploy, oder Option 2 „Host-Key erfassen"). **Kein TOFU** — ohne Pin lehnt der Runner ab. | Panel-Badge „Host-Key gepinnt"; Node hat `hostKeyPin`. |
| **`SETTINGS_ENC_KEY`** | Dediziertes ≥32-Zeichen-Secret (verschlüsselt Deploy-Keypair + Connector-Secrets). | Boot-Fail ohne (`validateEnv`, bei scharfem Deploy). |

---

## Schritt 0 — ENV: Update scharfschalten (Prod-Fail-fast)
In `deploy/.env.production` (nie in Git):

```bash
NODE_UPDATE_ENABLED=true        # Arm-Flag fürs Node-Update (default AUS = inert)
# Für den vm-clone-Deploy zusätzlich (siehe deployment-center-runbook.md):
# DEPLOY_ENABLED=true
# DEPLOY_HYPERVISOR_ALLOWED_HOSTS=10.0.99.100
```

Danach API neu starten. Ohne `NODE_UPDATE_ENABLED=true` ist der Update-Endpoint erreichbar,
lehnt aber **fail-closed** mit `403 E_NOT_ARMED` ab (Host-Key-Erfassung + Keypair-Verwaltung
gehen auch ohne Arm-Flag — das ist Vorbereitung, keine Ausführung).

> **Hinweis:** `NODE_UPDATE_ENABLED` und `DEPLOY_ENABLED` sind getrennt. Man kann Nodes
> aktualisieren, ohne den vm-clone-Deploy-Kanal scharf zu haben (z. B. enrollte Linux-Hosts).

---

## Schritt 1 — Deploy-Keypair generieren
UI: `/deploy` (admin) → Karte „Deploy-Keypair" → Passwort (Reauth) → **Keypair generieren**.

API:
```bash
REAUTH=$(curl -s -X POST https://nexora.local/api/v1/auth/deploy-reauth \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORT>"}' | jq -r .data.reauthToken)

curl -s -X POST https://nexora.local/api/v1/deploy/keypair/generate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "X-Reauth-Token: $REAUTH" | jq .data.fingerprint
```
Die Antwort enthält **nie** den Private-Key — nur `publicKey` + `fingerprint`.

> **⚠️ Rotation:** Erneutes Generieren invalidiert bestehende `authorized_keys`-Provisionierungen.
> Bereits ausgerollte Hosts sind danach nicht mehr per SSH erreichbar → mit dem neuen Public-Key
> neu ausrollen (bzw. `authorized_keys` aktualisieren). Deshalb reauth-gated + auditiert.

---

## Schritt 2 — Node bereitstellen + Host-Key pinnen

**Windows-Server (vm-clone):** Deploy nach `deployment-center-runbook.md` durchführen. Bei
`deployed` wird der Node **auto-registriert**, der Deploy-Public-Key steckt via Renderer bereits
in `administrators_authorized_keys`, und der Host-Key wird **Option-1-best-effort auto-captured**.

**Falls Auto-Capture verschoben wurde / Brownfield-Host:** Host-Key manuell erfassen (Option 2).
```bash
curl -s -X POST https://nexora.local/api/v1/deploy/nodes/<NODE_ID>/hostkey/capture \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "X-Reauth-Token: $REAUTH" | jq .data.fingerprint
```
UI: Panel → Node-Zeile → **Host-Key erfassen**.

> **Out-of-band-Abgleich:** Den zurückgegebenen Fingerprint gegen den echten Host-Key des Servers
> prüfen (z. B. `ssh-keyscan` / Konsole am Host), **bevor** aktualisiert wird. Der Pin ist die
> einzige Absicherung gegen einen MITM auf dem SSH-Kanal.

**Brownfield-Linux — Public-Key setzen:** Panel → „Deploy-Keypair" → **Kopieren** → auf dem
Host in `~root/.ssh/authorized_keys` eintragen. Fehlt er, scheitert das Update fail-closed (`E_SSH`).

---

## Schritt 3 — Update auslösen (gated, reauth)
UI: Panel → Node-Zeile → Passwort (oben) → **Update**.

API:
```bash
# frische Reauth (one-shot)
REAUTH=$(curl -s -X POST https://nexora.local/api/v1/auth/deploy-reauth \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORT>"}' | jq -r .data.reauthToken)

curl -s -X POST https://nexora.local/api/v1/deploy/nodes/<NODE_ID>/update \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "X-Reauth-Token: $REAUTH" \
  -H "Content-Type: application/json" -d '{"agentVersion":"4.14.6"}'   # agentVersion optional
```

**Server-seitig (fail-closed, in dieser Reihenfolge):** Arm-Flag → Reauth → Version-Validierung
→ Node aus Registry (Host **nie** aus dem Request) → OS-Klassifikation (windows/linux, sonst
`E_UNSUPPORTED`) → Runner-Bau (Private-Key transient + gepinnter Host-Key + Host-Allowlist) →
allowlisted Update-Skript. Kein Vier-Augen (Update ist weniger destruktiv als vm-clone/destroy),
aber vollständig auditiert (`NODE_UPDATE`).

**Verifikation:** Der nächste Heartbeat meldet die neue Agent-Version → Panel-Zeile „Agent v…".

---

## Fehlerfälle
- **`403 E_NOT_ARMED`** — `NODE_UPDATE_ENABLED` nicht `true` (oder API nicht neu gestartet).
- **`401 E_REAUTH`** — kein/abgelaufener/fremder Reauth-Token (one-shot, an actor.id gebunden).
- **`409 E_NO_HOSTKEY`** — kein gepinnter Host-Key → erst erfassen (kein TOFU-Fallback).
- **`503 E_NO_CHANNEL`** — kein Deploy-Keypair → erst generieren.
- **`400 E_NO_HOST`** — Node hat keine IP in der Registry.
- **`400 E_UNSUPPORTED`** — OS ist weder Windows noch Linux.
- **`400 E_BAD_VERSION`** — `agentVersion` verletzt das Versionsformat.
- **`502 E_SSH`** — SSH-Auth/Transport gescheitert (häufig: Deploy-Pubkey nicht in `authorized_keys`,
  oder Host-Key-Mismatch → Pin passt nicht mehr → neu erfassen nach Verifikation).
- **`504 E_TIMEOUT`** — Update-Skript lief länger als das Timeout (msiexec/apt kann dauern).
- **`502 E_UPDATE_FAILED`** — Skript-Exit ≠ 0 (Details nur im Server-Log, nie in der Antwort).

---

## Deaktivieren
`NODE_UPDATE_ENABLED=false` (oder Zeile entfernen) + API neu starten → Update wieder inert
(`E_NOT_ARMED`). Keypair, gepinnte Host-Keys und Registry bleiben erhalten.

---

## Sicherheits-Checkliste vor dem ersten Prod-Update
- [ ] Deploy-Keypair generiert; Private-Key at-rest verschlüsselt (nie exportiert/geloggt).
- [ ] Host-Key-Fingerprint **out-of-band** gegen den echten Host verifiziert (kein blindes Pinnen).
- [ ] Deploy-Public-Key nur im `authorized_keys` der beabsichtigten Hosts (Windows-`Administrator` / Linux-`root`).
- [ ] Update-Skript auf einem echten Ziel-Host smoke-getestet (Windows-`.ps1` / Linux-`.sh`), bevor Prod.
- [ ] `NODE_UPDATE_ENABLED` nur so lange scharf wie nötig; danach wieder aus.
- [ ] Mgmt-/SSH-Pfad zum Ziel-Host isoliert; Audit-Log (`NODE_UPDATE`) reviewt.
- [ ] Rotation verstanden: Keypair-Neugenerierung = alle Hosts neu provisionieren.
