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
// Stabiler `key` (nie umbenennen — er bindet Assessments), deutscher `title`.
// ─────────────────────────────────────────────────────────────────────────

const CATALOG_VERSION = '2026-06.1';

/** @type {ReadonlyArray<{key:string,title:string,shortDescription:string,evidenceHints:string[],defaultRiskArea:string,sourceReference:string,version:string}>} */
const NIS2_CONTROLS = Object.freeze([
  {
    key: 'risk_analysis_and_information_security',
    title: 'Risikoanalyse und Informationssicherheitskonzepte',
    shortDescription: 'Konzepte für Risikoanalyse und die Sicherheit von Informationssystemen.',
    evidenceHints: ['Risikoanalyse-Dokument', 'Informationssicherheitsleitlinie', 'Risikoregister'],
    defaultRiskArea: 'Governance',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 1 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'incident_handling',
    title: 'Bewältigung von Sicherheitsvorfällen',
    shortDescription: 'Prozesse zur Erkennung, Behandlung und Nachbereitung von Sicherheitsvorfällen.',
    evidenceHints: ['Incident-Response-Plan', 'Ticket/Case eines bearbeiteten Vorfalls', 'Post-Incident-Review'],
    defaultRiskArea: 'Operations',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 2 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'business_continuity_backup_disaster_recovery',
    title: 'Business Continuity, Backups, Wiederherstellung und Krisenmanagement',
    shortDescription: 'Aufrechterhaltung des Betriebs, Datensicherung, Wiederherstellung und Krisenmanagement.',
    evidenceHints: ['Backup-Konzept', 'Restore-Test-Protokoll', 'Business-Continuity-Plan'],
    defaultRiskArea: 'Resilience',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 3 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'supply_chain_security',
    title: 'Sicherheit der Lieferkette und Dienstleister',
    shortDescription: 'Sicherheit in den Beziehungen zu Lieferanten und Dienstleistern.',
    evidenceHints: ['Dienstleister-Verzeichnis', 'Vertragliche Sicherheitsanforderungen', 'Lieferanten-Bewertung'],
    defaultRiskArea: 'Supply Chain',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 4 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'secure_acquisition_development_maintenance',
    title: 'Sichere Beschaffung, Entwicklung und Wartung',
    shortDescription: 'Sicherheit bei Beschaffung, Entwicklung und Wartung von Systemen, inkl. Schwachstellenbehandlung.',
    evidenceHints: ['Secure-SDLC-Leitlinie', 'Vulnerability-Management-Nachweis', 'Patch-Prozess'],
    defaultRiskArea: 'SDLC',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 5 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'effectiveness_assessment',
    title: 'Bewertung der Wirksamkeit von Sicherheitsmaßnahmen',
    shortDescription: 'Verfahren zur Bewertung der Wirksamkeit der Risikomanagement-Maßnahmen.',
    evidenceHints: ['Audit-Bericht', 'Wirksamkeitsmessung/KPI', 'Management-Review'],
    defaultRiskArea: 'Assurance',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 6 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'cyber_hygiene_training',
    title: 'Cyberhygiene und Schulungen',
    shortDescription: 'Grundlegende Cyberhygiene-Praktiken und Schulungen im Bereich Informationssicherheit.',
    evidenceHints: ['Schulungsnachweis', 'Awareness-Programm', 'Cyberhygiene-Richtlinie'],
    defaultRiskArea: 'People',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 7 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'cryptography_and_encryption',
    title: 'Kryptografie und Verschlüsselung',
    shortDescription: 'Konzepte und Verfahren für Kryptografie und gegebenenfalls Verschlüsselung.',
    evidenceHints: ['Krypto-Konzept', 'Verschlüsselungsstandard', 'Schlüsselmanagement-Nachweis'],
    defaultRiskArea: 'Crypto',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 8 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'access_control_asset_management',
    title: 'Zugriffskontrolle und Asset Management',
    shortDescription: 'Sicherheit des Personals, Konzepte für Zugriffskontrolle und Verwaltung von Anlagen.',
    evidenceHints: ['Berechtigungskonzept', 'Asset-Inventar', 'Zugriffs-Review'],
    defaultRiskArea: 'Access',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 9 — Risikomanagement-Maßnahme',
    version: CATALOG_VERSION,
  },
  {
    key: 'mfa_and_secure_communications',
    title: 'Multi-Faktor-Authentisierung und gesicherte Kommunikation',
    shortDescription: 'MFA/kontinuierliche Authentisierung sowie gesicherte Sprach-, Video- und Textkommunikation.',
    evidenceHints: ['MFA-Rollout-Nachweis', 'Konfiguration gesicherter Kommunikation', 'Notfall-Kommunikationskonzept'],
    defaultRiskArea: 'Comms',
    sourceReference: 'BSIG §30 Abs. 2 Nr. 10 — Risikomanagement-Maßnahme',
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
