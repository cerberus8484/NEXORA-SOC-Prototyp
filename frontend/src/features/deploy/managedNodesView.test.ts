// Reine View-Logik für „verwaltete Nodes" (Slice 7b): welche Update-/Host-Key-Aktionen
// ein Node erlaubt, abhängig von OS, IP, gepinntem Host-Key und Deploy-Keypair-Status.
// Keine React-/API-Abhängigkeit → als reines Modul testbar.

import { describe, test, expect } from 'vitest';
import { managedNodes, nodeActionState, shortFingerprint } from './managedNodesView';
import type { InstalledNode } from '../provisioning/provisioningApi';
import type { DeployKeypairInfo } from './deployApi';

const node = (o: Partial<InstalledNode> = {}): InstalledNode => ({
  id: 'n1', name: 'win01', role: 'normal_agent', profileId: null, fqdn: null,
  ip: '10.0.10.50', os: 'windows', version: null, status: 'active',
  lastSeenAt: null, createdAt: '', updatedAt: '', hostKeyPin: null, ...o,
});

const keypairSet: DeployKeypairInfo = { isSet: true, publicKey: 'ssh-ed25519 AAA nexora', fingerprint: 'SHA256:abc' };
const keypairUnset: DeployKeypairInfo = { isSet: false };

describe('managedNodes', () => {
  test('behält Windows + Linux (auch enrolltes „Linux"), filtert Unbekanntes/leer raus', () => {
    const nodes = [
      node({ id: 'a', os: 'windows' }), node({ id: 'b', os: 'linux' }),
      node({ id: 'c', os: 'Linux' }), node({ id: 'd', os: 'darwin' }), node({ id: 'e', os: null }),
    ];
    expect(managedNodes(nodes).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
  test('leere Liste → leer', () => {
    expect(managedNodes([])).toEqual([]);
  });
});

describe('nodeActionState', () => {
  test('Windows + IP + Pin + Keypair → Update erlaubt, kein Blockgrund', () => {
    const st = nodeActionState(node({ hostKeyPin: 'a'.repeat(64) }), keypairSet);
    expect(st).toMatchObject({ hostKeyPinned: true, canUpdate: true, canCaptureHostKey: true, updateBlockedReason: null });
  });

  test('kein Keypair → Update gesperrt (Blockgrund nennt Keypair)', () => {
    const st = nodeActionState(node({ hostKeyPin: 'a'.repeat(64) }), keypairUnset);
    expect(st.canUpdate).toBe(false);
    expect(st.updateBlockedReason).toMatch(/Keypair/i);
  });

  test('kein gepinnter Host-Key → Update gesperrt, aber Erfassen möglich', () => {
    const st = nodeActionState(node({ hostKeyPin: null }), keypairSet);
    expect(st.hostKeyPinned).toBe(false);
    expect(st.canUpdate).toBe(false);
    expect(st.canCaptureHostKey).toBe(true);
    expect(st.updateBlockedReason).toMatch(/Host-Key/i);
  });

  test('keine IP → weder Update noch Erfassen (Host aus Registry fehlt)', () => {
    const st = nodeActionState(node({ ip: null, hostKeyPin: 'a'.repeat(64) }), keypairSet);
    expect(st.canUpdate).toBe(false);
    expect(st.canCaptureHostKey).toBe(false);
    expect(st.updateBlockedReason).toMatch(/IP/i);
  });

  test('Linux + IP + Pin + Keypair → Update erlaubt (symmetrisch zu Windows)', () => {
    const st = nodeActionState(node({ os: 'linux', hostKeyPin: 'a'.repeat(64) }), keypairSet);
    expect(st).toMatchObject({ canUpdate: true, canCaptureHostKey: true, updateBlockedReason: null });
  });

  test('Unbekanntes OS (weder Windows noch Linux) → keine Aktionen', () => {
    const st = nodeActionState(node({ os: 'darwin', hostKeyPin: 'a'.repeat(64) }), keypairSet);
    expect(st.canUpdate).toBe(false);
    expect(st.canCaptureHostKey).toBe(false);
    expect(st.updateBlockedReason).toMatch(/Windows|Linux/i);
  });
});

describe('shortFingerprint', () => {
  test('kürzt lange SHA256:-Fingerprints auf Anfang…Ende', () => {
    const fp = 'SHA256:' + 'x'.repeat(40) + 'END';
    const short = shortFingerprint(fp);
    expect(short.startsWith('SHA256:')).toBe(true);
    expect(short).toContain('…');
    expect(short.length).toBeLessThan(fp.length);
  });
  test('kurze/leere Werte unverändert', () => {
    expect(shortFingerprint('SHA256:abc')).toBe('SHA256:abc');
    expect(shortFingerprint(null)).toBe('—');
    expect(shortFingerprint(undefined)).toBe('—');
  });
});
