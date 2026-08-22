// provisioningView — reine Anzeige-Logik für die Registry-Sicht (kein React, kein API).
// Gut testbar, deshalb als eigenes Modul (Projekt-Konvention).

import type { Tone } from '../../components/ui';
import type { NodeStatus, HeartbeatStatus, EnrollmentStatus, InstalledNode, NodeCredentialStatus } from './provisioningApi';
import { can } from '../../lib/rbac';

const NODE_STATUS_TONE: Record<NodeStatus, Tone> = {
  pending:  'warning',
  enrolled: 'accent',
  active:   'success',
  stale:    'warning',
  retired:  'muted',
};

const HEARTBEAT_TONE: Record<HeartbeatStatus, Tone> = {
  healthy:  'success',
  degraded: 'warning',
  offline:  'danger',
};

const ENROLLMENT_TONE: Record<EnrollmentStatus, Tone> = {
  active:  'success',
  expired: 'muted',
  revoked: 'danger',
};

const CREDENTIAL_STATUS_TONE: Record<NodeCredentialStatus, Tone> = {
  active:  'success',
  revoked: 'danger',
};

export function nodeStatusTone(status: NodeStatus): Tone {
  return NODE_STATUS_TONE[status] ?? 'muted';
}

export function heartbeatTone(status: HeartbeatStatus): Tone {
  return HEARTBEAT_TONE[status] ?? 'muted';
}

export function enrollmentTone(status: EnrollmentStatus): Tone {
  return ENROLLMENT_TONE[status] ?? 'muted';
}

/** Tone für den Status einer Node-Credential (active → success, revoked → danger). */
export function credentialStatusTone(status: NodeCredentialStatus): Tone {
  return CREDENTIAL_STATUS_TONE[status] ?? 'muted';
}

// Heartbeat gilt als „stale", wenn der letzte Kontakt älter als die Schwelle ist.
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

export function isHeartbeatStale(lastSeenAt: string | null, now: number = Date.now()): boolean {
  if (!lastSeenAt) return true;
  const t = new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > STALE_THRESHOLD_MS;
}

// Kompakte Relativzeit für „zuletzt gesehen" (de). Leerer Wert → „nie".
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'nie';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'nie';
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'gerade eben';
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `vor ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `vor ${days} d`;
}

// Zählt Nodes je Status für die Kopfzeile (z. B. „3 aktiv, 1 stale").
export function countByStatus(nodes: InstalledNode[]): Record<NodeStatus, number> {
  const acc: Record<NodeStatus, number> = { pending: 0, enrolled: 0, active: 0, stale: 0, retired: 0 };
  for (const n of nodes) acc[n.status] = (acc[n.status] ?? 0) + 1;
  return acc;
}

// ── P_PROVISION_SECURITY_1: Aktions-Guards ────────────────────────────────────

/**
 * Darf die aktuelle Rolle eine Credential widerrufen?
 * Nur Admin, und nur wenn die Credential noch aktiv ist.
 */
export function canRevokeCredential(role: string | undefined, credentialStatus: NodeCredentialStatus): boolean {
  return can.admin(role) && credentialStatus === 'active';
}

/**
 * Darf die aktuelle Rolle einen Node in den Retired-Status versetzen?
 * Nur Admin, und nur wenn der Node noch nicht retired ist.
 */
export function canRetireNode(role: string | undefined, nodeStatus: NodeStatus): boolean {
  return can.admin(role) && nodeStatus !== 'retired';
}

// ── Bestätigungs-Texte (keine Credentials/Token-Werte) ───────────────────────

/**
 * Warntext für den Widerruf einer einzelnen Credential.
 * Enthält KEINE Token-Werte oder Hashes.
 */
export function revokeConfirmText(node: InstalledNode): string {
  return `Credential für Node „${node.name}" widerrufen? Der Node kann danach keine Heartbeats mehr senden.`;
}

/**
 * Warntext für das Retire eines Nodes.
 * Enthält KEINE Token-Werte oder Hashes.
 */
export function retireConfirmText(node: InstalledNode): string {
  return `Node „${node.name}" dauerhaft deaktivieren? Widerruft aktive Credentials und beendet weitere Heartbeats.`;
}
