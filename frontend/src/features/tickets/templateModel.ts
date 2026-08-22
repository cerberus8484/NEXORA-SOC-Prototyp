// Template-Generator — portiert aus dem Ursprungs-Tool (index.html, openTemplate).
// Erzeugt den Incident-Report im Box-Drawing-ASCII-Format aus dem TicketForm.
// Rein (keine DOM-/API-Zugriffe) → vollständig testbar.

import type { TicketForm } from './TicketEditor';
import { isTiEntryFilled, type TiEntry } from './tiEntry';

const W = 72;            // Innere Breite (ohne die zwei Box-Zeichen │…│)
const LBL_W = 24;
const VAL_W = W - LBL_W - 4; // 4 = "│  " + "  "
const TEXT_W = W - 3;        // Freitext: "│  "-Prefix
const INDENT = `│  ${' '.repeat(LBL_W)}  `;

const PRIO_MAP: Record<string, string> = {
  critical: '⬛ CRITICAL', high: '🔴 HIGH', medium: '🟠 MEDIUM', low: '🟢 LOW', info: '🔵 INFO',
};
const STATUS_MAP: Record<string, string> = {
  assigned: 'ASSIGNED', in_progress: 'IN PROGRESS', on_hold: 'ON HOLD', awaiting_customer: 'AWAITING CUSTOMER',
};
const CLOSE_MAP: Record<string, string> = {
  resolved: 'RESOLVED', false_positive: 'FALSE POSITIVE', duplicate: 'DUPLICATE', benign: 'BENIGN', other: 'OTHER',
};

/** Zeilenumbruch bei max. Breite — Wörter werden nicht getrennt. */
export function wrapLine(text: string, maxW: number): string[] {
  if (text.length <= maxW) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= maxW) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

// ── Box-Bausteine ──────────────────────────────────────────────────────────
const sec = (title: string) => {
  const inner = `─ ${title} `;
  return `\n┌${inner}${'─'.repeat(Math.max(1, W - inner.length))}┐\n`;
};
const secEnd = () => `└${'─'.repeat(W)}┘\n`;
const rowSep = () => `│${'─'.repeat(W)}│\n`;

/** Datenzeile — mehrzeilige + lange Werte werden eingerückt umgebrochen. */
function row(label: string, val?: string): string {
  if (!val || !String(val).trim()) return '';
  const lbl = label.padEnd(LBL_W);
  const allLines: string[] = [];
  String(val).trim().split('\n').forEach((rawLine) => {
    wrapLine(rawLine.trimEnd(), VAL_W).forEach((w) => allLines.push(w));
  });
  const first = `│  ${lbl}  ${allLines[0]}\n`;
  const rest = allLines.slice(1).map((l) => `${INDENT}${l}\n`).join('');
  return first + rest;
}

/** IP + FQDN auf einer Zeile. */
function rowIP(label: string, ip?: string, fqdn?: string): string {
  if (!ip && !fqdn) return '';
  const val = ip && fqdn ? `${ip}  →  ${fqdn}` : (ip || fqdn);
  return row(label, val);
}

/** Freitext-Block mit Rahmen — lange Zeilen werden umgebrochen. */
function textBlock(title: string, val?: string): string {
  if (!val || !val.trim()) return '';
  let out = sec(title);
  val.trim().split('\n').forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line) { out += '│\n'; return; }
    wrapLine(line, TEXT_W).forEach((wrapped) => { out += `│  ${wrapped}\n`; });
  });
  out += secEnd();
  return out;
}

/** Payload-Feld in Anzeigeform (für den Payload-Block, Schritt 2). */
export interface TemplatePayload {
  type: string;
  fields: { label: string; value: string }[];
}

function payloadBlock(payloads: TemplatePayload[]): string {
  const withType = payloads.filter((p) => p.type);
  if (!withType.length) return '';
  let out = sec('PAYLOAD / ARTEFAKTE');
  withType.forEach((p, i) => {
    out += `│\n│  [${String(i + 1).padStart(2, '0')}]  ${p.type.toUpperCase()}\n│\n`;
    p.fields.forEach(({ label, value }) => {
      const val = (value || '').trim();
      if (!val) return;
      const lbl = `       ${label}`.padEnd(28);
      const lines = val.split('\n');
      out += `│${lbl}  ${lines[0]}\n`;
      lines.slice(1).forEach((l) => { out += `│${' '.repeat(30)}${l}\n`; });
    });
    if (i < withType.length - 1) out += `│${'·'.repeat(W)}│\n`;
  });
  out += secEnd();
  return out;
}

export interface TemplateOptions {
  /** Für deterministische Tests injizierbar. */
  now?: Date;
  payloads?: TemplatePayload[];
  tiEntries?: TiEntry[];
}

/** Baut den kompletten Incident-Report aus dem Formular. */
export function generateTemplate(form: TicketForm, opts: TemplateOptions = {}): string {
  const d = form;
  const now = opts.now ?? new Date();
  const ts = d.datetime ? new Date(d.datetime).toLocaleString('de-DE') : '—';
  const created = now.toLocaleString('de-DE');
  const TOTAL = W + 2;

  const prio = PRIO_MAP[d.priority ?? ''] || (d.priority || '').toUpperCase();
  // Zwei-Feld-Modell (ADR-007): CLOSED zeigt den Schließgrund, OPEN den Bearbeitungs-Status.
  const state = (d.state || 'OPEN').toUpperCase();
  const sub = state === 'CLOSED'
    ? CLOSE_MAP[d.closeReason ?? ''] || ''
    : STATUS_MAP[d.status ?? ''] || (d.status || '').toUpperCase();
  const statusLine = sub ? `[ ${state} · ${sub} ]` : `[ ${state} ]`;

  // Freies Notizfeld — immer leer, zum manuellen Ausfüllen nach dem Kopieren.
  const freeField = sec('NOTIZEN / ERGÄNZUNGEN') + '│\n'.repeat(4) + secEnd();

  const netIpRows = rowIP('Source IP', d.srcIp, d.srcFqdn)
    + rowIP('Destination IP', d.dstIp, d.dstFqdn);
  const netDevRows = row('Port(s)', d.port)
    + row('Protokoll', d.protocol)
    + row('VPN / Standort', d.vpn)
    + row('Gerätetyp', d.deviceType);

  // Flache TI-Felder (Alt-Pfad/Rückwärtskompatibilität) + mehrere TI-Einträge (neu).
  const flatTiRows = row('Threat-Kategorie', d.threatCategory)
    + row('Threat Actor', d.threatActor)
    + row('Malware / Familie', d.malware)
    + row('Konfidenz', d.confidence);
  const filledEntries = (opts.tiEntries ?? []).filter(isTiEntryFilled);
  const multi = filledEntries.length > 1;
  const entryTiRows = filledEntries.map((e, i) =>
    (multi ? `│  [ ${String(i + 1).padStart(2, '0')} ]\n` : '')
    + row('Threat-Kategorie', e.category)
    + row('Threat Actor', e.actor)
    + row('Malware / Familie', e.malware)
    + row('Konfidenz', e.confidence),
  ).join('');
  const tiRows = flatTiRows + entryTiRows;

  const tpl = [
    // ── Header ──
    `${'═'.repeat(TOTAL)}\n`,
    '  SOC ANALYST — INCIDENT REPORT\n',
    `  Erstellt: ${created}  |  Analyst: ${d.analyst || '—'}\n`,
    `${'═'.repeat(TOTAL)}\n`,

    // ── 1. Beschreibung ──
    textBlock('BESCHREIBUNG / ANALYSE', d.description),

    // ── 2. Offense ──
    (d.title || d.useCase || d.datetime || d.category || d.ticketNr) ? (
      sec('OFFENSE')
      + row('Ticket-Nr.', d.ticketNr)
      + row('Offense-ID', d.offenseId)
      + row('Kunde / Mandant', d.customer)
      + row('Use Case', d.useCase)
      + row('Offense / Titel', d.title)
      + row('Kategorie / Rule', d.category)
      + row('Zeit (UTC)', d.datetime ? ts : '')
      + row('Priorität', prio)
      + row('Status', statusLine)
      + row('MITRE ATT&CK', d.mitre)
      + secEnd()
    ) : '',

    // ── 3. Freies Notizfeld ──
    freeField,

    // ── 4. Netzwerk & Geräte ──
    (netIpRows || netDevRows) ? (
      sec('NETZWERK & GERÄTE')
      + netIpRows
      + (netIpRows && netDevRows ? rowSep() : '')
      + netDevRows
      + secEnd()
    ) : '',

    // ── 5. Benutzer ──
    (d.user || d.email || d.dept) ? (
      sec('BENUTZER / IDENTITY')
      + row('Username', d.user)
      + row('E-Mail', d.email)
      + row('Abteilung', d.dept)
      + row('Manager', d.manager)
      + row('Benutzertyp', d.userType)
      + row('Account-Status', d.accStatus)
      + secEnd()
    ) : '',

    // ── 6. System & Asset ──
    (d.os || d.assetTag || d.process || d.hash) ? (
      sec('SYSTEM & ASSET')
      + row('OS / Version', d.os)
      + row('Asset-Tag / CMDB', d.assetTag)
      + row('Criticality', d.criticality)
      + row('Prozess / Binary', d.process)
      + row('Hash', d.hash)
      + secEnd()
    ) : '',

    // ── 7. Threat Intel ──
    tiRows ? rowLblSection('THREAT INTEL', tiRows) : '',

    // ── 8. Payloads ──
    payloadBlock(opts.payloads ?? []),

    // ── 9. Freitexte ──
    textBlock('IOCs (INDICATORS OF COMPROMISE)', d.iocs),
    textBlock('LOG-QUELLEN / EVIDENCE', d.logs),
    textBlock('MASSNAHMEN', d.actions),
    textBlock('EMPFEHLUNG / NEXT STEPS', d.recommendation),

    `${'═'.repeat(TOTAL)}\n`,
  ].filter(Boolean).join('');

  return tpl;
}

function rowLblSection(title: string, rows: string): string {
  return sec(title) + rows + secEnd();
}
