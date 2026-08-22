'use strict';

/**
 * RuleExporter — reine Transformationsfunktionen, keine Seiteneffekte.
 *
 * Eingabe: UseCaseDraft-Objekt (oder kompatibles POJO)
 * Ausgabe: Textuelle Export-Vorschau für das jeweilige SIEM/Detection-Format
 *
 * Sicherheit:
 *   - Wazuh/XML: alle Werte werden XML-escaped (< > & " ')
 *   - Sigma/YAML: title/description werden YAML-gequotet (einfache Anführungszeichen)
 *   - Splunk/SPL:  Werte kommen ausschließlich in Kommentarzeilen, nicht im WHERE-Clause
 *   - QRadar/AQL:  Werte kommen ausschließlich in Kommentarzeilen, nicht im WHERE-Clause
 *
 * Severity → Level Mapping (benannte Konstante, kein Magic):
 *   critical → 14, high → 12, medium → 10, low → 6
 */

const { ValidationError } = require('../errors/AppError');

// ─── Severity → Level Mapping ────────────────────────────────────────────────

const SEVERITY_TO_WAZUH_LEVEL = Object.freeze({
  critical: 14,
  high:     12,
  medium:   10,
  low:       6,
});

const SEVERITY_TO_SIGMA_LEVEL = Object.freeze({
  critical: 'critical',
  high:     'high',
  medium:   'medium',
  low:      'low',
});

// ─── Gültige Formate ─────────────────────────────────────────────────────────

const VALID_FORMATS = new Set(['wazuh', 'sigma', 'splunk', 'qradar']);

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/**
 * XML-escaped einen String: < > & " '
 * Verhindert XML-Injection in Wazuh-Regelblöcken.
 */
function xmlEscape(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * YAML-Wert mit einfachen Anführungszeichen quoten.
 * Einfache Anführungszeichen im Wert werden verdoppelt (' → '').
 * Verhindert YAML-Injection durch newline/colon-Tricks im title.
 */
function yamlSingleQuote(value) {
  const s = String(value ?? '');
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Sammelt MITRE-Techniken aus dem draft.mitre Array.
 * Gibt Array von Strings (z.B. ['T1059.001', 'T1055']) zurück.
 */
function mitreIds(draft) {
  if (!Array.isArray(draft.mitre)) return [];
  return draft.mitre
    .map((m) => m?.technique || '')
    .filter(Boolean);
}

/**
 * Wazuh-Level aus severity (Default: 10 = medium).
 */
function wazuhLevel(severity) {
  return SEVERITY_TO_WAZUH_LEVEL[severity] ?? SEVERITY_TO_WAZUH_LEVEL.medium;
}

/**
 * Sigma-Level aus severity (Default: medium).
 */
function sigmaLevel(severity) {
  return SEVERITY_TO_SIGMA_LEVEL[severity] ?? 'medium';
}

/**
 * Extrahiert queryOrRule aus detectionLogic.
 * Gibt leeren String zurück wenn nicht vorhanden.
 */
function getQuery(draft) {
  return String(draft?.detectionLogic?.queryOrRule ?? '');
}

/**
 * Gibt queryOrRule zurück wenn language == targetLang, sonst leer.
 */
function nativeQuery(draft, targetLang) {
  const dl = draft?.detectionLogic ?? {};
  if (dl.language === targetLang) return String(dl.queryOrRule ?? '');
  return '';
}

// ─── Wazuh ────────────────────────────────────────────────────────────────────

/**
 * Erzeugt einen Wazuh-Regel-XML-Block als Vorschau.
 * ID-Platzhalter: 100500 (kein echtes Aktivieren).
 * Alle Feldwerte werden XML-escaped.
 *
 * @param {object} draft - UseCaseDraft POJO
 * @returns {string} Wazuh XML rule block
 */
function toWazuh(draft) {
  const level       = wazuhLevel(draft.severity);
  const description = xmlEscape(draft.title || draft.description || 'Use Case Detection');
  const ids         = mitreIds(draft);

  const mitreBlock = ids.length > 0
    ? [
        '    <mitre>',
        ...ids.map((id) => `      <id>${xmlEscape(id)}</id>`),
        '    </mitre>',
      ].join('\n')
    : null;

  // Group aus Datenquellen oder Fallback
  const groupValue = Array.isArray(draft.dataSources) && draft.dataSources.length > 0
    ? draft.dataSources.map(xmlEscape).join(',')
    : 'soc_detection,';

  // Eingebettete queryOrRule (falls schon in Wazuh-Format)
  const nativeRule = nativeQuery(draft, 'wazuh');
  const matchBlock = nativeRule
    ? `    <!-- Detection Logic (Wazuh): -->\n    <!-- ${xmlEscape(nativeRule)} -->`
    : `    <!-- Detection Logic: ${xmlEscape(getQuery(draft) || 'Customize detection logic here')} -->`;

  const lines = [
    `<!-- USE CASE EXPORT PREVIEW — NICHT AKTIVIERT -->`,
    `<!-- Title: ${xmlEscape(draft.title || '')} -->`,
    `<!-- Severity: ${xmlEscape(String(draft.severity || 'medium'))} | Confidence: ${draft.confidence ?? 0}% -->`,
    ``,
    `<group name="${groupValue}">`,
    `  <rule id="100500" level="${level}">`,
    `    <description>${description}</description>`,
    mitreBlock,
    matchBlock,
    `    <!-- MITRE: ${ids.length ? ids.join(', ') : 'n/a'} -->`,
    `    <!-- Adjust id, match/regex, and group for your environment -->`,
    `  </rule>`,
    `</group>`,
  ].filter((l) => l !== null);

  return lines.join('\n');
}

// ─── Sigma ────────────────────────────────────────────────────────────────────

/**
 * Erzeugt ein Sigma-YAML-Dokument als Vorschau.
 * title und description werden YAML-gequotet (XSS/Injection-Schutz).
 * tags enthalten attack.tXXXX (lowercase).
 *
 * @param {object} draft - UseCaseDraft POJO
 * @returns {string} Sigma YAML string
 */
function toSigma(draft) {
  const ids        = mitreIds(draft);
  const tags       = ids.map((id) => `    - attack.${id.toLowerCase()}`);
  const level      = sigmaLevel(draft.severity);

  const fpLines = Array.isArray(draft.falsePositiveRisks) && draft.falsePositiveRisks.length > 0
    ? draft.falsePositiveRisks.map((fp) => `    - ${yamlSingleQuote(fp)}`)
    : ['    - Unknown'];

  // Datenquellen für logsource
  const sources = Array.isArray(draft.dataSources) ? draft.dataSources : [];
  const category = sources.includes('sysmon') ? 'process_creation'
    : sources.includes('windows_event_log') ? 'security'
    : 'generic';
  const product  = sources.some((s) => s.toLowerCase().includes('windows')) || sources.includes('sysmon') || sources.includes('windows_event_log')
    ? 'windows'
    : 'any';

  // queryOrRule einbetten wenn schon in Sigma-Format
  const nativeSigma = nativeQuery(draft, 'sigma');
  const detectionBlock = nativeSigma
    ? `detection:\n${nativeSigma.split('\n').map((l) => `    ${l}`).join('\n')}`
    : [
        'detection:',
        '  selection:',
        ...Array.isArray(draft.requiredFields) && draft.requiredFields.length > 0
          ? draft.requiredFields.map((f) => `    ${f}: '*'`)
          : ['    placeholder: true'],
        '  condition: selection',
      ].join('\n');

  const parts = [
    `# USE CASE EXPORT PREVIEW — SIGMA — NICHT AKTIVIERT`,
    `# Generiert aus Use-Case-Draft`,
    ``,
    `title: ${yamlSingleQuote(draft.title || 'Untitled Detection')}`,
    `id: ${draft.id || 'replace-with-uuid'}`,
    `status: experimental`,
    `description: ${yamlSingleQuote(draft.description || draft.detectionGoal || '')}`,
    `author: SOC Use-Case Developer (Nexora)`,
    tags.length > 0 ? `tags:\n${tags.join('\n')}` : null,
    ``,
    `logsource:`,
    `    category: ${category}`,
    `    product: ${product}`,
    ``,
    detectionBlock,
    ``,
    `falsepositives:\n${fpLines.join('\n')}`,
    ``,
    `level: ${level}`,
  ].filter((l) => l !== null);

  return parts.join('\n');
}

// ─── Splunk ───────────────────────────────────────────────────────────────────

/**
 * Erzeugt eine Splunk SPL-Suche als Vorschau.
 * Werte (title, mitre) kommen NUR in Kommentarzeilen — nicht im ausführbaren SPL.
 * Verhindert SPL-Injection durch Nutzerdaten.
 *
 * @param {object} draft - UseCaseDraft POJO
 * @returns {string} Splunk SPL string
 */
function toSplunk(draft) {
  const ids     = mitreIds(draft);
  const sources = Array.isArray(draft.dataSources) ? draft.dataSources : [];

  // Index-Auswahl aus Datenquellen (Kommentar-sicher)
  const indexPart = sources.length > 0
    ? `index=${sources[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
    : 'index=*';

  // Native SPL einbetten wenn vorhanden
  const nativeSpl = nativeQuery(draft, 'splunk');
  const searchPart = nativeSpl
    ? nativeSpl
    : (() => {
        const fields = Array.isArray(draft.requiredFields) && draft.requiredFields.length > 0
          ? draft.requiredFields
          : ['*'];
        return `| search ${fields.map((f) => `${f}=*`).join(' ')}`;
      })();

  const lines = [
    `| USE CASE EXPORT PREVIEW — SPLUNK SPL — NICHT AKTIVIERT`,
    `| Title    : ${draft.title || 'Untitled Detection'}`,
    `| Severity : ${draft.severity || 'medium'} | Confidence: ${draft.confidence ?? 0}%`,
    `| MITRE    : ${ids.length ? ids.join(', ') : 'n/a'}`,
    `| DataSrc  : ${sources.join(', ') || 'n/a'}`,
    `|`,
    `| Passe index, sourcetype und Suchbedingungen an deine Umgebung an.`,
  ].map((l) => `\`\`comment\`\` ${l}`).join('\n');

  return [
    lines,
    ``,
    `${indexPart}`,
    searchPart.startsWith('|') ? searchPart : `| search ${searchPart}`,
    `| eval rule_name="${draft.title ? draft.title.replace(/["\\]/g, '') : 'detection'}"`,
    `| eval mitre_technique="${ids.length ? ids[0] : 'n/a'}"`,
    `| table _time, host, source, rule_name, mitre_technique`,
  ].join('\n');
}

// ─── QRadar ───────────────────────────────────────────────────────────────────

/**
 * Erzeugt eine QRadar AQL-Suche als Vorschau.
 * Werte (title, mitre) kommen NUR in Kommentarzeilen — nicht im WHERE-Clause.
 * Verhindert AQL-Injection durch Nutzerdaten.
 *
 * @param {object} draft - UseCaseDraft POJO
 * @returns {string} QRadar AQL string
 */
function toQRadar(draft) {
  const ids     = mitreIds(draft);
  const sources = Array.isArray(draft.dataSources) ? draft.dataSources : [];

  // Native AQL einbetten wenn vorhanden
  const nativeAql = nativeQuery(draft, 'qradar');

  const header = [
    `-- USE CASE EXPORT PREVIEW — QRADAR AQL — NICHT AKTIVIERT`,
    `-- Title    : ${(draft.title || '').replace(/--/g, '- -')}`,
    `-- Severity : ${draft.severity || 'medium'} | Confidence: ${draft.confidence ?? 0}%`,
    `-- MITRE    : ${ids.length ? ids.join(', ') : 'n/a'}`,
    `-- DataSrc  : ${sources.join(', ') || 'n/a'}`,
    `--`,
    `-- Passe WHERE-Klausel und Felder an deine QRadar-Umgebung an.`,
  ].join('\n');

  let query;
  if (nativeAql) {
    query = nativeAql;
  } else {
    const fields = Array.isArray(draft.requiredFields) && draft.requiredFields.length > 0
      ? draft.requiredFields.map((f) => `  "${f}"`).join(',\n')
      : '  "sourceip", "destinationip", "username", "eventtype"';

    const whereClause = '  UTF8(payload) ILIKE \'%detection-placeholder%\'';

    query = [
      `SELECT`,
      `  QIDNAME(qid) AS event_name,`,
      `  devicetime,`,
      fields,
      `FROM events`,
      `WHERE`,
      whereClause,
      `LAST 24 HOURS`,
    ].join('\n');
  }

  return `${header}\n\n${query}`;
}

// ─── exportDraft (Dispatch) ───────────────────────────────────────────────────

/**
 * Dispatch-Funktion: wählt den passenden Exporter anhand format.
 * Wirft ValidationError (400) bei unbekanntem oder fehlendem Format.
 *
 * @param {object} draft   - UseCaseDraft POJO
 * @param {string} format  - 'wazuh' | 'sigma' | 'splunk' | 'qradar'
 * @returns {string} Exportierter Content
 * @throws {ValidationError} Bei unbekanntem/fehlendem Format
 */
function exportDraft(draft, format) {
  const fmt = String(format || '').toLowerCase().trim();
  if (!fmt || !VALID_FORMATS.has(fmt)) {
    throw new ValidationError(
      `Unbekanntes Export-Format: "${format}". Gültige Formate: ${[...VALID_FORMATS].join(', ')}`,
    );
  }

  switch (fmt) {
    case 'wazuh':  return toWazuh(draft);
    case 'sigma':  return toSigma(draft);
    case 'splunk': return toSplunk(draft);
    case 'qradar': return toQRadar(draft);
    default:
      // Wird nie erreicht, aber explizit für kein stilles Verschlucken
      throw new ValidationError(`Unbekanntes Format: ${format}`);
  }
}

// ─── Format → Sprache (für die API-Response) ─────────────────────────────────

const FORMAT_LANGUAGE = Object.freeze({
  wazuh:  'xml',
  sigma:  'yaml',
  splunk: 'spl',
  qradar: 'aql',
});

/**
 * Gibt die Sprach-Bezeichnung für ein Format zurück.
 * Nützlich für die API-Response (`language`-Feld).
 */
function formatLanguage(format) {
  return FORMAT_LANGUAGE[String(format || '').toLowerCase()] || 'text';
}

module.exports = {
  toWazuh,
  toSigma,
  toSplunk,
  toQRadar,
  exportDraft,
  formatLanguage,
  SEVERITY_TO_WAZUH_LEVEL,
  SEVERITY_TO_SIGMA_LEVEL,
  VALID_FORMATS,
};
