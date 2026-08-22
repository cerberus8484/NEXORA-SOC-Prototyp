'use strict';

const { LOG_LEVEL } = require('./HuntLog');

/**
 * huntTypeFactory — DRY-Bausatz für deterministische, mock-backed Hunt-Typen.
 *
 * Jeder Hunt-Typ ist datengetrieben über eine `spec` beschrieben. Der Factory
 * baut daraus eine Definition mit exakt derselben Form wie die handgeschriebenen
 * Hunts in HuntType.js: { label, description, category, mitre, dataSources,
 * targetType, defaultTarget, defaultIp, riskLevel, build(session) → { logs, findings } }.
 *
 * SAFETY: Es wird NICHTS remote ausgeführt. Alle "safe commands" / "queries" sind
 * reine Anzeige-Strings im Log. Kein child_process, keine Shell, keine Provider-Calls.
 *
 * @typedef {Object} HuntSpec
 * @property {string}   label
 * @property {string}   description   — analyst-taugliche Beschreibung (was + warum)
 * @property {string}   category      — Taktik-Kategorie (= mitreTactic)
 * @property {string}   mitre         — Haupt-Technik (Txxxx oder Txxxx.xxx)
 * @property {string[]} dataSources
 * @property {string}   [defaultTarget='Windows-01']
 * @property {string}   [defaultIp='']
 * @property {'low'|'medium'|'high'|'critical'} riskLevel
 * @property {number}   confidencePct — 0..100, steuert Confidence-Level + Verdict-Default
 * @property {string}   findingTitle
 * @property {string}   findingDescription
 * @property {string[]} steps         — Runner-Schritte (INFO-Logs vor dem Treffer)
 * @property {string}   detectLine    — WARNING-Log: was konkret erkannt wurde
 * @property {string[]} recommendation
 * @property {Object}   [context={}]  — zusätzliche Kontextfelder (process, user, commandLine, …)
 * @property {'benign'|'suspicious'|'malicious'|'unknown'} [verdict]
 */

const pctToConfidence = (pct) => (pct >= 75 ? 'high' : pct >= 40 ? 'medium' : 'low');

/** Verdict-Default aus dem Risk-Score ableiten, sofern nicht explizit gesetzt. */
const defaultVerdict = (pct) => (pct >= 85 ? 'malicious' : pct >= 40 ? 'suspicious' : 'benign');

const severityLabel = (s) =>
  s === 'critical' ? 'Critical' : s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low';

/**
 * Baut aus einer HuntSpec eine vollständige Hunt-Typ-Definition.
 * @param {HuntSpec} spec
 * @returns {object} Hunt-Typ-Definition mit build(session)
 */
function defineHunt(spec) {
  const {
    label,
    description,
    category,
    mitre,
    dataSources,
    defaultTarget = 'Windows-01',
    defaultIp = '',
    riskLevel,
    confidencePct,
    findingTitle,
    findingDescription,
    steps,
    detectLine,
    recommendation,
    context = {},
    verdict,
  } = spec;

  const resolvedVerdict = verdict || defaultVerdict(confidencePct);

  return {
    label,
    description,
    category,
    mitre,
    dataSources: [...dataSources],
    targetType: 'host',
    defaultTarget,
    defaultIp,
    riskLevel,
    build(session) {
      const key = spec.key;
      const host = session.targetHost || defaultTarget;
      const ip = session.context?.sourceIp || context.sourceIp || defaultIp || '';

      const logs = [
        [LOG_LEVEL.INFO, 'Hunt session created'],
        [LOG_LEVEL.INFO, `Hunt Type: ${key}`],
        [LOG_LEVEL.INFO, `Target: ${host}${ip ? ` (${ip})` : ''}`],
        [LOG_LEVEL.INFO, `Data Sources: ${dataSources.join(', ')}`],
        ...steps.map((s) => [LOG_LEVEL.INFO, s]),
        [LOG_LEVEL.WARNING, detectLine],
        [LOG_LEVEL.SUCCESS, `Finding created: ${findingTitle} (${severityLabel(riskLevel)})`],
        [LOG_LEVEL.SUCCESS, 'Hunt completed'],
        [LOG_LEVEL.INFO, 'Total findings: 1'],
      ];

      const findings = [{
        title: findingTitle,
        description: findingDescription,
        severity: riskLevel,
        confidence: pctToConfidence(confidencePct),
        mitreAttack: mitre,
        recommendation: recommendation.join('\n'),
        context: {
          host,
          sourceIp: ip,
          mitreTactic: category,
          mitreTechnique: mitre,
          source: dataSources[0] || '',
          verdict: resolvedVerdict,
          status: 'new',
          confidencePct,
          ...context,
        },
      }];

      return { logs, findings };
    },
  };
}

/**
 * Baut einen ganzen Katalog-Block aus einem Map { key → spec }.
 * Setzt spec.key automatisch (für die Log-Zeile "Hunt Type: …").
 * @param {Record<string, HuntSpec>} specs
 * @returns {Record<string, object>}
 */
function buildHuntTypes(specs) {
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    out[key] = defineHunt({ ...spec, key });
  }
  return out;
}

module.exports = { defineHunt, buildHuntTypes, pctToConfidence };
