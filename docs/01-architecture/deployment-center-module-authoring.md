# Deployment Center — Modul-Autoren-Leitfaden (Erweiterbarkeit)

> **Zweck:** Wie man das Deployment Center um ein **neues System-Modul** (z.B. pfSense, Fortinet,
> ein weiteres SIEM) oder einen **neuen Hypervisor-Connector** (z.B. ESXi) erweitert — nach Vertrag,
> ohne den Kern anzufassen. Umsetzung des in `deployment-center-architecture.md` §8 versprochenen
> Erweiterbarkeits-Vertrags („jede Firewall der Welt", dann selbst machbar).
>
> Stand 2026-06-30. **Leitfaden/Spec — der Deploy-Orchestrator-Code existiert noch nicht** (erster
> Schnitt OPNsense→Proxmox geplant). Dieses Dokument legt die Verträge fest, damit Modul/Connector
> und Kern unabhängig gebaut werden können. Architektur: `deployment-center-architecture.md`.

---

## 0. Grundsätze (gelten für jede Erweiterung)

- **Allowlist, kein User-Input:** Module und Connector-Typen sind **Code-Kataloge** (analog
  `backend/src/.../correlatorRegistryCatalog.js`) — nie aus der DB/aus Requests geladen. Ein neues
  Modul = ein neuer Katalog-Eintrag im Code, fail-fast bei Unbekanntem.
- **Vertrag vor Implementierung:** Modul und Connector erfüllen je ein festes Interface (§2/§3). Der
  Orchestrator kennt nur das Interface, nie das Vendor-Detail (DIP/OCP).
- **Validierung am Rand, fail-fast:** Jeder `params`-Block wird gegen `paramSchema` (Joi) validiert,
  bevor irgendetwas passiert. Ungültig → Plan-Fehler, kein Apply.
- **Secrets niemals** im Plan, Log, Return oder Audit. Secret-Felder sind `write-only` (§3.3).
- **Hinter dem Apply-Kanal + `DEPLOY_ENABLED`:** Jeder schreibende Schritt läuft über
  Draft→4-Augen-Approve→Plan→Apply (vorhandenes `applyChannel/`-Muster) und das eigene
  `DEPLOY_ENABLED`-ENV-Gate (default AUS). Kein direktes „Exec".
- **Test zuerst (TDD):** Kein Modul/Connector ohne Tests. Validierungs-, Plan- und Applier-Logik
  sind pure, testbare Module (keine echte Infra im Unit-Test — Connector injizierbar mocken).

---

## 1. Was du baust (Überblick)

| Erweiterung | Du lieferst | Aufwand |
|---|---|---|
| **Neues System-Modul** (eine weitere Appliance) | identity + source + resourceDefaults + `paramSchema` + `configApplier` + Katalog-Eintrag + Tests | gering–mittel (cloud-init-Module teilen den Applier) |
| **Neuer Hypervisor-Connector** (ein weiterer Virtualisierer) | Implementierung des Connector-Vertrags (§3) + Connector-Typ-Eintrag + Tests | mittel–hoch (API-spezifisch) |

Ein Modul ist **connector-agnostisch** (es weiß nichts von Proxmox/ESXi); ein Connector ist
**modul-agnostisch** (er weiß nichts von OPNsense/Wazuh). Die Klammer ist der Orchestrator.

---

## 2. Ein neues System-Modul bauen

### 2.1 Modul-Definition (Form)

```js
// deploy/modules/<id>.js  (Katalog-Eintrag, Allowlist)
module.exports = {
  identity: {
    id: 'pfsense',                 // eindeutig, stabil (Key)
    name: 'pfSense Firewall',
    type: 'firewall',              // firewall | siem | ids | honeypot
    vendor: 'Netgate',
    version: '2.7',
  },
  source: {
    kind: 'template',              // 'template' (VMID klonen, bevorzugt) | 'iso'
    templateRef: 'pfsense-2.7-golden',   // logischer Name; Connector löst ihn auf
  },
  resourceDefaults: { cpu: 2, ramMB: 2048, diskGB: 16 },  // vom User überschreibbar
  paramSchema: pfsenseParamSchema,      // §3 — Joi
  configApplier: pfsenseConfigApplier,  // §4 — (connector, vmid, params) => Promise<void>
};
```

### 2.2 Registrierung

Eintrag in den **Modul-Katalog** (Code-Allowlist, analog Correlator-Registry):

```js
// deploy/deployModuleCatalog.js
const MODULES = Object.freeze({
  opnsense: require('./modules/opnsense'),
  pfsense:  require('./modules/pfsense'),   // ← neu
});
function getModule(id) {
  const m = MODULES[id];
  if (!m) throw new Error(`deploy module unbekannt: ${id}`); // fail-fast, kein Fallback
  return m;
}
```

Damit ist das Modul in `plan`/`apply` wählbar — ohne Kern-Änderung.

---

## 3. paramSchema — die Vorgaben deklarieren

Jedes Modul deklariert seine Parameter als **Joi-Schema** (wie `backend/src/domain/validation/`).
Konvention: ein **gemeinsamer Netzwerk-Block** (für alle Systeme gleich) plus vendor-spezifische
Felder.

### 3.1 Gemeinsamer Netzwerk-Block (wiederverwenden, nicht neu erfinden)

```js
// deploy/schema/networkBlock.js  (geteilt, DRY)
const Joi = require('joi');
const networkBlock = {
  hostname: Joi.string().hostname().max(63).required(),
  ipMode:   Joi.string().valid('static', 'dhcp').default('static'),
  staticIp: Joi.string().ip({ version: ['ipv4'] }).when('ipMode', { is: 'static', then: Joi.required() }),
  cidr:     Joi.number().integer().min(1).max(32).when('ipMode', { is: 'static', then: Joi.required() }),
  gateway:  Joi.string().ip({ version: ['ipv4'] }).when('ipMode', { is: 'static', then: Joi.required() }),
  vlanTag:  Joi.number().integer().min(1).max(4094).optional(),
  dns:      Joi.array().items(Joi.string().ip()).min(1).max(3).required(),
  bridge:   Joi.string().max(32).required(),
};
module.exports = { networkBlock };
```

### 3.2 Vendor-spezifisch ergänzen

```js
// deploy/modules/pfsense.schema.js
const Joi = require('joi');
const { networkBlock } = require('../schema/networkBlock');
const pfsenseParamSchema = Joi.object({
  ...networkBlock,
  wanInterface: Joi.string().valid('vtnet0', 'vtnet1').default('vtnet0'),
  lanInterface: Joi.string().valid('vtnet0', 'vtnet1').default('vtnet1'),
  adminPassword: Joi.string().min(12).required(),   // secret — §3.3
}).required();
```

### 3.3 Secret-Felder (write-only)

- Mit `meta({ secret: true })` markieren (oder per Namens-Allowlist), damit der Orchestrator sie
  beim **Plan/Return/Audit redigiert** und nur an den `configApplier` durchreicht.
- Secrets werden vor Persistenz verschlüsselt (Connector-Token-Muster: SHA-256/verschlüsselt wie
  `NodeCredential`). **Nie** im Klartext zurückgeben.

### 3.4 Validierungsregeln (fail-fast, am Rand)

IP/CIDR-Format · VLAN 1–4094 · 1–3 DNS-IPs · Pflichtfelder · **Kollisionsprüfung** (IP/VMID schon
belegt → Plan-Fehler, nicht erst beim Apply). Diese Checks gehören in eine pure, getestete Funktion.

---

## 4. configApplier — wie die Vorgaben in die VM kommen

Vertrag: `configApplier(connector, vmid, params) => Promise<void>` — **idempotent**, **fail-safe**
(scheitert die Config, signalisiert der Applier es, der Orchestrator macht Rollback = `destroy`).

Zwei etablierte Muster:

### 4.1 OPNsense / pfSense (BSD, config.xml)

Golden-Template klonen → `config.xml` aus `params` rendern (LAN-IP, CIDR, VLAN, DNS, Hostname) →
per `config-import`/API einspielen → Reboot. Der Renderer ist eine **pure Funktion**
`renderConfigXml(params) => string` (gut testbar, kein Connector nötig).

### 4.2 Linux (Wazuh, Suricata-IDS, Honeypot) — geteilter cloud-init-Applier

```js
// deploy/appliers/cloudInitApplier.js  (von allen Linux-Modulen geteilt, DRY)
async function cloudInitApplier(connector, vmid, params) {
  const userData = renderNetplan(params) + renderHostname(params) + renderPackages(params);
  await connector.attachCloudInit(vmid, userData);  // NoCloud-Datastore
  // idempotent: gleiche params → gleicher userData → kein Drift
}
```

Ein Linux-Modul setzt dann einfach `configApplier: cloudInitApplier` und liefert nur seine
Paket-/Service-Liste. **Neue Linux-Appliance ≈ paramSchema + Paketliste**, kein neuer Applier.

---

## 5. Einen neuen Hypervisor-Connector bauen

Einheitlicher Vertrag (der Orchestrator ruft nur diese Methoden):

```js
// deploy/connectors/<name>.js
function createEsxiConnector({ host, tokenRef, node, storage }) {
  return {
    async cloneFromTemplate(templateRef, spec) { /* → vmid */ },
    async setResources(vmid, { cpu, ramMB, diskGB }) {},
    async attachNetwork(vmid, { bridge, vlanTag }) {},
    async attachCloudInit(vmid, userData) {},        // optional, wenn Linux-Module unterstützt
    async start(vmid) {},
    async status(vmid) { /* → 'creating'|'running'|'stopped'|'error' */ },
    async destroy(vmid) {},                          // Rollback
    async snapshot(vmid, name) {},                   // optional
  };
}
```

- **Referenz-Implementierung:** der **Proxmox-Connector** (erster Schnitt) gegen die Proxmox-REST-API
  (`/nodes/:node/qemu/:vmid/clone`, `config`, `status/start`). Neuer Connector = gleiche Methoden,
  andere API (ESXi: vSphere-API/govc).
- **Connector-Instanz** = Registry-Eintrag (`hypervisor_connectors`-Tabelle): Host, **verschlüsseltes
  API-Token**, Ziel-Node, Storage, Bridge. Token nie im Klartext/Return.
- **Plan-Pflicht:** `attachNetwork`/`cloneFromTemplate` müssen im **Plan** (Dry-Run) prüfen, dass
  Template, Bridge/VLAN und Ziel-Node existieren und IP/VMID frei sind — Fehler **vor** dem Apply.

---

## 6. Test-Checkliste (TDD, Pflicht)

- [ ] `paramSchema` — gültige + ungültige Beispiele (IP/CIDR/VLAN-Grenzen, Pflichtfelder, Secrets nicht im Output).
- [ ] Kollisions-/Plan-Validierung — belegte IP/VMID → Plan-Fehler.
- [ ] `configApplier`/Renderer — pure Funktion gegen erwarteten config.xml/netplan-Output; **idempotent** (zweimal = gleich).
- [ ] Connector — gegen **gemockte** Hypervisor-API (kein echtes Proxmox/ESXi im Unit-Test); Fehler-/Rollback-Pfad (`destroy` bei Apply-Fehler).
- [ ] Orchestrator-Integration — Plan→Approve→Apply-Kette mit injiziertem Mock-Connector; **kein** Schritt ohne Audit; `DEPLOY_ENABLED=false` ⇒ inert.
- [ ] Kein Secret in Plan/Return/Audit/Log (expliziter Test).

---

## 7. Security-Checkliste je Erweiterung

- [ ] Modul/Connector **nur** über Code-Katalog (Allowlist), kein dynamisches Laden.
- [ ] Schreibender Pfad **ausschließlich** über Apply-Kanal (Draft→4-Augen→Plan→Apply) + `DEPLOY_ENABLED`-Gate.
- [ ] **Reauth-Token** vor Apply, RBAC **admin**, Rate-Limit.
- [ ] Hypervisor-/Admin-Credentials verschlüsselt gespeichert, write-only, nie im Return.
- [ ] **Vollständiges Audit** jedes Schritts (clone/config/start/destroy), append-only.
- [ ] **Idempotenz** über Spec-Hash (gleicher Spec → kein Doppel-Deploy).
- [ ] **Rollback** (`destroy`) bei jedem Fehlerschritt.

---

## 8. Worked Example — pfSense (nah an OPNsense)

1. `deploy/modules/pfsense.schema.js` — `networkBlock` + `wanInterface/lanInterface/adminPassword(secret)`.
2. `deploy/modules/pfsense.js` — identity (`type:'firewall'`) + `source.templateRef:'pfsense-2.7-golden'` + `resourceDefaults` + `paramSchema` + `configApplier` (config.xml-Renderer, §4.1; weitgehend vom OPNsense-Modul ableitbar).
3. Eintrag in `deploy/deployModuleCatalog.js`.
4. Tests (§6): Schema, Renderer (idempotent), Plan-Kollision, gemockter Apply+Rollback.
5. Operator-Voraussetzung: gepflegtes **pfSense-Golden-Template** auf dem Hypervisor + freie VLAN-Bridge.

Ergebnis: pfSense ist im Deploy-Wizard wählbar — **ohne** Kern-/Orchestrator-Änderung. Genau die
modulare „eins nach dem anderen + selbst erweiterbar"-Eigenschaft aus der Vision.

---

## 9. Verweise
- `deployment-center-architecture.md` — Kern-Architektur (Modul × Connector × Orchestrator, Datenmodell, Sicherheit).
- `deployment-center-concept.md` — Gesamt-Konzept, Ausbaustufen A/B, Adapter-Abdeckung, Reihenfolge.
- `network-as-code.html` — aufbereitete Übersicht.
- Bestehende Muster zum Anlehnen: `correlatorRegistryCatalog` (Allowlist), `applyChannel/` (Draft→Approve→Apply), `domain/validation/` (Joi), Provisioning-Credential-Handling (SHA-256/verschlüsselt).
