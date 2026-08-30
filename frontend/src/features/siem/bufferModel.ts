import type { Tone } from '../../components/ui';
import type { SiemTelemetry } from './siemApi';
import i18n from '../../i18n';

export interface BufferKpi {
  value: number | string;
  tone: Tone;
  hint: string;
  dot: boolean;
}

/**
 * Verdichtet die Agent-Buffer-Warnungen (Wazuh-Regel 202/203) zu einer KPI:
 *   - keine betroffenen Agents → grün, "Alle Agents OK"
 *   - ≥1 Agent mit 90%-Warnung (202) → orange
 *   - mindestens ein Agent geflutet (203, Events verworfen) → rot
 * Null-Telemetrie (SIEM nicht erreichbar) bleibt ehrlich "—" statt falsch "OK".
 */
export function deriveBuffer(list: SiemTelemetry['bufferAgents'] | null): BufferKpi {
  if (!list) return { value: '—', tone: 'muted', hint: i18n.t('label.siemUnreachable'), dot: false };

  const affected = list.filter((b) => b.warn > 0 || b.full > 0);
  if (affected.length === 0) return { value: 0, tone: 'success', hint: i18n.t('app.allAgentsOk'), dot: true };

  // Schlimmster zuerst: erst nach „geflutet", dann nach Warn-Treffern.
  const worst = [...affected].sort((a, b) => (b.full - a.full) || (b.warn - a.warn))[0];
  return worst.full > 0
    ? { value: affected.length, tone: 'danger',  hint: `${worst.name} · Events verworfen`, dot: true }
    : { value: affected.length, tone: 'warning', hint: `${worst.name} · Queue ~90% voll`,  dot: true };
}

/**
 * Ergebnis des Buffer-Telemetrie-Abrufs für die Dashboard-Kachel — drei ehrlich
 * getrennte Fälle (Hardrule: „leer" ≠ „Fehler"):
 *   - 'disabled' → Wazuh-Telemetrie ist bewusst nicht aktiviert (enabled:false).
 *   - 'error'    → der Abruf ist fehlgeschlagen (Netz/Server) — NICHT „alles OK".
 *   - 'ok'       → echte bufferAgents-Liste vorhanden.
 */
export type BufferFetchOutcome =
  | { kind: 'disabled' }
  | { kind: 'error' }
  | { kind: 'ok'; bufferAgents: SiemTelemetry['bufferAgents'] };

/**
 * Bildet das Abruf-Ergebnis auf die anzuzeigende KPI ab. Eine fehlgeschlagene
 * Teilquelle wird als degraded markiert (orange „nicht ladbar"), statt still 0 /
 * „alles OK" anzuzeigen. „Deaktiviert" bleibt ein neutraler Leerzustand.
 */
export function resolveBufferTile(outcome: BufferFetchOutcome): BufferKpi {
  switch (outcome.kind) {
    case 'error':
      return { value: '!', tone: 'warning', hint: i18n.t('label.telemetryCannotLoaded'), dot: false };
    case 'disabled':
      return { value: '—', tone: 'muted', hint: i18n.t('label.telemetryNotEnabled'), dot: false };
    case 'ok':
      return deriveBuffer(outcome.bufferAgents);
  }
}
