# Runbook — Deployment Center scharfschalten (OPNsense → Proxmox)

> Ziel: Den infra-schreibenden Deploy-Kanal (ADR-041) kontrolliert aktivieren und einen
> ersten OPNsense-Deploy auf Proxmox durchführen (Plan → 4-Augen → Apply → Rollback).
> Der Kanal ist **fail-closed**: ohne `DEPLOY_ENABLED` ist Apply hart geblockt.
>
> Stand 2026-07-01. Bezug: `ADR-041`, `deployment-center-architecture.md`,
> `deployment-center-implementation-plan.md`. **Nur Operator — nicht in CI.**

---

## ⚠️ Vorwarnung
Apply **klont, startet und zerstört echte VMs** auf dem Hypervisor. Das ist der riskanteste
Schreibpfad der Plattform. Alles ist gegated (Kill-Switch + 4-Augen + Reauth + Rollback +
Audit), aber die Verantwortung fürs Golden-Template, den API-Token-Scope und die Netz-Isolation
liegt beim Operator. **Erst im Lab üben, dann Prod.**

---

## Vorbedingungen (ohne diese kein Live-Deploy)

| Baustein | Anforderung | Prüfung |
|---|---|---|
| **OPNsense-Golden-Template** | Ein gepflegtes, klonbares Proxmox-Template (eigene VMID, z.B. `9000`) mit installiertem OPNsense. | `qm list` auf dem Node zeigt das Template. |
| **Proxmox-API-Token** | Eigener Token (`user@realm!tokenid=secret`) mit **minimalen** Rechten: VM-Clone/Config/Start/Destroy auf dem Ziel-Node + Storage. Kein Cluster-Admin. | `curl` gegen `/api2/json/version` mit `PVEAPIToken=` klappt. |
| **VLAN-Bridge** | Die Ziel-Bridge (z.B. `vmbr1`) existiert auf dem Node und trägt das gewünschte VLAN. | `checkPreconditions` meldet sie im Plan. |
| **Mgmt-Netz-Isolation** | Nexora erreicht die Proxmox-API nur über ein abgeschottetes Mgmt-Netz. | Der Host steht in `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`. |
| **config-`deliver`-Kanal** | Implementiert (`DEPLOY_DELIVER_CHANNEL=first-boot-drive`). Default `none` = fail-safe (config-Schritt → Rollback). Golden-Template braucht First-Boot-Importer. Siehe Schritt 5. | `DEPLOY_DELIVER_CHANNEL` gesetzt + Live-Smoke. |

---

## Schritt 1 — ENV setzen (Prod-Fail-fast)
In `deploy/.env.production` (nie in Git):

```bash
DEPLOY_ENABLED=true
DEPLOY_HYPERVISOR_ALLOWED_HOSTS=10.0.99.100          # nur der/die echten Proxmox-Mgmt-Hosts
# optional:
DEPLOY_REAUTH_WINDOW_S=300                            # Frische-Fenster der Apply-Reauth
DEPLOY_STATUS_POLL_TIMEOUT_MS=120000                  # Wartezeit auf VM-Erreichbarkeit
```

`validateEnv` verweigert den Boot, wenn `DEPLOY_ENABLED=true` **ohne** eine nicht-leere
`DEPLOY_HYPERVISOR_ALLOWED_HOSTS` gesetzt ist (SSRF-Schutz). Der API-Token wird **nicht** hier
gesetzt — er kommt beim Connector-Anlegen über die UI/API und wird server-seitig AES-256-GCM
verschlüsselt (`secretsCrypto`).

Danach API neu starten. Ohne `DEPLOY_ENABLED=true` bleibt der Kanal inert (Read/Plan möglich,
Apply → `403 E_DEPLOY_DISABLED`).

---

## Schritt 2 — Connector anlegen (UI oder API)
UI: `/deploy` (admin) → „Connector anlegen": Name, Host (Mgmt-IP), Ziel-Node, API-Token.

API:
```bash
curl -s -X POST https://nexora.local/api/v1/deploy/connectors \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"type":"proxmox","name":"Lab-PVE","host":"10.0.99.100","apiToken":"root@pam!nexora=<SECRET>","targetNode":"pve1","storage":"local-lvm","bridge":"vmbr1","verifyTls":true}'
```
Die Antwort enthält **nie** den Token — nur einen `prefix` zur Identifikation.

---

## Schritt 3 — Spec anlegen + Plan (Dry-Run, kein Write)
```bash
# Spec (validiert gegen das OPNsense-paramSchema; templateVmid = Golden-Template)
curl -s -X POST https://nexora.local/api/v1/deploy/specs \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"moduleId":"opnsense","connectorId":"<CONNECTOR_ID>","targetNode":"pve1","storage":"local-lvm","bridge":"vmbr1","resources":{"cpu":2,"ramMB":2048,"diskGB":20},"params":{"hostname":"fw-lab","ipMode":"static","staticIp":"10.0.10.1","cidr":24,"gateway":"10.0.10.254","vlanTag":10,"dns":["10.0.10.10"],"templateVmid":9000}}'

# Plan → prüft Template/Bridge, legt einen 'planned' Run an (KEIN Infra-Write)
curl -s -X POST https://nexora.local/api/v1/deploy/specs/<SPEC_ID>/plan \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
`preconditions.ok` muss `true` sein. Bei `false` zeigt `issues[]` was fehlt (Template/Bridge/VMID).

---

## Schritt 4 — Genehmigen (Vier-Augen) + Apply
Der **Genehmiger muss ein anderer Admin** sein als der Ersteller des Runs (Vier-Augen).

```bash
# anderer Admin
curl -s -X POST https://nexora.local/api/v1/deploy/runs/<RUN_ID>/approve \
  -H "Authorization: Bearer <ADMIN2_TOKEN>" -H "Content-Type: application/json" -d '{"note":"lab test"}'

# frische Reauth (deploy_reauth-Token) — Passwort des anwendenden Admins
REAUTH=$(curl -s -X POST https://nexora.local/api/v1/auth/deploy-reauth \
  -H "Authorization: Bearer <ADMIN2_TOKEN>" -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN2_PASSWORT>"}' | jq -r .data.reauthToken)

# Apply — schreibt echte Infra (gegated)
curl -s -X POST https://nexora.local/api/v1/deploy/runs/<RUN_ID>/apply \
  -H "Authorization: Bearer <ADMIN2_TOKEN>" -H "X-Reauth-Token: $REAUTH"
```
In der UI genügt das Passwort-Feld im Apply-Block — Reauth + Apply laufen in einem Klick.

**Ablauf:** `applying → cloning → starting → configuring → verifying → deployed`. Jeder Schritt
ist auditiert (`GET /deploy/runs/<RUN_ID>` zeigt Status + Schritte).

---

## Schritt 5 — Der config-Schritt (deliver-Kanal)
Der OPNsense-config.xml-**Renderer** ist fertig (XML-escaped) und der **Zustellkanal**
(`deliver`) ist jetzt implementiert und über `DEPLOY_DELIVER_CHANNEL` wählbar. Default bleibt
**fail-safe**: ohne konfigurierten Kanal (`none`) wirft der config-Schritt → der Deploy rollt
**kontrolliert zurück** (`rolled_back`), statt eine unkonfigurierte VM als „deployed" zu melden.

**Kanal aktivieren:** `DEPLOY_DELIVER_CHANNEL=first-boot-drive`
- Die gerenderte `config.xml` wird verpackt (`opnsenseConfigMedia`), in den Proxmox-Storage
  geladen und als CD-ROM (`ide2=…,media=cdrom`) an die VM gehängt (`attachConfigMedia`).
- Der **First-Boot-Importer im OPNsense-Golden-Template** zieht `/conf/config.xml` beim (Re)Boot.
- Voraussetzung Golden-Template: ein Erst-Boot-Skript, das das angehängte Volume nach
  `/conf/config.xml` importiert. Die Proxmox-Storage-Materialisierung wird beim **Live-Smoke**
  gegen echtes Proxmox verifiziert (der REST-Pfad ist mock-getestet, aber nicht hardware-verifiziert).

> **Alternative (nicht implementiert):** OPNsense-config-import-API nach dem Boot. Kann später
> als zweiter Kanal-Wert additiv ergänzt werden (`deliverChannelFactory`).

Ohne aktivierten Kanal ist der Deploy für **Klon/Start/Rollback** nutzbar und beweist die Kette
end-to-end, konfiguriert die Appliance aber nicht automatisch.

---

## Fehlerfälle
- **`403 E_DEPLOY_DISABLED`** — `DEPLOY_ENABLED` nicht `true` (oder API nicht neu gestartet).
- **`403 E_FOUR_EYES`** — Ersteller = Genehmiger. Anderen Admin genehmigen lassen.
- **`403 E_REAUTH`** — kein/abgelaufener/fremder Reauth-Token. Neu holen (Fenster: `DEPLOY_REAUTH_WINDOW_S`).
- **`SSRF-Schutz …`** — Connector-Host nicht in `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`.
- **`failed_safe_stop`** — Rollback (destroy) ist gescheitert → **globale Deploy-Sperre**. Manueller
  Review nötig; die VM ggf. von Hand aufräumen, dann Sperre lösen (`deploy_safety_lock` global auf
  `locked=false`). Kein weiterer Apply, bis das passiert ist.

---

## Deaktivieren
`DEPLOY_ENABLED=false` (oder Zeile entfernen) + API neu starten → Kanal wieder inert. Angelegte
Connectoren/Specs/Runs bleiben als Historie erhalten; nichts wird geschrieben.

---

## Sicherheits-Checkliste vor dem ersten Prod-Apply
- [ ] Golden-Template geprüft (bootet, OPNsense-Version aktuell).
- [ ] API-Token mit minimalem Scope (kein Cluster-Admin), verschlüsselt gespeichert.
- [ ] `DEPLOY_HYPERVISOR_ALLOWED_HOSTS` enthält NUR die echten Mgmt-Hosts.
- [ ] Mgmt-Netz isoliert; `verifyTls=true` mit gültigem Zertifikat (sonst bewusste Ausnahme dokumentiert).
- [ ] Rollback im Lab getestet (Fehler-Injektion → destroy → `rolled_back`).
- [ ] Vier-Augen organisatorisch geklärt (zwei Admins).
