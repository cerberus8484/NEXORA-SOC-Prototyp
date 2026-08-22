import { ThreatHuntingPanel } from '../features/settings/ThreatHuntingPanel';

/**
 * HuntingSettingsPage — Threat-Hunting-Konfiguration im Hunting-Bereich.
 * Aus den System-Einstellungen hierher gezogen (IA: fachlich zum Hunting-Bereich),
 * damit die Settings schlank bleiben. Reiner Seiten-Wrapper um das bestehende Panel;
 * der Titel kommt aus dem Topbar-Breadcrumb.
 */
export function HuntingSettingsPage() {
  return (
    <div style={{ padding: '16px 20px' }}>
      <ThreatHuntingPanel />
    </div>
  );
}
