'use strict';

const crypto = require('crypto');

// Erzeugt + verwaltet SCOPED Wazuh-False-Positive-Ausnahmen (Level 0) als XML — rein, ohne Netz.
// Guardrails verhindern gefährliche globale Ausnahmen. Datei-Helfer (parse/allocate/insert/remove)
// werden in Stage 4 vom Service genutzt; Generierung bleibt EINE Quelle der Wahrheit (Preview == Write).

// FP-Exception-IDs liegen bewusst HOCH (900000–920000), damit sie NICHT mit
// Hunt-/Detection-Rulesets (typisch 100000+) kollidieren. Eigener, reservierter Range.
const MIN_ID = 900000;
const MAX_ID = 920000;
const GROUP_FILE = 'soc_fp_exceptions.xml';
const GROUP_OPEN = '<group name="soc_fp_exceptions,">';
const GROUP_CLOSE = '</group>';

const IP_OR_CIDR = /^(\d{1,3})(\.\d{1,3}){3}(\/(3[0-2]|[12]?\d))?$/;
function validIp(s) {
  if (!IP_OR_CIDR.test(s)) return false;
  return s.split('/')[0].split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
}
// Multicast 224.0.0.0/4 (erstes Oktett 224–239) — auch für CIDR (224.0.0.0/24).
function isMulticast(s) {
  const o = Number(String(s).split('/')[0].split('.')[0]);
  return o >= 224 && o <= 239;
}
// Limited Broadcast (255.255.255.255) + Directed Broadcast (…​.255).
function isBroadcast(s) {
  const ip = String(s).split('/')[0];
  return ip === '255.255.255.255' || /\.255$/.test(ip);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const clean = (v) => String(v == null ? '' : v).trim();
const list  = (v) => (Array.isArray(v) ? v : [v]).map(clean).filter(Boolean);

// ── Scope-Normalisierung + stabiler Hash (für Idempotenz) ─────────────────
function normalizeScope(scope = {}) {
  return {
    ruleId:    clean(scope.ruleId),
    srcips:    [...new Set(list(scope.srcips))].sort(),
    dstips:    [...new Set(list(scope.dstips))].sort(),
    dstports:  [...new Set(list(scope.dstports))].sort(),
    protocol:  clean(scope.protocol).toUpperCase(),
    agentId:   clean(scope.agentId),
    agentName: clean(scope.agentName),
  };
}
function scopeHash(scope = {}) {
  return crypto.createHash('sha1').update(JSON.stringify(normalizeScope(scope))).digest('hex').slice(0, 16);
}

// ── Validierung (Guardrails) ──────────────────────────────────────────────
function validateScope(scope = {}, newId) {
  const n = normalizeScope(scope);
  const errors = [];
  const warnings = [];
  const hasNetScope   = n.srcips.length > 0 || n.dstips.length > 0;
  const hasAgentScope = !!(n.agentId || n.agentName);
  if (!n.ruleId) errors.push('Parent-Rule-ID (if_sid) fehlt.');
  // Host-basierte Alerts (ClamAV/FIM/Windows-Events) haben keine Netz-IPs —
  // dort ist der Agent das einschränkende Kriterium. if_sid-only bleibt verboten.
  if (!hasNetScope && !hasAgentScope) {
    errors.push('Mindestens ein einschränkendes Scope-Kriterium ist Pflicht: srcip, dstip oder Agent (keine globale Ausnahme).');
  }
  // Quell-agnostisch (nur dstip, keine srcip): nur erlaubt, wenn ALLE Ziele
  // Multicast/Broadcast sind ODER ein Port das Scope einengt — sonst würde die
  // Eltern-Regel für JEDE Quelle zu diesem Ziel stummgeschaltet.
  const sourceAgnostic = n.srcips.length === 0 && n.dstips.length > 0;
  if (sourceAgnostic) {
    const allSpecial = n.dstips.every((ip) => isMulticast(ip) || isBroadcast(ip));
    if (!allSpecial && n.dstports.length === 0) {
      errors.push('Quell-agnostische Ausnahme (ohne Source) nur für Multicast/Broadcast-Ziele oder mit Destination-Port erlaubt — sonst würde die Regel für jede Quelle stummgeschaltet.');
    }
  }
  if (!clean(scope.reason)) errors.push('Begründung (reason) ist Pflicht.');
  [...n.srcips, ...n.dstips].forEach((ip) => { if (!validIp(ip)) errors.push(`Ungültige IP/CIDR: ${ip}`); });
  n.dstports.forEach((p) => { if (!/^\d{1,5}$/.test(p)) errors.push(`Ungültiger Port: ${p}`); });
  if (newId != null && (!Number.isInteger(newId) || newId < MIN_ID || newId > MAX_ID)) {
    errors.push(`Rule-ID muss im Bereich ${MIN_ID}–${MAX_ID} liegen (Wazuh-Custom-Range).`);
  }
  if (n.protocol || n.dstports.length) {
    warnings.push('Protokoll-/Port-Matching hängt vom Decoder-Feldnamen ab — vor dem Anwenden verifizieren.');
  }
  if (!hasNetScope && hasAgentScope) {
    warnings.push(n.agentName
      ? `Agent-Scope via <hostname>${n.agentName}</hostname> — Matching vor dem Anwenden mit wazuh-logtest verifizieren.`
      : 'Agent-scoped host alert preview requires syntax verification before apply — Agent-Name fehlt, es kann kein <hostname>-Selector erzeugt werden.');
  }
  return { errors, warnings, normalized: n };
}

// ── Einzelnes <rule>-Element (Marker trägt scopeHash für Idempotenz/Revert) ──
function buildRuleElement(scope, newRuleId, hash) {
  const n = normalizeScope(scope);
  const reason = clean(scope.reason);
  const h = hash || scopeHash(scope);
  const idPart = scope.ticketId ? ` (Ticket ${clean(scope.ticketId)}${scope.analyst ? `, ${clean(scope.analyst)}` : ''})` : '';
  const scopeParts = [];
  if (n.srcips.length || n.dstips.length) scopeParts.push(`${n.srcips.join(',') || '*'} -> ${n.dstips.join(',') || '*'}`);
  if (n.agentId || n.agentName) scopeParts.push(`agent ${[n.agentId, n.agentName].filter(Boolean).join('/')}`);
  const desc = `SOC-FP: rule ${n.ruleId} scoped ${scopeParts.join(' · ')}${idPart}: ${reason} [soc-fp scope=${h}]`;

  const L = [`  <rule id="${newRuleId}" level="0">`];
  L.push(`    <if_sid>${esc(n.ruleId)}</if_sid>`);
  if (n.srcips.length) L.push(`    <srcip>${esc(n.srcips.join(','))}</srcip>`);
  if (n.dstips.length) L.push(`    <dstip>${esc(n.dstips.join(','))}</dstip>`);
  // Agent-Scope: <hostname> matcht bei Agent-Events den Agent-Namen (OS_Match).
  // Nur die Agent-ID reicht NICHT für einen Selector — dann bleibt das Element
  // bewusst ohne hostname und buildFpException markiert es als applyBlocked.
  if (n.agentName) L.push(`    <hostname>${esc(n.agentName)}</hostname>`);
  if (n.dstports.length) L.push(`    <dstport>${esc(n.dstports.join('|'))}</dstport>`);
  if (n.protocol)        L.push(`    <field name="protocol">${esc(n.protocol)}</field>`);
  L.push(`    <description>${esc(desc)}</description>`);
  L.push('    <group>soc_false_positive,</group>');
  L.push('  </rule>');
  return L.join('\n');
}

// Hat das Rule-Element mindestens einen echten Einschränkungs-Selector?
// (Schutz davor, eine if_sid-only-Regel zu schreiben = globales Rule-Disable.)
function ruleElementHasSelector(ruleXml = '') {
  return /<(srcip|dstip|hostname)>/.test(String(ruleXml));
}

// ── Datei-Operationen (rein) ──────────────────────────────────────────────
function wrapFile(ruleElements = []) {
  return [GROUP_OPEN, ...ruleElements, GROUP_CLOSE].join('\n') + '\n';
}
function parseRuleIds(xml = '') {
  return [...String(xml).matchAll(/<rule\s+id="(\d+)"/g)].map((m) => Number(m[1]));
}
function allocateRuleId(xml = '') {
  const used = new Set(parseRuleIds(xml));
  for (let i = MIN_ID; i <= MAX_ID; i += 1) { if (!used.has(i)) return i; }
  throw new Error(`Keine freie Rule-ID im Bereich ${MIN_ID}–${MAX_ID} (erschöpft).`);
}
// Liefert den kompletten <rule …>…</rule>-Block einer ID oder null.
function findRuleById(xml = '', id) {
  const re = new RegExp(`[ \\t]*<rule\\s+id="${Number(id)}"[\\s\\S]*?</rule>`, 'm');
  const m = re.exec(String(xml));
  return m ? m[0] : null;
}
// Liefert die Rule-ID, deren Block den scopeHash trägt — sonst null (Idempotenz über Datei).
function findRuleByScope(xml = '', scope = {}) {
  const h = scopeHash(scope);
  const re = /[ \t]*<rule\s+id="(\d+)"[\s\S]*?<\/rule>/g;
  let m;
  while ((m = re.exec(String(xml))) !== null) {
    if (m[0].includes(`scope=${h}`)) return Number(m[1]);
  }
  return null;
}
// Fügt ein Rule-Element in die verwaltete Gruppe ein (vor dem schließenden </group>).
function insertRule(xml = '', ruleElement = '') {
  const src = String(xml || '');
  if (!src.includes(GROUP_OPEN)) return wrapFile([ruleElement]);
  const idx = src.lastIndexOf(`\n${GROUP_CLOSE}`);
  if (idx === -1) return wrapFile([ruleElement]); // malformed → sauber neu wrappen
  return `${src.slice(0, idx)}\n${ruleElement}${src.slice(idx)}`;
}
// Entfernt genau den Block einer ID; leere Gruppe bleibt erhalten (harmlos).
function removeRuleById(xml = '', id) {
  const block = findRuleById(xml, id);
  if (!block) return String(xml);
  return String(xml).replace(block, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Erzeugt eine scoped FP-Ausnahme als komplette Datei-XML (Vorschau == späterer Write).
 * @returns {{ ok, errors[], warnings[], xml, ruleId, file, scopeHash }}
 */
function buildFpException(scope = {}) {
  const newId = Number(scope.newRuleId) || MIN_ID + 100;
  const { errors, warnings } = validateScope(scope, newId);
  if (errors.length) return { ok: false, errors, warnings, xml: '', ruleId: newId, file: GROUP_FILE, scopeHash: scopeHash(scope), applyBlocked: true };
  const h = scopeHash(scope);
  const ruleEl = buildRuleElement(scope, newId, h);
  // Agent-only ohne Agent-Namen: Vorschau ja, Apply nein — das Element hätte
  // keinen Selector und würde die Eltern-Regel GLOBAL abschalten.
  const applyBlocked = !ruleElementHasSelector(ruleEl);
  const xml = wrapFile([ruleEl]);
  return { ok: true, errors: [], warnings, xml, ruleId: newId, file: GROUP_FILE, scopeHash: h, applyBlocked };
}

// Empfiehlt das Ausnahme-Ziel anhand der Rule-Details (aus WazuhApiClient.getRuleDetail).
// Frequency-/Korrelations-Regeln (z.B. 87702 "Multiple blocks", if_matched_sid 87701)
// sollten auf der BASIS-Regel gescoped werden — sonst aggregiert das Rauschen weiter,
// bevor die Ausnahme greift. Rein, ohne Netz.
function recommendExceptionTarget(detail) {
  if (!detail) return { isFrequencyRule: false, baseRuleId: null, recommendedIfSid: null };
  const baseRuleId = detail.ifMatchedSid ? String(detail.ifMatchedSid) : null;
  const isFrequencyRule = !!baseRuleId || (detail.frequency != null && Number(detail.frequency) > 0);
  return {
    isFrequencyRule,
    baseRuleId,
    recommendedIfSid: baseRuleId || (detail.id != null ? String(detail.id) : null),
  };
}

// Vorbefüllung aus normalisierter Evidence (siehe wazuhEvidenceNormalizer).
function scopeFromEvidence(ev = {}, ticket = {}) {
  const dstIp = ev.destination?.ip || '';
  const isMulticast = /^(22[4-9]|23\d)\./.test(dstIp); // 224.0.0.0/4
  return {
    ruleId: ev.detection?.ruleId || '',
    srcips: ev.source?.ip ? [ev.source.ip] : [],
    dstips: dstIp ? [dstIp] : [],
    dstipSuggestion: dstIp.startsWith('224.0.0.') ? '224.0.0.0/24' : (isMulticast ? '224.0.0.0/4' : ''),
    dstports: ev.destination?.port ? [String(ev.destination.port)] : [],
    protocol: ev.network?.protocol || '',
    agentId: ev.metadata?.agentId || '',
    agentName: ev.metadata?.agentName || '',
    ticketId: ticket.ticketNr || ticket.id || '',
  };
}

module.exports = {
  buildFpException, buildRuleElement, ruleElementHasSelector, scopeFromEvidence, recommendExceptionTarget, validateScope, validIp,
  normalizeScope, scopeHash, wrapFile, parseRuleIds, allocateRuleId,
  findRuleById, findRuleByScope, insertRule, removeRuleById,
  MIN_ID, MAX_ID, GROUP_FILE,
};
