// Reine Anzeige-Logik fürs Deploy „Systemstatus"-Panel (kein React, testbar ohne DOM).
// Übersetzt den Zwei-Schlüssel-Zustand vom Backend in Ton/Label und den passenden
// Toggle-Button. Das Backend bleibt die Wahrheit — dies ist reine Darstellung.

import type { DeployPreflight } from './deployApi';

export interface PreflightStatusView {
  tone: 'success' | 'warning' | 'danger';
  label: string;
  description: string;
}

/** Zustand → Ton + Text fürs Status-Badge. */
export function preflightStatus(pf: DeployPreflight): PreflightStatusView {
  switch (pf.state) {
    case 'armed':
      return { tone: 'success', label: 'Scharf', description: 'Deploy ist effektiv freigegeben (beide Schlüssel an).' };
    case 'disarmed':
      return { tone: 'warning', label: 'Inert (betriebsbereit)', description: 'Kommissioniert, aber betrieblich entwaffnet — Armen möglich.' };
    default: // not_commissioned
      return { tone: 'danger', label: 'Nicht kommissioniert', description: 'Der env-Boden (DEPLOY_ENABLED) wird vom Operator out-of-band gesetzt.' };
  }
}

export interface PrimaryAction {
  kind: 'arm' | 'disarm' | 'none';
  disabledReason?: string;
}

/** Welcher Toggle-Button gehört an den aktuellen Zustand (oder keiner + Hinweis). */
export function primaryAction(pf: DeployPreflight): PrimaryAction {
  if (pf.state === 'armed') return { kind: 'disarm' };
  if (pf.state === 'not_commissioned') {
    return { kind: 'none', disabledReason: 'Kommissionierung fehlt: der Operator setzt DEPLOY_ENABLED am Server (out-of-band).' };
  }
  // disarmed
  if (pf.canArm) return { kind: 'arm' };
  const why = pf.blockers.length ? pf.blockers.join(' · ') : 'offene Voraussetzungen';
  return { kind: 'none', disabledReason: `Armen blockiert — ${why}.` };
}
