// hostEnrollView — reine Logik für Host-Enrollment (kein React, kein API).
// Client-Validierung (spiegelt den Server) + Operator-Anleitung. Der Server bleibt
// die Wahrheit; die Validierung hier ist nur UX/Defense-in-Depth.

import type { EnrolledHost } from './hostsApi';
import i18n from '../../i18n';

const NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;

export interface AddHostForm {
  name: string;
  ip: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<'name' | 'ip', string>>;
}

function isIpv4(v: string): boolean {
  if (!IPV4_RE.test(v)) return false;
  return v.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
}

/** Validiert das Add-Host-Formular. IP ist optional (Wazuh vergibt sonst „any"). */
export function validateAddHost(form: AddHostForm): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const name = (form.name || '').trim();
  const ip = (form.ip || '').trim();
  if (!NAME_RE.test(name)) errors.name = i18n.t('app.name1128CharactersOnly');
  if (ip && !isIpv4(ip)) errors.ip = i18n.t('app.invalidIpv4Address');
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Operator-Anleitung, um den Agent mit dem Enrollment-Key auf dem Ziel-Host zu
 * verbinden. Der Key wird EINMALIG angezeigt (kein erneuter Abruf möglich).
 */
export function enrollmentSteps(host: EnrolledHost): string[] {
  return [
    i18n.t('hosts.agentRegistered', { id: host.id, name: host.name }),
    i18n.t('app.installWazuhAgentTargetHost'),
    i18n.t('hosts.importEnrollmentKey'),
    i18n.t('app.thenStartRestartWazuhAgent'),
    i18n.t('app.keyShownOnlyOnceTransfer'),
  ];
}
