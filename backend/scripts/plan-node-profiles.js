#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_GITOPS_3 — Validate + Plan CLI (read-only).
//
// Liest deploy/provisioning/nodes/*.yaml, validiert (P_GITOPS_2) und erzeugt
// einen Markdown-Plan/Preview (für PR-Kommentar / Step-Summary). **Kein Apply,
// kein Netzwerk, kein Backend-Call, kein Installer.** Exit 1, wenn ein Profil
// ungültig ist (CI rot); sonst 0. Der Plan sagt explizit: bootstrap-only.
//
// Aufruf:  node backend/scripts/plan-node-profiles.js [<verzeichnis>]
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { validateNodeProfile } = require('../src/provisioning/validateNodeProfile');
const { renderPlanMarkdown } = require('../src/provisioning/planNodeProfile');

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'deploy', 'provisioning', 'nodes');

function main() {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  } catch (e) {
    console.log(`## Nexora Provisioning Plan\n\n_Verzeichnis nicht lesbar: ${dir} (${e.message})_`);
    process.exit(1);
  }

  const out = ['## Nexora Provisioning Plan', ''];
  if (files.length === 0) {
    out.push('_Keine Node-Profile in diesem PR._');
    console.log(out.join('\n'));
    process.exit(0); // kein Profil zu prüfen ist kein Fehler
  }

  let bad = 0;
  for (const f of files) {
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      out.push(`### ❌ ${f} — YAML-Parse-Fehler`, '', `\`${e.message}\``, '');
      bad += 1;
      continue;
    }
    const { ok, errors } = validateNodeProfile(doc);
    if (!ok) {
      out.push(`### ❌ ${f} — ungültig (${errors.length})`, '', ...errors.map((msg) => `- ${msg}`), '');
      bad += 1;
    } else {
      out.push(renderPlanMarkdown(doc), '');
    }
  }

  out.push('---');
  out.push(bad === 0
    ? `✅ ${files.length}/${files.length} Profile gültig — **bootstrap-only, keine Netzwerkänderung.**`
    : `❌ ${bad} ungültige(s) Profil(e) — CI blockiert (Merge erst nach Fix).`);

  console.log(out.join('\n'));
  process.exit(bad === 0 ? 0 : 1);
}

main();
