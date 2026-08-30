'use strict';

// ─────────────────────────────────────────────────────────────────────────
// NIS2 Control Catalog (P_NIS2_1) — statisch + versioniert.
//
// WICHTIG / ehrliche Positionierung:
//   Dies ist eine **Arbeits- und Nachweis-Unterstützung** (Readiness & Evidence),
//   KEIN Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten.
//   Die zehn Bereiche bilden die Risikomanagement-Maßnahmen nach NIS2/BSIG als
//   Produktkatalog ab — bewusst neutral formuliert, ohne Gesetzeszitate im Code.
//   Offizielle Quellen gehören in die Doku, nicht hierher.
//
// Stabiler `key` (nie umbenennen — er bindet Assessments), englischer UI-Text.
// ─────────────────────────────────────────────────────────────────────────

const CATALOG_VERSION = '2026-06.2';

/** @type {ReadonlyArray<{key:string,title:string,shortDescription:string,evidenceHints:string[],defaultRiskArea:string,sourceReference:string,version:string}>} */
const NIS2_CONTROLS = Object.freeze([
  {
    key: 'risk_analysis_and_information_security',
    title: 'Risk analysis and information security policies',
    shortDescription: 'Policies for risk analysis and the security of information systems.',
    evidenceHints: ['Risk analysis document', 'Information security policy', 'Risk register'],
    defaultRiskArea: 'Governance',
    sourceReference: 'BSIG §30(2) no. 1 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'incident_handling',
    title: 'Incident handling',
    shortDescription: 'Processes for detecting, handling and reviewing security incidents.',
    evidenceHints: ['Incident response plan', 'Ticket or case for a handled incident', 'Post-incident review'],
    defaultRiskArea: 'Operations',
    sourceReference: 'BSIG §30(2) no. 2 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'business_continuity_backup_disaster_recovery',
    title: 'Business continuity, backups, recovery and crisis management',
    shortDescription: 'Continuity of operations, data backup, recovery and crisis management.',
    evidenceHints: ['Backup policy', 'Restore test record', 'Business continuity plan'],
    defaultRiskArea: 'Resilience',
    sourceReference: 'BSIG §30(2) no. 3 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'supply_chain_security',
    title: 'Supply chain and service-provider security',
    shortDescription: 'Security in relationships with suppliers and service providers.',
    evidenceHints: ['Service-provider register', 'Contractual security requirements', 'Supplier assessment'],
    defaultRiskArea: 'Supply Chain',
    sourceReference: 'BSIG §30(2) no. 4 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'secure_acquisition_development_maintenance',
    title: 'Secure acquisition, development and maintenance',
    shortDescription: 'Security in the acquisition, development and maintenance of systems, including vulnerability handling.',
    evidenceHints: ['Secure SDLC policy', 'Vulnerability-management evidence', 'Patch process'],
    defaultRiskArea: 'SDLC',
    sourceReference: 'BSIG §30(2) no. 5 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'effectiveness_assessment',
    title: 'Effectiveness assessment of security measures',
    shortDescription: 'Methods for assessing the effectiveness of risk-management measures.',
    evidenceHints: ['Audit report', 'Effectiveness measurement / KPI', 'Management review'],
    defaultRiskArea: 'Assurance',
    sourceReference: 'BSIG §30(2) no. 6 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'cyber_hygiene_training',
    title: 'Cyber hygiene and training',
    shortDescription: 'Basic cyber-hygiene practices and information-security training.',
    evidenceHints: ['Training record', 'Awareness programme', 'Cyber-hygiene policy'],
    defaultRiskArea: 'People',
    sourceReference: 'BSIG §30(2) no. 7 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'cryptography_and_encryption',
    title: 'Cryptography and encryption',
    shortDescription: 'Policies and procedures for cryptography and, where appropriate, encryption.',
    evidenceHints: ['Cryptography policy', 'Encryption standard', 'Key-management evidence'],
    defaultRiskArea: 'Crypto',
    sourceReference: 'BSIG §30(2) no. 8 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'access_control_asset_management',
    title: 'Access control and asset management',
    shortDescription: 'Personnel security, access-control policies and asset management.',
    evidenceHints: ['Access-control policy', 'Asset inventory', 'Access review'],
    defaultRiskArea: 'Access',
    sourceReference: 'BSIG §30(2) no. 9 — risk-management measure',
    version: CATALOG_VERSION,
  },
  {
    key: 'mfa_and_secure_communications',
    title: 'Multi-factor authentication and secure communications',
    shortDescription: 'MFA or continuous authentication and secure voice, video and text communications.',
    evidenceHints: ['MFA rollout evidence', 'Secure-communications configuration', 'Emergency communications plan'],
    defaultRiskArea: 'Comms',
    sourceReference: 'BSIG §30(2) no. 10 — risk-management measure',
    version: CATALOG_VERSION,
  },
]);

const CONTROL_KEYS = Object.freeze(NIS2_CONTROLS.map((c) => c.key));
const CONTROL_BY_KEY = Object.freeze(Object.fromEntries(NIS2_CONTROLS.map((c) => [c.key, c])));

function isKnownControlKey(key) { return Object.prototype.hasOwnProperty.call(CONTROL_BY_KEY, key); }
function getControl(key) { return CONTROL_BY_KEY[key] || null; }

module.exports = {
  CATALOG_VERSION,
  NIS2_CONTROLS,
  CONTROL_KEYS,
  CONTROL_BY_KEY,
  isKnownControlKey,
  getControl,
};
