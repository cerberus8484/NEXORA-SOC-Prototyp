'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_GITOPS_3 — Plan-Generator (read-only)
//
// Erzeugt aus einem (validierten) Node-Profil einen verständlichen Plan/Preview
// für den PR-Kommentar. **Ändert nichts, ruft nichts auf** — reine Anzeige.
// Macht explizit klar: Bootstrap installiert/enrollt nur, keine Netzwerkänderung.
// ─────────────────────────────────────────────────────────────────────────

// Die zentrale Sicherheits-Aussage — steht in JEDEM Plan.
const SAFETY_LINE = 'Bootstrap installs/enrolls only. No IP/DHCP/Gateway/DNS/NAT/Routing/Sniffing/Firewall changes.';

const BOOTSTRAP_WILL = [
  'install Nexora agent/connector',
  'enroll node with Nexora backend',
  'report hostname, IPs, interfaces (read-only)',
  'start heartbeat',
];

const BOOTSTRAP_WILL_NOT = [
  'change IP address',
  'change DHCP/static mode',
  'change gateway',
  'change DNS',
  'enable sniffing',
  'enable NAT',
  'enable routing',
  'change firewall rules',
  'change Wazuh or OPNsense config',
];

function isObj(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

/**
 * Strukturierten Plan aus einem Profil ableiten (kein Apply, nur Beschreibung).
 * @returns {{ name, role, risk, desiredFuture: string[], approvals: string[] }}
 */
function planNodeProfile(profile) {
  const node = isObj(profile) && isObj(profile.node) ? profile.node : {};
  const features = isObj(profile) && isObj(profile.features) ? profile.features : {};
  const ds = isObj(profile) && isObj(profile.network) && isObj(profile.network.desiredState) ? profile.network.desiredState : null;
  const req = (k) => isObj(features[k]) && features[k].requested === true;

  const desiredFuture = [];
  if (ds && ds.mode === 'static' && ds.ip) {
    desiredFuture.push(`static IP ${ds.ip}/${ds.cidr ?? '?'} on ${ds.managementInterface || 'mgmt-if'}`);
  }
  if (req('syslogReceiver')) desiredFuture.push('syslog receiver');
  if (req('flowCollector'))  desiredFuture.push('flow collector');
  if (req('sniffing'))       desiredFuture.push(`passive sniffing on ${features.sniffing.interface || '?'}`);
  if (req('nat'))            desiredFuture.push('NAT (gateway)');
  if (req('routing'))        desiredFuture.push('routing (gateway)');

  const approvals = [];
  if (req('sniffing'))               approvals.push('sensor approval (sniffing requested)');
  if (req('nat') || req('routing'))  approvals.push('gateway approval + change-window + rollback (NAT/routing requested)');

  // Risiko: höchste zutreffende Stufe.
  let risk = 'low';
  if (ds && ds.mode === 'static') risk = 'medium';
  if (req('sniffing'))            risk = 'medium';
  if (req('nat') || req('routing')) risk = 'high';

  return { name: node.name || '(unnamed)', role: node.role || '(no role)', risk, desiredFuture, approvals };
}

const bullets = (arr) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- (none)');

/**
 * Plan eines Profils als Markdown (für PR-Kommentar / Step-Summary).
 */
function renderPlanMarkdown(profile) {
  const p = planNodeProfile(profile);
  return [
    `### ${p.name} — role: \`${p.role}\` · risk: **${p.risk}**`,
    '',
    `> ${SAFETY_LINE}`,
    '',
    '**Bootstrap will:**',
    bullets(BOOTSTRAP_WILL),
    '',
    '**Bootstrap will NOT:**',
    bullets(BOOTSTRAP_WILL_NOT),
    '',
    '**Desired future state (NOT applied now — separate approved workflow):**',
    bullets(p.desiredFuture),
    '',
    '**Required approvals for future apply:**',
    bullets(p.approvals),
  ].join('\n');
}

module.exports = { planNodeProfile, renderPlanMarkdown, SAFETY_LINE, BOOTSTRAP_WILL, BOOTSTRAP_WILL_NOT };
