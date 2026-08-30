# Deployment Center — Implementierungsplan (Vertikaler Schnitt #1 „OPNsense → Proxmox")

> Stand: 2026-07-01. **Plan — noch kein Code.** Freigabe-Grundlage vor TDD-Start.
> Bezug: `deployment-center-architecture.md` (Architektur), `deployment-center-concept.md`
> (Kontext + Fundamente), ADR-041 (Entscheidung + Sicherheits-Naht).
> Erstellt vom `planner`-Agent, geerdet am echten Bestandscode (Migrationsnummer, Muster verifiziert).

---

## Überblick

Aus der UI eine OPNsense-VM deklarativ auf Proxmox deployen:
`Plan → 4-Augen-Approve → Apply → Status → Rollback`, strikt hinter `DEPLOY_ENABLED`-Gate
(default AUS), wiederverwendend das bestehende Apply-Kanal-Muster (`backend/src/applyChannel/`).
Kein neuer Exec/Shell-Pfad — der Orchestrator klont ein Golden-Template über die Proxmox-REST-API,
setzt Netz/VLAN/Ressourcen, importiert `config.xml`, auditiert jeden Schritt, rollt bei Fehler zurück.

**Nächste freie Migrationsnummer:** `051` (höchste vorhandene: `050_ticket_closed_at.sql`).

---

## Verankerung am Bestandscode (real gefunden)

| Muster | Referenz im Repo | Wiederverwendung |
|---|---|---|
| Immutabler gehashter Plan + State-Machine-Run | `applyChannel/applyDomain.js` (`ApplyPlan`, `ApplyRun`, `computePlanHash`, `canonical`) | `DeploySpec` (Spec-Hash), `DeployRun` |
| Fail-closed Gates (Kill-Switch→4-Augen→Reauth→Single-flight→Replay) | `applyChannel/applyGates.js` (`evaluateApplyGates`, `GATE_CODES`) | `evaluateDeployGates` mit `DEPLOY_ENABLED` |
| Orchestrator (injizierte Adapter, Rollback, Safe-Stop, redigiertes Audit) | `applyChannel/ApplyExecutor.js` | `DeployOrchestrator` |
| Code-Allowlist (`static create`/read-only View/fail-fast Load) | `configRegistry/configCapabilityCatalog.js`, `correlatorRegistry/correlatorRegistryCatalog.js` | `deployModuleCatalog` + `hypervisorConnectorCatalog` |
| Verschlüsselte Secrets at-rest (AES-256-GCM, `enc:v1:`) | `config/secretsCrypto.js` (`encryptSecret`/`decryptSecret`) | Proxmox-Token in `hypervisor_connectors` |
| SHA-256-Credential, `mint()`, `toJSON()` ohne Secret | `provisioning/provisioningDomain.js` (`NodeCredential`) | Connector-Domain |
| Reauth (zweckgebundener kurzlebiger Token) | `services/AuthService.js` (`issueApplyReauth`/`verifyApplyReauth`, purpose `apply_reauth`) | purpose `deploy_reauth` |
| Repo-Factory (Postgres bei `DB_ENABLED`, sonst InMemory) | `applyChannel/applyRepositoryFactory.js` | `deployRepositoryFactory.js` |
| Route (`requireAuth`+`requireRole('admin')`+`validate`+`X-Reauth-Token`) | `routes/correlators.js`, `routes/configRegistry.js` | `routes/deploy.js` |
| Joi-Body-Schemas (typisiert, `stripUnknown`) | `domain/validation/configSchema.js` | `deploySchema.js` |
| ENV-Gate-Block + Prod-Fail-fast | `config/index.js` (`apply: {...}`), `config/validateEnv.js` | `deploy: {...}` |
| Append-only Audit (DB-Trigger) | `db/migrations/033_provisioning.sql`, `044_apply_channel.sql` | `deploy_run_steps`/`deploy_audit` |
| Frontend (Feature-Modul + `*Api.ts` + reine `*View.ts` + `pages/*Page.tsx`) | `features/provisioning/*`, `pages/ProvisioningPage.tsx` | `features/deploy/*` + `DeployPage.tsx` |

---

## Sicherheits-Grundprinzipien (gelten in ALLEN Phasen)

- **Gating (fail-closed):** `DEPLOY_ENABLED` (default AUS, nicht UI-schaltbar) = Kill-Switch. Ohne Flag → Read/Plan ok, Apply hart geblockt.
- **Secrets:** Proxmox-Token nur via `encryptSecret`; `toJSON()`/Audit/Plan/Return zeigen NIE den Token (nur `prefix`/`ref`). OPNsense `adminPassword` write-only, nie im Spec-JSON persistiert, aus dem Spec-Hash ausgeschlossen.
- **Idempotenz:** kanonischer Spec-Hash → unique Index → Replay-Schutz.
- **Audit:** jeder Schritt append-only (DB-Trigger), redigiert.
- **Rollback:** jeder Fehlerschritt ab `clone` → `destroy`; Rollback-Fehler → `failed_safe_stop` + globale Deploy-Sperre.

---

## Phasen

### Phase 1 — Datenmodell + Code-Katalog *(Risiko: Low, keine Abhängigkeit)*

Domänenobjekte + Allowlist-Kataloge + Migration. Reine Domäne, kein I/O.

**Tests zuerst (`backend/tests/deploy/`):**
- `deployDomain.test.js` — `DeploySpec.create` validiert Pflichtfelder; `computeSpecHash` deterministisch + schließt `adminPassword` aus; `DeployRun`-State-Machine erlaubt nur legale Übergänge (`planned→approved→applying→cloning→configuring→starting→verifying→deployed` bzw. `→rolling_back→rolled_back→failed_safe_stop`); illegaler Übergang wirft; `toJSON` ohne `adminPassword`/Token.
- `deployModuleCatalog.test.js` — `getModule('opnsense')` liefert paramSchema+resourceDefaults+templateRef; unknown → 404; fail-fast wenn paramSchema fehlt; `listModules()`.
- `hypervisorConnectorCatalog.test.js` — `getConnectorType('proxmox')`; unknown → deny; kennt nur `proxmox`.
- `hypervisorConnectorDomain.test.js` — `create` verschlüsselt Token (nie Klartext in `toJSON`); `apiTokenRef`/`prefix` sichtbar; `assertNoSecrets`.

**Dateien (neu):**
```
backend/src/deploy/deployDomain.js
backend/src/deploy/deployModuleCatalog.js
backend/src/deploy/hypervisorConnectorCatalog.js
backend/src/deploy/hypervisorConnectorDomain.js
backend/src/db/migrations/051_deploy_center.sql
```

**Migration 051 (idempotent, `IF NOT EXISTS`):**
- `hypervisor_connectors` — `id, type('proxmox'), name, host, api_token_enc (enc:v1:…, NIE Klartext), api_token_prefix, target_node, storage, bridge, verify_tls, status, created_by, created_at, updated_at`
- `deploy_specs` — `id, module_id, connector_id FK, target_node, storage, bridge, resources JSONB, params JSONB (KEIN adminPassword), spec_hash TEXT UNIQUE, created_by, created_at`
- `deploy_runs` — `id, spec_id FK, status, vmid, started_by, started_at, finished_at, failure_reason` + Teil-Indizes (max. 1 aktiver Run; max. 1 deployed je Spec — analog `044`)
- `deploy_run_steps` — `id, run_id FK, step(clone|set_resources|attach_network|start|config_import|verify|rollback_destroy), status, detail JSONB (redigiert), at` (append-only Trigger)
- `deploy_safety_lock` — `id 'global', locked, reason, updated_at` (analog `apply_safety_lock`)
- `deploy_audit` — append-only, Trigger wie `provisioning_audit_events`

---

### Phase 2 — paramSchema-Validierung *(Risiko: Low; braucht P1)*

Fail-fast am System-Rand. Reine Domäne.

**Tests zuerst:**
- `deploy/deployParamValidation.test.js` — gültige OPNsense-Params passieren; ungültige `staticIp`/`cidr`(0–32)/`vlanTag`(1–4094) → Fehler; `dns[]` leer/>3/keine IPv4 → Fehler; Pflichtfelder; `resources`-Grenzen; `adminPassword` als Klartext im persistierten Spec → deny; unbekannte Keys gestrippt.
- `domain/validation/deploySchema.test.js` — Body-Schema akzeptiert typisierten Netzwerk-Block, lehnt freie Blobs ab.

**Dateien (neu):**
```
backend/src/deploy/deployParamValidation.js
backend/src/domain/validation/deploySchema.js
```
Netzwerk-Block (`hostname, ipMode, staticIp, cidr, gateway, vlanTag, dns[1..3], bridge`) als geteiltes Joi-Fragment (DRY), im OPNsense-paramSchema um `wanInterface, lanInterface, lan.*` ergänzt.

---

### Phase 3 — Proxmox-Connector *(Risiko: Medium; braucht P1)*

Hypervisor-Vertrag gegen Interface; testbar ohne echtes Proxmox.

**Vertrag:** `cloneFromTemplate(templateRef, spec)→{vmid}` · `setResources` · `attachNetwork(vmid,{bridge,vlanTag})` · `start` · `status→{running,agentReady}` · `destroy` · `snapshot` · `checkPreconditions(spec)→{bridgeExists,templateExists,vmidFree}`.

**Tests zuerst:**
- `deploy/InMemoryProxmoxConnector.test.js` — Fake: clone→VMID; State-Änderungen; start→running; destroy; `checkPreconditions` meldet fehlende Bridge/Template/belegte VMID; Fehler-Injektion je Schritt.
- `deploy/ProxmoxRestConnector.test.js` — gemockter HTTP-Client: korrekte Pfade (`/nodes/:node/qemu/:vmid/clone`, `/config`, `/status/start`); `Authorization: PVEAPIToken=…` (Token aus `decryptSecret`, nie geloggt); **SSRF-Guard** (host-Allowlist, Metadata-IP deny); 4xx/5xx → strukturierter Fehler ohne Token; `verifyTls=false` nur außerhalb Prod.

**Dateien (neu):**
```
backend/src/deploy/connectors/hypervisorConnector.js        # JSDoc-Interface + assertConnectorShape
backend/src/deploy/connectors/InMemoryProxmoxConnector.js   # Fake für CI, Fehler-Injektion
backend/src/deploy/connectors/ProxmoxRestConnector.js       # echter REST-Client, Token via decryptSecret, SSRF-Guard
backend/src/deploy/connectors/proxmoxConnectorFactory.js    # Fake bei !DEPLOY_ENABLED/Testflag, sonst REST
```

**OWASP:** SSRF (A10) — `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`-Allowlist, Metadata/öffentliche IPs deny. Secret nur transient. TLS erzwingbar, Prod-Warnung bei `false`.

---

### Phase 4 — Deploy-Orchestrator + Gates + Repository *(Risiko: High; braucht P1–P3)*

Kern des Schnitts. Lifecycle über das Apply-Kanal-Muster.

**Repository (InMemory + Postgres + Factory):** `createConnector/getConnector/listConnectors` · `createSpec/findSpecByHash/getSpec` · `createRun/updateRun/findActiveRun/findDeployedRunBySpec/getRun` · `appendRunStep/listRunSteps` · `getSafetyLock/setSafetyLock` · `appendDeployAudit/listDeployAudit`.

**Tests zuerst:**
- `deploy/deployGates.test.js` — Kill-Switch aus → `E_DEPLOY_DISABLED`; safetyLocked/nicht-approved/Ersteller==Approver(`E_FOUR_EYES`)/Reauth fehlt(`E_REAUTH`)/activeRun(`E_ACTIVE_RUN`)/deployedRun(`E_REPLAY`) → deny; alles ok → allow.
- `deploy/DeployOrchestrator.test.js` — Happy path → Run `deployed`, alle Steps auditiert, VMID gesetzt; clone-Fehler → `rolling_back→rolled_back` (destroy aufgerufen); config-Fehler → Rollback; Rollback-Fehler → `failed_safe_stop`+SafetyLock; kein Doppel-Deploy bei gleichem Spec-Hash; Token/Passwort nie im Audit.
- `deploy/InMemoryDeployRepository.test.js` — Single-flight; Replay-Constraint; append-only Steps.
- `deploy/DeployService.test.js` — `plan()`=Dry-Run (kein Write); `approve()` 4-Augen; `apply()` verdrahtet Gates+Orchestrator+Reauth; unknown module/connector → deny.

**Dateien (neu):**
```
backend/src/deploy/deployGates.js
backend/src/deploy/DeployOrchestrator.js
backend/src/deploy/DeployService.js
backend/src/deploy/InMemoryDeployRepository.js
backend/src/deploy/PostgresDeployRepository.js
backend/src/deploy/deployRepositoryFactory.js
backend/src/deploy/deployServiceFactory.js
```
**Ändern:** `services/AuthService.js` → `issueDeployReauth`/`verifyDeployReauth` (purpose `deploy_reauth`) + `tests/services/authService.deployReauth.test.js`.

**Ablauf (fail-closed):** `Gates → Run(applying) → checkPreconditions → clone → setResources → attachNetwork(vlan) → start → configApplier(params) → status-Poll(retry/backoff) → deployed`. Jeder Schritt `appendRunStep`+`appendDeployAudit`. Fehler ab `clone` → `_rollback(destroy)` → `rolled_back`; Rollback-Fehler → `_safeStop`+`setSafetyLock`.

---

### Phase 5 — config-import-Applier (OPNsense) *(Risiko: Medium; braucht P2,P3)*

`params → config.xml → OPNsense-API-Import`. Idempotent, fail-safe.

**Tests zuerst:**
- `deploy/opnsenseConfigRenderer.test.js` — rendert LAN-IP/CIDR/VLAN/DNS/Hostname korrekt; **XML-Escaping** aller dynamischen Werte (Injection-Test `<`/`&`/`"` → escaped); Snapshot; kein Klartext-`adminPassword` im Artefakt.
- `deploy/opnsenseConfigApplier.test.js` — `configApplier(connector, vmid, params)` ruft Renderer+Import; idempotent (2. Aufruf no-op); Import-Fehler → wirft → Orchestrator rollt zurück; Retry bei „VM-Agent noch nicht bereit".

**Dateien (neu):**
```
backend/src/deploy/appliers/opnsenseConfigRenderer.js
backend/src/deploy/appliers/opnsenseConfigApplier.js
```
**OWASP Injection (A03):** alle dynamischen Werte XML-escaped; `adminPassword` als OPNsense-Format-Hash, nie Klartext.

---

### Phase 6 — Routen *(Risiko: Medium; braucht P4–P5)*

**Tests zuerst:**
- `routes/deploy.test.js` — Nicht-admin → 403; ohne `X-Reauth-Token` bei apply → 403; ungültiger Body → 400; `DEPLOY_ENABLED=false` → apply 403 (`E_DEPLOY_DISABLED`), plan/read ok; Rate-Limit; happy path plan→approve→apply (InMemory+Fake); unknown module → 404.

**Dateien:**
```
backend/src/routes/deploy.js          # neu
backend/src/app.js                    # ändern: app.use('/api/v1/deploy', deployRouter)
backend/src/config/index.js           # ändern: deploy:{ enabled, reauthWindowSeconds, statusPollTimeoutMs, allowedHypervisorHosts }
backend/src/config/validateEnv.js     # ändern: DEPLOY_ENABLED=true in Prod → DEPLOY_HYPERVISOR_ALLOWED_HOSTS Pflicht (fail-fast)
```

**Endpunkte:**
| Methode | Pfad | Schutz |
|---|---|---|
| GET | `/deploy/modules` · `/deploy/connectors` | admin, read |
| POST | `/deploy/connectors` | admin, `validate`, Token → `encryptSecret` |
| POST | `/deploy/specs` | admin, `validate(createSpecSchema)`, Spec-Hash |
| POST | `/deploy/specs/:id/plan` | admin — Dry-Run (kein Write) |
| POST | `/deploy/specs/:id/approve` | admin, 4-Augen |
| POST | `/deploy/specs/:id/apply` | admin + `X-Reauth-Token` + `DEPLOY_ENABLED`-Gate + Rate-Limit |
| GET | `/deploy/runs/:id` · `/deploy/runs/:id/steps` · `/deploy/audit` | admin, read |

---

### Phase 7 — Frontend Plan/Approve/Status-UI *(Risiko: Low; braucht P6)*

**Tests zuerst (Vitest):**
- `features/deploy/deployApi.test.ts` — Request-Shapes plan/approve/apply; `X-Reauth-Token`-Header; Fehler-Envelope.
- `features/deploy/deployView.test.ts` — Status→Tone-Mapping (planned/applying/deployed/rolled_back/failed_safe_stop); Plan-Vorschau; `DEPLOY_ENABLED=false` → Apply-Button disabled + ehrlicher Hinweis; Params-Zusammenfassung ohne Secret.

**Dateien (neu/ändern):**
```
frontend/src/features/deploy/deployApi.ts     # Typen + api-Calls (Muster provisioningApi.ts)
frontend/src/features/deploy/deployView.ts    # reine Anzeige-Logik, Tone-Mapping, RBAC can()
frontend/src/pages/DeployPage.tsx             # Form → Plan → Approve → Status (Muster ProvisioningPage.tsx)
frontend/src/app/…                            # Route + Nav-Eintrag (admin-only)
```
UI: CSS-Variablen-Farben, `textContent` statt `innerHTML`, ehrliche Empty-/Disabled-Zustände.

---

## Testbarkeit ohne echtes Proxmox

- **CI:** `InMemoryProxmoxConnector` ist Default bei `DEPLOY_ENABLED!=true`/Testflag. Alle Tests deterministisch gegen Fake + InMemory-Repo, Jest `--runInBand`.
- **Fehler-Injektion** je Schritt → Rollback-/Safe-Stop-Pfade voll testbar ohne Hypervisor.
- **Operator-Smoke (einmalig, off-CI):** `DEPLOY_ENABLED=true` + `ProxmoxRestConnector` gegen Lab-Proxmox (Golden-Template, API-Token, VLAN-Bridge) → Test-OPNsense klonen, Plan/Approve/Apply, Erreichbarkeit, dann `destroy`. **Runbook: `deployment-center-runbook.md`.**

---

## Risiken & Vorbedingungen

| Risiko / Vorbedingung | Mitigation |
|---|---|
| **Golden-Template** (OPNsense-Template-VMID) muss existieren + gepflegt | `checkPreconditions` prüft im Plan; DoD-Vorbedingung + Operator-Runbook |
| **Proxmox-API-Token** minimale Rechte | verschlüsselt (`encryptSecret`); Token-Scope im Runbook; SSRF-Allowlist |
| **VLAN-Bridge** auf Node vorhanden | `checkPreconditions` meldet fehlende Bridge → Plan-Fehler |
| **Erst-Boot-Timing** (config-import erst bei VM-Agent-Bereitschaft) | `status`-Poll mit Retry/Backoff (bounded, ENV-Timeout); Timeout → Rollback |
| **VMID-/IP-Kollision** | Spec-Hash-Idempotenz + `checkPreconditions(vmidFree)` → Plan-Fehler |
| **SSRF** über frei wählbaren Connector-Host | `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`-Allowlist, Prod-fail-fast |
| **Rollback scheitert** (VM bleibt) | `failed_safe_stop` + globale Deploy-Sperre → manueller Review |

---

## Bewusst NICHT in Schnitt #1 (YAGNI)

ESXi/vSphere-Connector · weitere Module (Wazuh, Suricata-IDS, Honeypot) + generischer cloud-init-Applier ·
ISO-Erstinstallation · Snapshot-Nutzung im Lifecycle · Multi-Node-Scheduling/Kapazität · Live-Heartbeat
der deployten VM · Connector-Verwaltungs-UI (Schnitt #1 legt nur einen Proxmox-Connector an).

---

## TDD-Startpunkt (Phase 1, sofort umsetzbar)

1. `backend/tests/deploy/deployDomain.test.js` schreiben (RED): `DeploySpec.create`, `computeSpecHash` (schließt `adminPassword` aus), `DeployRun`-State-Machine.
2. `backend/src/deploy/deployDomain.js` (GREEN) — Struktur aus `applyDomain.js`.
3. `deployModuleCatalog.test.js` + `deployModuleCatalog.js` (OPNsense-Modul, fail-fast Load — Muster `correlatorRegistryCatalog.js`).
4. Migration `051_deploy_center.sql` (idempotent, append-only Trigger — Muster `044`/`033`).
5. `jest --runInBand` grün → Phase 1 fertig.
