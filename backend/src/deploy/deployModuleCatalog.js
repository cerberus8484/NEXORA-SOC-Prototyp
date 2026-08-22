'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — System-Modul-Katalog (Code-Allowlist).
//
// KEIN dynamisches Laden/Ausführen von Modul-Code. Nur exakt die hier
// gelisteten, bekannten System-Module sind deploybar. Unbekannt = deny.
//
// Ein Modul beschreibt NUR Stammdaten (WAS deployt wird): Identität, Deploy-Art
// (`kind`), deklaratives paramSchema (die „Vorgaben") — und je nach Art die
// VM-Klon-Felder ODER den Control-Adapter. Keine Laufzeitlogik.
//
// Zwei Deploy-Arten (`kind`):
//   'vm-clone'      — klont ein Proxmox-Golden-Template + config-Applier (z. B. OPNsense).
//                     braucht templateRefField, resourceDefaults, configApplierId.
//   'agent-install' — installiert Software auf einem BESTEHENDEN Host (Brownfield) über
//                     einen Control-Adapter (z. B. Linux-Client = Wazuh-Agent via ssh-systemd).
//                     braucht controlAdapter (+ targetKind); kein Template/keine Ressourcen.
// ─────────────────────────────────────────────────────────────────────────

const { AppError } = require('../errors/AppError');

const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'DEPLOY_MODULE_ERROR');
  e.status = status; // zusätzlich für Domain-/Unit-Tests (toMatchObject({ status }))
  return e;
}

// Gemeinsamer Netzwerk-Block (für alle Systeme). Deklarativ — die Joi-Validierung
// selbst folgt in Phase 2 (deployParamValidation); hier nur die Vorgaben-Beschreibung.
const NETWORK_PARAM_SCHEMA = {
  hostname:  { type: 'hostname', required: true },
  ipMode:    { type: 'enum', values: ['static', 'dhcp'], required: true, default: 'static' },
  staticIp:  { type: 'ipv4', required: true, when: { ipMode: 'static' } },
  cidr:      { type: 'integer', min: 0, max: 32, required: true, when: { ipMode: 'static' } },
  gateway:   { type: 'ipv4', required: true, when: { ipMode: 'static' } },
  vlanTag:   { type: 'integer', min: 1, max: 4094, required: false },
  dns:       { type: 'ipv4[]', minItems: 1, maxItems: 3, required: true, when: { ipMode: 'static' } },
};

// ─── Die Modul-Allowlist ────────────────────────────────────────────────────
const CATALOG = [
  {
    id: 'opnsense',
    name: 'OPNsense Firewall',
    type: 'firewall',
    vendor: 'Deciso / OPNsense',
    version: '24.x',
    kind: 'vm-clone',
    // Wie die Golden-Template-Referenz im Deploy-Spec heißt (Proxmox: Template-VMID zum Klonen).
    templateRefField: 'templateVmid',
    resourceDefaults: { cpu: 2, ramMB: 2048, diskGB: 20 },
    configApplierId: 'opnsense-config-import',
    paramSchema: {
      ...NETWORK_PARAM_SCHEMA,
      // Der First-Boot-Renderer erzeugt eine statische OPNsense-LAN-Konfiguration.
      // DHCP ist erst zulässig, wenn der Renderer dafür vollständig implementiert ist.
      ipMode: { ...NETWORK_PARAM_SCHEMA.ipMode, values: ['static'], default: 'static' },
      // Golden-Template-Referenz (Proxmox-Template-VMID zum Klonen). Optional im
      // Schema, damit die reine Netzwerk-Validierung unabhängig bleibt; die Route
      // erzwingt sie für einen echten Deploy.
      templateVmid: { type: 'integer', min: 100, required: false },
      // vendor-spezifisch (OPNsense) — Defaults greifen, wenn nicht gesetzt.
      // Interface-Namen eng auf einen sicheren Zeichensatz begrenzt (Defense-in-Depth,
      // auch wenn der config.xml-Renderer ohnehin XML-escaped).
      wanInterface: { type: 'string', required: false, default: 'vtnet0', pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
      lanInterface: { type: 'string', required: false, default: 'vtnet1', pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
    },
  },
  {
    // Linux-Container direkt aus einem PVE-LXC-Template. Proxmox übernimmt
    // Template, Ressourcen und Netz in einem atomaren Create; kein Nexora-Image
    // und kein Download aus dem Internet nötig.
    id: 'rocky-linux-container',
    name: 'Rocky Linux Container',
    type: 'server',
    vendor: 'Rocky Linux',
    version: '9 / 10',
    kind: 'lxc-create',
    templateRefField: 'lxcTemplate',
    resourceDefaults: { cpu: 2, ramMB: 2048, diskGB: 20 },
    paramSchema: {
      ...NETWORK_PARAM_SCHEMA,
      lxcTemplate: { type: 'string', required: true, pattern: '^[A-Za-z0-9_.-]+:vztmpl/[A-Za-z0-9_.-]+\\.tar(\\.(xz|zst|gz))?$' },
    },
  },
  {
    // Windows Server als PERSISTENTE, updatebare VM (Greenfield, vm-clone wie OPNsense).
    // Slice 1: reines Katalog-/Schema-Gerüst (0 RCE-Fläche) — der Config-Applier
    // 'windows-server-config' (Cloudbase-Init) folgt in Slice 2, bis dahin ist ein
    // echter Apply fail-safe (kein registrierter Applier) und ohnehin DEPLOY_ENABLED-gated.
    // Erfolgspfad zerstört NIE (= „für immer da"); Node-Registrierung/Update folgen Slice 3/4.
    id: 'windows-server',
    name: 'Windows Server (VM)',
    type: 'server',
    vendor: 'Microsoft',
    version: '2022',
    kind: 'vm-clone',
    templateRefField: 'templateVmid',
    resourceDefaults: { cpu: 4, ramMB: 8192, diskGB: 60 },
    configApplierId: 'windows-server-config',
    paramSchema: {
      ...NETWORK_PARAM_SCHEMA,
      // Golden-Template-Referenz (Proxmox-Template-VMID des sysprep'ten Windows-Servers).
      templateVmid: { type: 'integer', min: 100, required: false },
      // Windows-Erstadmin-KONTO (nur der Name, injektionssicher). Das Passwort kommt NIE
      // in den Spec — Credential-/SSH-Key-Provisionierung folgt mit dem Update-Pfad (Slice 4).
      adminUser: { type: 'string', required: false, default: 'Administrator', pattern: '^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$' },
      // Optionaler Wazuh-Manager (IP/DNS) für das First-Boot-Enrollment (Slice 2). Ohne
      // Angabe rendert der Config-Applier keinen Wazuh-Block (reiner Netzwerk-Server).
      wazuhManager: { type: 'string', required: false, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      // Optionaler Agent-Name (Default = Hostname, im Renderer gesetzt).
      agentName: { type: 'string', required: false, pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
    },
  },
  {
    // Erstes agent-install-Modul: Wazuh-Agent auf einen bestehenden Linux-Host (Brownfield).
    // Ausführung über den ssh-systemd-Adapter (führt deploy/install-wazuh-agent.sh auf dem
    // Ziel aus). Kein VM-Klon, kein Golden-Template, keine Ressourcen-Defaults.
    id: 'linux-client',
    name: 'Linux-Client (Wazuh-Agent)',
    type: 'endpoint',
    vendor: 'Wazuh',
    version: '4.x',
    kind: 'agent-install',
    controlAdapter: 'ssh-systemd',
    targetKind: 'existing-host',
    paramSchema: {
      // Ziel-Host (IP/DNS) — enger, injektionssicherer Zeichensatz.
      targetHost:   { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      sshUser:      { type: 'string', required: false, default: 'root', pattern: '^[a-z_][a-z0-9_-]{0,31}$' },
      sshPort:      { type: 'integer', min: 1, max: 65535, required: false, default: 22 },
      // Wazuh-Manager (IP/DNS), an den sich der Agent enrollt.
      wazuhManager: { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      // Agent-Name (optional; Default = Ziel-Hostname, vom Adapter gesetzt).
      agentName:    { type: 'string', required: false, pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
      // Ziel-OS (Distro) — strikte Allowlist; der Installer wählt daraus die feste
      // Paketmanager-Familie (apt/dnf/zypper). Default debian ⇒ rückwärtskompatibel.
      os:           { type: 'enum', required: false, default: 'debian',
                      values: ['debian', 'ubuntu', 'rhel', 'centos', 'rocky', 'alma', 'fedora', 'amazon', 'sles', 'opensuse'] },
    },
  },
  {
    // Phase 3, Slice 1: der Nexora-Firewall-Collector auf einen bestehenden Linux-Host.
    // Der Collector liegt im privaten Data-Plane-Repo und wird als Release-Artefakt
    // verteilt: Version + SHA256 sind PFLICHT, der Installer prüft die Prüfsumme, bevor
    // das Binary läuft (gleicher Maßstab wie GPG-/Authenticode-Pinning bei Wazuh).
    // Kein Token im Spec — DeploySpec.assertNoSecrets verbietet Secrets in Params;
    // die Collector-Credentials kommen wie beim SSH-Key über einen eigenen Kanal.
    id: 'firewall-collector',
    name: 'Firewall-Collector (Nexora Data-Plane)',
    type: 'collector',
    vendor: 'Nexora',
    version: 'release',
    kind: 'agent-install',
    controlAdapter: 'ssh-firewall-collector',
    targetKind: 'existing-host',
    paramSchema: {
      targetHost:       { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      sshUser:          { type: 'string', required: false, default: 'root', pattern: '^[a-z_][a-z0-9_-]{0,31}$' },
      sshPort:          { type: 'integer', min: 1, max: 65535, required: false, default: 22 },
      // Release-Tag des Artefakts (GitHub-Release im selben Repo).
      collectorVersion: { type: 'string', required: true, pattern: '^v?[0-9]+(\\.[0-9]+){0,3}(-[a-zA-Z0-9.]{1,20})?$' },
      // SHA256 des Artefakts — Integritätsanker, ohne den nicht installiert wird.
      checksumSha256:   { type: 'string', required: true, pattern: '^[a-fA-F0-9]{64}$' },
      // Ziel, an das der Collector seine Events sendet (Nexora-Intake).
      intakeUrl:        { type: 'string', required: true, pattern: '^https?://[A-Za-z0-9._~:/?#\\[\\]@!$&\'()*+,;=%-]{1,500}$' },
      // Bezugsquelle des Artefakts — OPTIONAL. Leer = GitHub-Release im Control-Plane-Repo.
      // Ein Deploy darf nicht daran hängen, dass dort etwas liegt: interner Webserver,
      // Spiegel oder Air-Gap-Share sind gleichwertig. Die Integrität sichert die Prüfsumme.
      artifactBaseUrl:  { type: 'string', required: false, pattern: '^https?://[A-Za-z0-9._~:/?#\\[\\]@!$&\'()*+,;=%-]{1,500}$' },
    },
  },
  {
    // Zweiter Kollektor, gleiche Form wie der Firewall-Collector (Nexora-Binary per
    // Release-Artefakt, SHA256-Pflicht). Er holt Ereignisse von einem SIEM ab und
    // reicht sie an den Nexora-Intake weiter — nuetzlich, wo Nexora das SIEM nicht
    // direkt erreichen soll oder darf (Netzsegment, Firewall, Betreiberwechsel).
    id: 'siem-collector',
    name: 'SIEM-Collector (Nexora Data-Plane)',
    type: 'collector',
    vendor: 'Nexora',
    version: 'release',
    kind: 'agent-install',
    controlAdapter: 'ssh-siem-collector',
    targetKind: 'existing-host',
    paramSchema: {
      targetHost:       { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      sshUser:          { type: 'string', required: false, default: 'root', pattern: '^[a-z_][a-z0-9_-]{0,31}$' },
      sshPort:          { type: 'integer', min: 1, max: 65535, required: false, default: 22 },
      collectorVersion: { type: 'string', required: true, pattern: '^v?[0-9]+(\.[0-9]+){0,3}(-[a-zA-Z0-9.]{1,20})?$' },
      checksumSha256:   { type: 'string', required: true, pattern: '^[a-fA-F0-9]{64}$' },
      intakeUrl:        { type: 'string', required: true, pattern: '^https?://[A-Za-z0-9._~:/?#\\[\\]@!$&\'()*+,;=%-]{1,500}$' },
      artifactBaseUrl:  { type: 'string', required: false, pattern: '^https?://[A-Za-z0-9._~:/?#\\[\\]@!$&\'()*+,;=%-]{1,500}$' },
    },
  },
  {
    // IDS-Sensor: Suricata auf einem bestehenden Linux-Host. BEWUSST anders als die
    // Kollektoren — Suricata kommt aus den Paketquellen (kein Nexora-Binary, also
    // keine Version/SHA256/Artefakt) und PUSHT nicht (es schreibt EVE-JSON, das der
    // Collector-Hub per SSH-tail abholt — also keine intakeUrl). Er braucht nur das
    // zu ueberwachende Interface und die OS-Familie (Paketmanager).
    id: 'ids-sensor',
    name: 'IDS-Sensor (Suricata)',
    type: 'sensor',
    vendor: 'OISF / Suricata',
    version: 'distro',
    kind: 'agent-install',
    controlAdapter: 'ssh-ids-sensor',
    targetKind: 'existing-host',
    paramSchema: {
      targetHost:       { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      sshUser:          { type: 'string', required: false, default: 'root', pattern: '^[a-z_][a-z0-9_-]{0,31}$' },
      sshPort:          { type: 'integer', min: 1, max: 65535, required: false, default: 22 },
      monitorInterface: { type: 'string', required: true, pattern: '^[a-zA-Z0-9._-]{1,15}$' },
      os:               { type: 'enum', required: false, default: 'debian',
                          values: ['debian','ubuntu','rhel','centos','rocky','alma','fedora','amazon','sles','opensuse'] },
    },
  },
  {
    // Zweites agent-install-Modul: Wazuh-Agent auf einen bestehenden Windows-Host
    // (Brownfield). Ausführung über den ssh-powershell-Adapter (führt
    // deploy/install-wazuh-agent.ps1 per OpenSSH auf dem Ziel aus). Kein VM-Klon.
    id: 'windows-client',
    name: 'Windows-Client (Wazuh-Agent)',
    type: 'endpoint',
    vendor: 'Wazuh',
    version: '4.x',
    kind: 'agent-install',
    controlAdapter: 'ssh-powershell',
    targetKind: 'existing-host',
    paramSchema: {
      targetHost:   { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      // Windows-Konto (z. B. Administrator) — Groß-/Kleinschreibung, injektionssicher.
      sshUser:      { type: 'string', required: false, default: 'Administrator', pattern: '^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$' },
      sshPort:      { type: 'integer', min: 1, max: 65535, required: false, default: 22 },
      wazuhManager: { type: 'string', required: true, pattern: '^[a-zA-Z0-9.-]{1,253}$' },
      agentName:    { type: 'string', required: false, pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
    },
  },
];

// ─── ModuleDefinition — read-only Sicht (gibt Kopien heraus, kein Katalog-Leak) ──
class ModuleDefinition {
  constructor(def) { this._def = def; }
  get id() { return this._def.id; }
  get name() { return this._def.name; }
  get type() { return this._def.type; }
  get vendor() { return this._def.vendor; }
  get version() { return this._def.version; }
  get kind() { return this._def.kind; }
  // agent-install: Control-Adapter + Ziel-Art (sonst undefined).
  get controlAdapter() { return this._def.controlAdapter; }
  get targetKind() { return this._def.targetKind; }
  // vm-clone: Template-/Ressourcen-/Applier-Felder (bei agent-install undefined).
  get templateRefField() { return this._def.templateRefField; }
  get configApplierId() { return this._def.configApplierId; }
  get resourceDefaults() { return this._def.resourceDefaults ? { ...this._def.resourceDefaults } : undefined; }
  get paramSchema() { return JSON.parse(JSON.stringify(this._def.paramSchema)); }

  toJSON() {
    const base = {
      id: this.id, name: this.name, type: this.type, vendor: this.vendor, version: this.version,
      kind: this.kind, paramSchema: this.paramSchema,
    };
    if (this.kind === 'agent-install') {
      return { ...base, controlAdapter: this.controlAdapter, targetKind: this.targetKind };
    }
    return {
      ...base,
      templateRefField: this.templateRefField, configApplierId: this.configApplierId,
      resourceDefaults: this.resourceDefaults,
    };
  }
}

// Fail-fast beim Modul-Load: jede Definition muss (je nach kind) vollständig sein.
const COMMON_REQUIRED = ['id', 'name', 'type', 'vendor', 'kind', 'paramSchema'];
const VM_CLONE_REQUIRED = ['templateRefField', 'resourceDefaults', 'configApplierId'];
const LXC_CREATE_REQUIRED = ['templateRefField', 'resourceDefaults'];
const AGENT_INSTALL_REQUIRED = ['controlAdapter', 'targetKind'];
const VALID_KINDS = ['vm-clone', 'lxc-create', 'agent-install'];

for (const def of CATALOG) {
  const kindRequired = def.kind === 'agent-install' ? AGENT_INSTALL_REQUIRED : (def.kind === 'lxc-create' ? LXC_CREATE_REQUIRED : VM_CLONE_REQUIRED);
  const required = [...COMMON_REQUIRED, ...kindRequired];
  for (const f of required) {
    if (def[f] === undefined || def[f] === null || def[f] === '') {
      throw new Error(`deployModuleCatalog: Modul '${def.id || '?'}' fehlt Pflichtfeld '${f}'`);
    }
  }
  if (!VALID_KINDS.includes(def.kind)) {
    throw new Error(`deployModuleCatalog: Modul '${def.id}' hat unbekanntes kind '${def.kind}'`);
  }
  if (def.kind === 'vm-clone' || def.kind === 'lxc-create') {
    for (const r of ['cpu', 'ramMB', 'diskGB']) {
      if (!Number.isFinite(def.resourceDefaults[r])) {
        throw new Error(`deployModuleCatalog: Modul '${def.id}' resourceDefaults.${r} fehlt/ungültig`);
      }
    }
  }
}

const CATALOG_BY_ID = new Map(CATALOG.map((d) => [d.id, d]));

function listModules() { return CATALOG.map((def) => new ModuleDefinition(def)); }

function getModule(id) {
  const def = CATALOG_BY_ID.get(id);
  if (!def) throw err(`unbekanntes Deploy-Modul: '${id}' — nicht in der Allowlist`, 404);
  return new ModuleDefinition(def);
}

module.exports = { ModuleDefinition, listModules, getModule, err, NETWORK_PARAM_SCHEMA };
