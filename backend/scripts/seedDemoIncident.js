'use strict';

// Legt EINEN voll ausgefüllten Demo-Incident an, an dem sich im Analyse-Deck prüfen
// lässt, dass wirklich alle Sektionen mit Daten befüllt werden.
//
// Idempotent: existiert bereits ein Ticket mit offenseId=DEMO-FULL-DECK, wird nichts
// Neues angelegt (die vorhandene Ticket-Nr wird ausgegeben). Läuft in-process über den
// echten TicketService (kein Login/HTTP nötig) — z. B. im Prod-Container:
//     docker exec soc_api_prod node scripts/seedDemoIncident.js
//
// Absolute require-Pfade, damit es auch aus einem beliebigen CWD im Container läuft.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { ticketService } = require(path.join(ROOT, 'src/services/TicketService'));
const { buildDemoIncident, DEMO_MARKER } = require(path.join(ROOT, 'src/domain/demoIncident'));

async function findExisting() {
  // Kleiner Sweep über die jüngsten Tickets nach dem Marker (findAll → { data, total }).
  const res = await ticketService.findAll({ limit: 500 }).catch(() => null);
  const items = (res && res.data) || [];
  return items.find((t) => t && t.offenseId === DEMO_MARKER) || null;
}

async function main() {
  const existing = await findExisting();
  if (existing) {
    process.stdout.write(`BEREITS VORHANDEN: ${existing.ticketNr} (id ${existing.id})\n`);
    return;
  }
  const created = await ticketService.create(buildDemoIncident());
  process.stdout.write(`ANGELEGT: ${created.ticketNr} (id ${created.id})\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { process.stderr.write(`FEHLER: ${err && err.message}\n`); process.exit(1); });
