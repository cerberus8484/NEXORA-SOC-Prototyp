import { SectionHeader } from '../components/ui';
import { AuditCompliancePanel } from '../features/settings/AuditCompliancePanel';

/**
 * AuditCompliancePage — Audit-Aktivität & Aufbewahrung im Compliance-Bereich.
 * Aus den System-Einstellungen hierher gezogen (IA: fachlich zum Compliance-Bereich),
 * damit die Settings schlank bleiben. Reiner Seiten-Wrapper um das bestehende Panel;
 * der Titel kommt aus dem Topbar-Breadcrumb.
 */
export function AuditCompliancePage() {
  return (
    <div style={{ padding: '16px 20px' }}>
      <SectionHeader title="Audit & Compliance" help="audit" />
      <AuditCompliancePanel />
    </div>
  );
}
