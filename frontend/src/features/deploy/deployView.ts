// deployView — reine Anzeige-Logik für das Deployment Center (kein React, kein API).
// Gut testbar (Projekt-Konvention). Enthält NIE Secrets in Zusammenfassungen.

import type { Tone } from '../../components/ui';
import type { DeployRunStatus, Preconditions, CreateSpecBody } from './deployApi';
import { can } from '../../lib/rbac';

const RUN_STATUS_TONE: Record<DeployRunStatus, Tone> = {
  planned:          'muted',
  approved:         'accent',
  applying:         'warning',
  cloning:          'warning',
  starting:         'warning',
  configuring:      'warning',
  verifying:        'warning',
  deployed:         'success',
  rolling_back:     'warning',
  rolled_back:      'muted',
  failed_safe_stop: 'danger',
};

const RUN_STATUS_LABEL: Record<DeployRunStatus, string> = {
  planned:          'Geplant',
  approved:         'Genehmigt',
  applying:         'Wird angewendet',
  cloning:          'Klont Template',
  starting:         'Startet VM',
  configuring:      'Konfiguriert',
  verifying:        'Verifiziert',
  deployed:         'Deployt',
  rolling_back:     'Rollback läuft',
  rolled_back:      'Zurückgerollt',
  failed_safe_stop: 'Sicherheits-Stopp',
};

const IN_PROGRESS = new Set<DeployRunStatus>(['applying', 'cloning', 'starting', 'configuring', 'verifying', 'rolling_back']);
const TERMINAL = new Set<DeployRunStatus>(['deployed', 'rolled_back', 'failed_safe_stop']);

export function runStatusTone(status: DeployRunStatus): Tone {
  return RUN_STATUS_TONE[status] ?? 'muted';
}

export function runStatusLabel(status: DeployRunStatus): string {
  return RUN_STATUS_LABEL[status] ?? status;
}

export function isInProgress(status: DeployRunStatus): boolean {
  return IN_PROGRESS.has(status);
}

export function isTerminal(status: DeployRunStatus): boolean {
  return TERMINAL.has(status);
}

// ── Run-Schritte (Timeline) ──────────────────────────────────────────────────

const STEP_LABEL: Record<string, string> = {
  clone:            'VM klonen',
  set_resources:    'Ressourcen setzen',
  attach_network:   'Netzwerk anhängen',
  start:            'VM starten',
  config_import:    'Konfiguration importieren',
  verify:           'Verifizieren',
  agent_install:    'Agent installieren',
  rollback_destroy: 'Rollback (zerstören)',
};

const STEP_STATUS_TONE: Record<string, Tone> = {
  ok:      'success',
  failed:  'danger',
  started: 'warning',
};

/** Deutscher Label für einen Deploy-Run-Schritt (Fallback: der rohe Schlüssel). */
export function stepLabel(step: string): string {
  return STEP_LABEL[step] ?? step;
}

/** Ton für den Status eines Schritts (ok/failed/started → success/danger/warning). */
export function stepStatusTone(status: string): Tone {
  return STEP_STATUS_TONE[status] ?? 'muted';
}

// ── Apply-Gate-Spiegel (UX; der Server bleibt die Wahrheit) ──────────────────

export interface ApplyContext {
  role: string | undefined;
  runStatus: DeployRunStatus;
  deployEnabled: boolean;
}

/** Darf die aktuelle Rolle diesen Run jetzt anwenden? (admin + approved + Gate an) */
export function canApply(ctx: ApplyContext): boolean {
  return can.admin(ctx.role) && ctx.runStatus === 'approved' && ctx.deployEnabled === true;
}

/**
 * Ehrlicher Grund, warum Apply (noch) nicht möglich ist — oder null, wenn es geht.
 * Kein Fake-„läuft", wenn das Server-Gate aus ist.
 */
export function applyDisabledReason(ctx: ApplyContext): string | null {
  if (!can.admin(ctx.role)) return 'Nur Admins dürfen deployen.';
  if (ctx.runStatus !== 'approved') return 'Der Run muss zuerst genehmigt werden (Vier-Augen).';
  if (!ctx.deployEnabled) return 'Deploy ist serverseitig gesperrt (DEPLOY_ENABLED=false). Aktivierung durch den Operator.';
  return null;
}

// ── Zusammenfassungen (NIE Secrets) ──────────────────────────────────────────

const SECRET_KEY = /(password|secret|token|api[_-]?key|apikey|credential|passphrase)/i;

/** Kompakte, secret-freie Zusammenfassung der Deploy-Parameter. */
export function summarizeParams(params: Record<string, unknown>): string {
  const p = params || {};
  const parts: string[] = [];
  if (p.hostname) parts.push(`Host ${String(p.hostname)}`);
  if (p.ipMode === 'dhcp') parts.push('DHCP');
  else if (p.staticIp) parts.push(`${String(p.staticIp)}/${String(p.cidr ?? '')}`);
  if (p.vlanTag != null) parts.push(`VLAN ${String(p.vlanTag)}`);
  if (Array.isArray(p.dns) && p.dns.length) parts.push(`DNS ${(p.dns as unknown[]).map(String).join(', ')}`);
  // agent-install (Linux-Client / Wazuh-Agent)
  if (p.targetHost) parts.push(`Ziel ${String(p.targetHost)}`);
  if (p.wazuhManager) parts.push(`Manager ${String(p.wazuhManager)}`);
  if (p.agentName) parts.push(`Agent ${String(p.agentName)}`);
  return parts.join(' · ');
}

/** Defensive: Filtert Secret-Schlüssel aus einem Params-Objekt (für Anzeige-Tabellen). */
export function redactParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ── Spec-Builder für agent-install (Brownfield: kein Placement) ──────────────

export interface AgentInstallSpecInput {
  targetHost: string;
  sshUser?: string;
  sshPort?: number;
  // Modul-spezifische Felder kommen aus dem paramSchema (wazuhManager/agentName/os beim
  // Wazuh-Agent, collectorVersion/checksumSha256/… beim Collector). Der Builder kennt sie
  // NICHT namentlich — sonst braeuchte jedes neue Modul eine Typ-Aenderung hier.
  [param: string]: string | number | undefined;
}

/**
 * Baut den Spec-Body für ein agent-install-Modul (Linux-/Windows-Client). Kein
 * Proxmox-Placement; optionale Felder (sshUser/sshPort/agentName) nur wenn gesetzt,
 * damit die Modul-Defaults greifen. Secrets kommen hier NIE vor (Key liegt am Connector).
 */
export function buildAgentInstallSpecBody(
  moduleId: string,
  connectorId: string,
  input: AgentInstallSpecInput,
): CreateSpecBody {
  const params: Record<string, unknown> = { targetHost: input.targetHost };
  if (input.sshUser) params.sshUser = input.sshUser;
  if (typeof input.sshPort === 'number') params.sshPort = input.sshPort;
  // Alle uebrigen Felder unveraendert uebernehmen — leere/undefinierte weglassen,
  // damit die Modul-Defaults des Backends greifen.
  for (const [k, v] of Object.entries(input)) {
    if (k === 'targetHost' || k === 'sshUser' || k === 'sshPort') continue;
    if (v === undefined || v === null || v === '') continue;
    params[k] = v;
  }
  return { moduleId, connectorId, params };
}

// ── Spec-Builder für windows-server (vm-clone, Greenfield) ───────────────────

export interface WindowsServerSpecInput {
  hostname: string;
  ipMode: 'static' | 'dhcp';
  staticIp?: string;
  cidr?: number;
  gateway?: string;
  dns?: string[];
  vlanTag?: number;
  templateVmid?: number;
  wazuhManager?: string; // optional: First-Boot-Enroll
}

/**
 * Baut den Spec-Body für das windows-server-Modul (vm-clone). Placement (targetNode/
 * storage/bridge) kommt aus dem Proxmox-Connector; die Netzwerk-Statik-Felder nur bei
 * ipMode='static'. Optionale Felder (vlanTag/templateVmid/wazuhManager) nur wenn gesetzt,
 * damit die Modul-Defaults greifen. Secrets kommen hier NIE vor (Passwort/Key erst
 * server-seitig via Config-Media/Keypair).
 */
export function buildWindowsServerSpecBody(
  moduleId: string,
  connector: { id: string; targetNode?: string | null; storage?: string | null; bridge?: string | null },
  resources: { cpu: number; ramMB: number; diskGB: number } | undefined,
  input: WindowsServerSpecInput,
): CreateSpecBody {
  const params: Record<string, unknown> = { hostname: input.hostname, ipMode: input.ipMode };
  if (input.ipMode === 'static') {
    params.staticIp = input.staticIp;
    params.cidr = input.cidr;
    params.gateway = input.gateway;
    params.dns = input.dns;
  }
  if (input.vlanTag != null) params.vlanTag = input.vlanTag;
  if (input.templateVmid != null) params.templateVmid = input.templateVmid;
  if (input.wazuhManager) params.wazuhManager = input.wazuhManager;
  return {
    moduleId,
    connectorId: connector.id,
    targetNode: connector.targetNode ?? undefined,
    storage: connector.storage || 'local-lvm',
    bridge: connector.bridge || 'vmbr1',
    resources,
    params,
  };
}

/** Baut den secret-freien Spec für einen Proxmox-LXC aus einem vorhandenen Template. */
export function buildLxcSpecBody(
  moduleId: string,
  connector: { id: string; targetNode?: string | null; storage?: string | null; bridge?: string | null },
  resources: { cpu: number; ramMB: number; diskGB: number } | undefined,
  input: WindowsServerSpecInput & { lxcTemplate: string },
): CreateSpecBody {
  const base = buildWindowsServerSpecBody(moduleId, connector, resources, input);
  return { ...base, params: { ...base.params, lxcTemplate: input.lxcTemplate } };
}

/** Menschlicher Vorbedingungs-Text für die Plan-Vorschau. */
export function preconditionsSummary(pre: Preconditions | null | undefined): string {
  if (!pre) return 'Keine Vorbedingungen geprüft.';
  // agent-install: reiner Dry-Run ohne Ziel-Kontakt — zeigt die geplante Aktion.
  if (pre.kind === 'agent-install') {
    return `Würde den Wazuh-Agent auf ${pre.targetHost ?? '?'} installieren (Manager ${pre.wazuhManager ?? '?'}).`;
  }
  if (pre.ok) return 'Alle Vorbedingungen erfüllt (Template, Bridge, VMID).';
  return `Nicht erfüllt: ${(pre.issues || []).join('; ') || 'unbekannt'}`;
}
