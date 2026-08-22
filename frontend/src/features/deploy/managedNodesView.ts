// Reine View-Logik für „verwaltete Nodes" (Deployment Center, Slice 7). Entscheidet
// aus OS / IP / gepinntem Host-Key / Deploy-Keypair-Status, welche Aktionen ein Node
// erlaubt — ohne React/API. Die UI liest nur das Ergebnis; die echte Durchsetzung
// (Reauth, NODE_UPDATE_ENABLED, fail-closed) macht ausschließlich das Backend.

import type { InstalledNode } from '../provisioning/provisioningApi';
import type { DeployKeypairInfo } from './deployApi';

// Updatebar sind Windows- (update-wazuh-agent-windows) UND Linux-Nodes
// (update-wazuh-agent). Klassifikation case-insensitiv per Substring — spiegelt die
// Backend-Logik (nodeUpdateService.updateTargetForOs): deployte Nodes tragen os
// 'windows'/'linux', enrollte os aus `uname -s` = 'Linux'.
function isUpdatableOs(node: InstalledNode): boolean {
  const o = (node.os ?? '').toLowerCase();
  return o.includes('windows') || o.includes('linux');
}

/** Verwaltbare (updatebare) Nodes aus einer Registry-Liste — Windows + Linux. */
export function managedNodes(nodes: InstalledNode[]): InstalledNode[] {
  return nodes.filter(isUpdatableOs);
}

export interface NodeActionState {
  /** Host-Key ist gepinnt (Update-Voraussetzung). */
  hostKeyPinned: boolean;
  /** Host-Key erfassen/pinnen ist möglich (Windows + IP in der Registry). */
  canCaptureHostKey: boolean;
  /** Update ist auslösbar: Windows + IP + gepinnter Host-Key + vorhandenes Deploy-Keypair. */
  canUpdate: boolean;
  /** Warum Update nicht möglich ist (für Tooltip/Hinweis); null wenn möglich. */
  updateBlockedReason: string | null;
}

/**
 * Verfügbare Aktionen für einen Node abhängig vom Deploy-Keypair-Status.
 * Reihenfolge der Blockgründe = fail-closed-Reihenfolge im Backend
 * (Keypair → IP → Host-Key), damit UI-Hinweis und Server-Ablehnung übereinstimmen.
 */
export function nodeActionState(node: InstalledNode, keypair: DeployKeypairInfo): NodeActionState {
  const updatable = isUpdatableOs(node);
  const hasIp = Boolean(node.ip);
  const hostKeyPinned = Boolean(node.hostKeyPin);
  const canCaptureHostKey = updatable && hasIp;

  let updateBlockedReason: string | null = null;
  if (!updatable) updateBlockedReason = 'Update nur für Windows-/Linux-Nodes verfügbar.';
  else if (!keypair.isSet) updateBlockedReason = 'Kein Deploy-Keypair — zuerst generieren.';
  else if (!hasIp) updateBlockedReason = 'Node hat keine IP in der Registry.';
  else if (!hostKeyPinned) updateBlockedReason = 'Host-Key nicht erfasst — zuerst erfassen.';

  return {
    hostKeyPinned,
    canCaptureHostKey,
    canUpdate: updateBlockedReason === null,
    updateBlockedReason,
  };
}

const FP_HEAD = 20;
const FP_TAIL = 8;

/** Kürzt einen langen OpenSSH-Fingerprint (SHA256:…) für die kompakte Anzeige. */
export function shortFingerprint(fp: string | null | undefined): string {
  if (!fp) return '—';
  if (fp.length <= FP_HEAD + FP_TAIL + 1) return fp;
  return `${fp.slice(0, FP_HEAD)}…${fp.slice(-FP_TAIL)}`;
}
