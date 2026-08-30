'use strict';

const { Router }         = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { wazuhApiClient } = require('../integrations/adapters/wazuh/wazuhApiInstance');
// Shared singleton aus useCaseDeveloperInstance — damit Route + Service dasselbe
// InMemory-Repo nutzen (im InMemory-Modus wichtig, damit Daten sichtbar sind).
const { publishedDetectionRepo } = require('../services/useCaseDeveloperInstance');

const router = Router();

// Eigener Bereich für Analyst-erstellte Custom-Regeln (nie in Kollision mit FP-Range 900000+).
const CUSTOM_MIN = 100500;
const CUSTOM_MAX = 109999;
const CUSTOM_FILE = 'nexora-custom-detections.xml';
const CUSTOM_GROUP_OPEN = '<group name="nexora_custom,">';
const CUSTOM_GROUP_CLOSE = '</group>';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseIds(xml) {
  return [...String(xml).matchAll(/<rule\s+id="(\d+)"/g)].map((m) => Number(m[1]));
}

function allocateId(xml) {
  const used = new Set(parseIds(xml));
  for (let i = CUSTOM_MIN; i <= CUSTOM_MAX; i++) {
    if (!used.has(i)) return i;
  }
  throw new Error('Keine freie Rule-ID im Custom-Bereich — Limit erreicht.');
}

function insertRule(xml, ruleEl) {
  const src = String(xml || '');
  if (!src.includes(CUSTOM_GROUP_OPEN)) {
    return `${CUSTOM_GROUP_OPEN}\n${ruleEl}\n${CUSTOM_GROUP_CLOSE}\n`;
  }
  const idx = src.lastIndexOf(`\n${CUSTOM_GROUP_CLOSE}`);
  if (idx === -1) return `${CUSTOM_GROUP_OPEN}\n${ruleEl}\n${CUSTOM_GROUP_CLOSE}\n`;
  return `${src.slice(0, idx)}\n${ruleEl}${src.slice(idx)}`;
}

function buildRuleXml({ id, level, description, fieldName, fieldType, fieldValue, ifSid, groups, author }) {
  const lines = [`  <rule id="${id}" level="${level}">`];
  if (ifSid) lines.push(`    <if_sid>${esc(ifSid)}</if_sid>`);
  if (fieldName && fieldValue) {
    lines.push(`    <field name="${esc(fieldName)}" type="${fieldType === 'regex' ? 'pcre2' : 'osmatch'}">${esc(fieldValue)}</field>`);
  }
  lines.push(`    <description>${esc(description)}</description>`);
  const grp = ['nexora_custom', ...(groups || [])].filter(Boolean).join(',') + ',';
  lines.push(`    <group>${esc(grp)}</group>`);
  if (author) lines.push(`    <!-- author: ${esc(author)} -->`);
  lines.push('  </rule>');
  return lines.join('\n');
}

// GET /api/v1/detections/published — Detection-Library-Einträge aus UCD-Publish
// Literal-Pfad vor dynamischen Routen — kein Konflikt mit '/' oder '/custom'.
router.get('/published', requireAuth, async (req, res, next) => {
  try {
    const limit  = Math.max(1, Math.min(200, Number(req.query.limit)  || 50));
    const offset = Math.max(0,              Number(req.query.offset) || 0);
    const result = await publishedDetectionRepo.findAll({ limit, offset });
    res.json({ data: result.data, total: result.total, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/detections?search=&group=&level=&limit=&offset=
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: [], total: 0, requestId: req.id });
    }
    const { search = '', group = '', level = '', limit = 100, offset = 0 } = req.query;
    const r = await wazuhApiClient.listRules({ search, group, level, limit, offset });
    res.json({ enabled: true, data: r.items, total: r.total, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/detections/custom — Neue Custom-Wazuh-Regel schreiben (analyst+)
router.post('/custom', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.status(503).json({ error: 'Wazuh-API nicht konfiguriert — Regel kann nicht gespeichert werden.' });
    }

    const { description, level, fieldName, fieldType, fieldValue, ifSid, groups, author } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Beschreibung ist Pflicht.' });
    }
    const lvl = Number(level);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 15) {
      return res.status(400).json({ error: 'Level muss zwischen 1 und 15 liegen.' });
    }
    if (!fieldName || !fieldValue) {
      return res.status(400).json({ error: 'Feld-Name und Feld-Wert sind Pflicht.' });
    }

    // Existierende Datei lesen (falls vorhanden)
    let existingXml = '';
    try {
      existingXml = await wazuhApiClient.getRuleFile(CUSTOM_FILE);
    } catch (_) { /* Datei existiert noch nicht — wird neu erstellt */ }

    const newId = allocateId(existingXml);
    const ruleEl = buildRuleXml({ id: newId, level: lvl, description: description.trim(), fieldName, fieldType: fieldType || 'regex', fieldValue, ifSid, groups, author: author || req.user?.email });
    const newXml = insertRule(existingXml, ruleEl);

    await wazuhApiClient.putRuleFile(CUSTOM_FILE, newXml);

    res.status(201).json({ ruleId: newId, file: CUSTOM_FILE, xml: ruleEl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
