import type { CSSProperties } from 'react';
import { Info, ShieldCheck, Radar, Database, ShieldAlert, Ticket, Mail, KeyRound, Webhook, Cable, Plug } from 'lucide-react';
import { SectionHeader, Accordion, Card, CardHeader, CardBody, ExampleHint } from '../components/ui';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { WazuhConnectionCard } from '../features/services/WazuhConnectionCard';
import { ApiWebhooksPanel } from '../features/settings/ApiWebhooksPanel';
import { ThreatIntelKeysCard } from '../features/settings/ThreatIntelKeysCard';
import { QradarConnectionCard } from '../features/settings/QradarConnectionCard';
import { QdrantConnectionCard } from '../features/settings/QdrantConnectionCard';
import { CrowdsecConnectionCard } from '../features/settings/CrowdsecConnectionCard';
import { ServicenowConnectionCard } from '../features/settings/ServicenowConnectionCard';
import { OtrsConnectionCard } from '../features/settings/OtrsConnectionCard';
import { ImapConnectionCard } from '../features/settings/ImapConnectionCard';
import { WebhookSecretsCard } from '../features/settings/WebhookSecretsCard';
import { IntegrationsPanel } from '../features/settings/IntegrationsPanel';

const s: Record<string, CSSProperties> = {
  // Breite gekappt — die Verbindungs-Formulare brauchen keine volle Bildschirmbreite.
  page:  { padding: '24px 28px', maxWidth: 920 },
  note:  { display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', margin: '14px 0 18px' },
  stack: { display: 'flex', flexDirection: 'column', gap: 10 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 },
};

// Jede Integration ist ein eingeklapptes Akkordeon: kompakte Liste, aufklappen zum
// Konfigurieren (die Karte wird erst beim Aufklappen gemountet → lädt lazy).
const ICON = 16;

/**
 * Integrations-Konfiguration — Verbindungs-/Secret-/Key-Konfiguration ALLER Integrationen
 * an EINER Stelle (inkl. Wazuh — aus den Services hierher gezogen; Services = reine Ops).
 * Admin-gated; jede Karte erzwingt ihre Rolle zusätzlich serverseitig.
 */
export function IntegrationsConfigPage() {
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);

  return (
    <div style={s.page}>
      <SectionHeader
        title="Integrations-Konfiguration"
        subtitle="Verbindungen, Threat-Intel-Keys & Webhook-Secrets — aufklappen zum Konfigurieren"
        help="integrationen"
      />

      {!isAdmin ? (
        <div style={s.note}>
          <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span>Die Integrations-Konfiguration ist der Admin-Rolle vorbehalten.</span>
        </div>
      ) : (
        <div style={s.stack}>
          <Card>
            <CardHeader title="Schnellstart mit Beispielen" actions={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>erst verstehen, dann aufklappen</span>} />
            <CardBody>
              <div style={s.quickGrid}>
                <ExampleHint
                  title="Wazuh-Verbindung"
                  text="Typischer Start fuer die Manager-Anbindung. Die echten Felder findest du nach dem Aufklappen der Wazuh-Karte."
                  exampleLabel="Beispielwerte"
                  rows={[
                    { label: 'URL', value: 'https://wazuh.nexora.local:55000' },
                    { label: 'User', value: 'nexora-api' },
                  ]}
                  footer="Basis ist immer die echte Manager-Adresse plus API-Zugang fuer Nexora."
                />
                <ExampleHint
                  title="Threat-Intel-Keys"
                  text="Hier landen Provider-Keys fuer externe Reputation-Lookups."
                  exampleLabel="Beispielwerte"
                  rows={[
                    { label: 'Provider', value: 'VirusTotal' },
                    { label: 'Status', value: 'Key gesetzt' },
                  ]}
                  footer="Leere Felder aendern nichts. Ein neuer Key wird erst beim Speichern uebernommen."
                />
                <ExampleHint
                  title="Inbound-Webhook-Secrets"
                  text="Jede Quelle braucht dasselbe HMAC-Secret wie der externe Sender."
                  exampleLabel="Beispielwerte"
                  rows={[
                    { label: 'Quelle', value: 'wazuh' },
                    { label: 'Secret', value: 'rotieren und speichern' },
                  ]}
                  footer="Nach einer Rotation muss auch das Gegenueber sofort auf dasselbe Secret umgestellt werden."
                />
              </div>
            </CardBody>
          </Card>
          <Accordion title="Wazuh-Verbindung"        icon={<ShieldCheck size={ICON} />}><WazuhConnectionCard /></Accordion>
          <Accordion title="QRadar-Verbindung"       icon={<Radar size={ICON} />}><QradarConnectionCard /></Accordion>
          <Accordion title="Qdrant-Verbindung"       icon={<Database size={ICON} />}><QdrantConnectionCard /></Accordion>
          <Accordion title="CrowdSec-Verbindung"     icon={<ShieldAlert size={ICON} />}><CrowdsecConnectionCard /></Accordion>
          <Accordion title="ServiceNow-Verbindung"   icon={<Ticket size={ICON} />}><ServicenowConnectionCard /></Accordion>
          <Accordion title="OTRS-Verbindung"         icon={<Ticket size={ICON} />}><OtrsConnectionCard /></Accordion>
          <Accordion title="IMAP-Postfach"           icon={<Mail size={ICON} />}><ImapConnectionCard /></Accordion>
          <Accordion title="Threat-Intel-Keys"       icon={<KeyRound size={ICON} />}><ThreatIntelKeysCard /></Accordion>
          <Accordion title="Inbound-Webhook-Secrets" icon={<Webhook size={ICON} />}><WebhookSecretsCard /></Accordion>
          <Accordion title="API-Zugriff & Webhooks"  icon={<Cable size={ICON} />}><ApiWebhooksPanel /></Accordion>
          <Accordion title="Integrations-Status"     icon={<Plug size={ICON} />}><IntegrationsPanel /></Accordion>
        </div>
      )}
    </div>
  );
}
