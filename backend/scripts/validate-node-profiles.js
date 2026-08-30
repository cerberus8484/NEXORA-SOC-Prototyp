#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_GITOPS_2 — Validate-only CLI für Node-Profile.
//
// Liest deploy/provisioning/nodes/*.yaml, parst (js-yaml) und validiert jedes
// Profil mit dem reinen Validator. **NUR lesen + prüfen** — kein Apply, kein
// Netzwerk, kein Schreiben, kein Backend-Call. Exit 1, wenn ein Profil ungültig
// ist (z. B. gefährliche Felder) → CI kann den PR damit blockieren.
//
// Aufruf:  node backend/scripts/validate-node-profiles.js [<verzeichnis>]
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { validateNodeProfile } = require('../src/provisioning/validateNodeProfile');

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'deploy', 'provisioning', 'nodes');

function main() {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  } catch (e) {
    console.error(`FEHLER: Verzeichnis nicht lesbar: ${dir} (${e.message})`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`FEHLER: keine *.yaml in ${dir}`);
    process.exit(1);
  }

  let bad = 0;
  for (const f of files) {
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.log(`✗ ${f} — YAML-Parse-Fehler: ${e.message}`);
      bad += 1;
      continue;
    }
    const { ok, errors } = validateNodeProfile(doc);
    if (ok) {
      console.log(`✓ ${f} — OK (role: ${doc && doc.node && doc.node.role})`);
    } else {
      console.log(`✗ ${f} — ${errors.length} Fehler:`);
      errors.forEach((msg) => console.log(`    - ${msg}`));
      bad += 1;
    }
  }

  console.log(`\n${files.length - bad}/${files.length} Profile gültig.`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
