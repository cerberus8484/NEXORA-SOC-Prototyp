import type { ArmSource, ManagedService } from './servicesApi';
import i18n from '../../i18n';

// Reine Abbildung des Scharfschalt-/Restart-Zustands eines Dienstes auf
// UI-Beschriftungen — Badge-Text, Arm-Herkunft, Restart-Sperrgrund und welche
// Aktionen (Scharfschalten / Entschärfen / Neustarten) verfügbar sind.
// Getrennt von der Komponente → gut testbar (Vitest), kein Fake: der Neustart
// bleibt gesperrt, solange die Wazuh-API nicht konfiguriert ist, selbst wenn
// scharfgeschaltet.

export type ArmBadgeTone = 'success' | 'muted';

export interface ArmView {
  /** Ist der Restart aktuell tatsächlich möglich (scharf UND API konfiguriert)? */
  canRestart: boolean;
  /** Badge-Text für den Scharfschalt-Zustand. */
  armBadge: string;
  armBadgeTone: ArmBadgeTone;
  /** Darf der Scharfschalten-Button gezeigt werden (nicht scharf)? */
  showArm: boolean;
  /** Darf der Entschärfen-Button gezeigt werden (per UI scharf)? */
  showDisarm: boolean;
  /** Ehrlicher Sperrgrund, wenn kein Neustart möglich (sonst null). */
  restartBlockedReason: string | null;
}

/** Menschlicher Text zur Herkunft der Scharfschaltung. */
export function armSourceLabel(source: ArmSource): string {
  if (source === 'env') return i18n.t('settings.armedViaEnv');
  if (source === 'ui') return 'per UI scharfgeschaltet';
  return i18n.t('ui.notArmed');
}

/**
 * Leitet die ehrliche Anzeige für die Wazuh-Manager-Karte ab.
 * `canRestart` ist nur true, wenn der Server den Restart freigibt
 * (restart.enabled) — Fake-Erfolg ist ausgeschlossen.
 */
export function deriveArmView(service: ManagedService): ArmView {
  const canRestart = service.restart.enabled;
  const armed = service.armed;

  return {
    canRestart,
    armBadge: armed ? 'Scharfgeschaltet' : i18n.t('text.notArmed'),
    armBadgeTone: armed ? 'success' : 'muted',
    // Scharfschalten anbieten, solange nicht scharf.
    showArm: !armed,
    // Entschärfen nur, wenn per UI scharf — ENV kann die UI nicht abschalten.
    showDisarm: armed && service.armSource === 'ui',
    // Ehrlicher Sperrgrund: API-Konfig hat Vorrang, dann fehlende Scharfschaltung.
    restartBlockedReason: canRestart ? null : (service.restart.disabledReason ?? i18n.t('ui.restartNotPossible')),
  };
}
