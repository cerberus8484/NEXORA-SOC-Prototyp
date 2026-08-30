'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 2 — honeypot_session (Aggregation je sessionId)
//
// Reines Aggregations-Modul (keine Fetches, keine DB, keine API). Nimmt rohe
// Cowrie-_source-Events und baut EIN Session-Objekt pro `data.session` —
// Login-Status, Commands, Downloads und Client-Fingerprint.
//
// Ergänzt den flowNormalizer (Slice 1): der Flow ist EINE Verbindung, die Session
// fasst den GESAMTEN Sitzungsinhalt zusammen (mehrere Events). Beide tragen
// dieselbe `sessionId` → eindeutige Verknüpfung (`relatedFlowSessionId`).
//
// Feste Regeln (Datensparsamkeit / ADR-009 — nichts erfinden):
//  - Passwörter NIE im Klartext: nur `passwordObserved` + `passwordAttempts`.
//  - Usernamen nur, wenn im Event vorhanden (deduped, bounded).
//  - Commands bounded (Anzahl + Länge), mit Timestamp + truncated-Flag.
//  - Downloads nur mit real vorhandenen Feldern (url/filename/hash).
//  - Kein Geo/ASN/Reputation/NAT/TLS — Cowrie liefert das nicht.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_COMMANDS = 200;
const DEFAULT_MAX_COMMAND_LEN = 2000;
const MAX_USERNAMES = 100;
const MAX_DOWNLOADS = 100;

const COMMAND_EVENTS = new Set(['cowrie.command.input', 'cowrie.command.failed']);
const FINGERPRINT_EVENTS = new Set(['cowrie.client.version', 'cowrie.client.kex', 'cowrie.client.fingerprint']);

function s(v) {
  if (v === undefined || v === null) return undefined;
  const str = String(v);
  return str === '' ? undefined : str;
}
function port(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function setIfEmpty(obj, key, val) {
  if (val !== undefined && (obj[key] === null || obj[key] === undefined)) obj[key] = val;
}
function truncate(value, maxLen) {
  return value.length > maxLen ? { value: value.slice(0, maxLen), truncated: true } : { value, truncated: false };
}

function isHoneypotSessionEvent(src = {}) {
  const eid = src && src.data && src.data.eventid;
  return typeof eid === 'string' && eid.startsWith('cowrie.');
}

function newSession(sessionId) {
  return {
    sessionId,
    sensor: null, service: null,
    sourceIp: null, sourcePort: null, destinationIp: null, destinationPort: null,
    firstSeen: null, lastSeen: null, durationMs: null,
    loginAttempts: 0, loginSucceeded: 0, loginFailed: 0, authSuccess: null,
    usernames: [], usernamesTruncated: false,
    passwordObserved: false, passwordAttempts: 0,
    commands: [], commandCount: 0, commandsTruncated: false,
    downloads: [],
    fingerprint: {},
    relatedFlowSessionId: sessionId,
    __usernames: new Set(),
  };
}

function applyTime(session, d) {
  const ts = s(d.timestamp);
  if (!ts) return;
  if (!session.firstSeen || ts < session.firstSeen) session.firstSeen = ts;
  if (!session.lastSeen || ts > session.lastSeen) session.lastSeen = ts;
}

function applyLogin(session, d) {
  const u = s(d.username);
  if (u) session.__usernames.add(u);
  // Eine Login-Zeile IST ein Passwort-Versuch, wenn das Feld vorhanden ist —
  // der Wert wird bewusst NICHT übernommen (kein Klartext).
  if (Object.prototype.hasOwnProperty.call(d, 'password')) {
    session.passwordObserved = true;
    session.passwordAttempts += 1;
  }
}

function applyCommand(session, d, maxCommands, maxCommandLen) {
  const cmd = s(d.input);
  if (cmd === undefined) return;
  session.commandCount += 1;
  if (session.commands.length >= maxCommands) return; // Liste bounded; Zähler bleibt vollständig
  const { value, truncated } = truncate(cmd, maxCommandLen);
  const entry = { timestamp: s(d.timestamp) || null, command: value };
  if (truncated) entry.truncated = true;
  session.commands.push(entry);
}

function applyDownload(session, d) {
  const url = s(d.url);
  const filename = s(d.outfile) || s(d.destfile) || s(d.filename);
  const hash = s(d.shasum);
  if (!url && !filename && !hash) return;            // kein leerer Eintrag
  if (session.downloads.length >= MAX_DOWNLOADS) return;
  const entry = {};
  if (url) entry.url = url;
  if (filename) entry.filename = filename;
  if (hash) entry.hash = hash;
  session.downloads.push(entry);
}

function applyEvent(session, eid, d, maxCommands, maxCommandLen) {
  applyTime(session, d);
  setIfEmpty(session, 'sensor', s(d.sensor));
  setIfEmpty(session, 'service', s(d.protocol));     // ssh/telnet (aus connect)
  setIfEmpty(session, 'sourceIp', s(d.src_ip));
  setIfEmpty(session, 'sourcePort', port(d.src_port));
  setIfEmpty(session, 'destinationIp', s(d.dst_ip)); // ehrliche interne Post-DNAT-Sicht
  setIfEmpty(session, 'destinationPort', port(d.dst_port));

  if (eid === 'cowrie.login.success') { session.loginSucceeded += 1; applyLogin(session, d); return; }
  if (eid === 'cowrie.login.failed')  { session.loginFailed += 1; applyLogin(session, d); return; }
  if (COMMAND_EVENTS.has(eid))        { applyCommand(session, d, maxCommands, maxCommandLen); return; }
  if (eid === 'cowrie.session.file_download') { applyDownload(session, d); return; }
  if (FINGERPRINT_EVENTS.has(eid)) {
    setIfEmpty(session.fingerprint, 'hassh', s(d.hassh));
    setIfEmpty(session.fingerprint, 'version', s(d.version));
    return;
  }
  if (eid === 'cowrie.session.closed') {
    const dur = Number(d.duration);
    if (d.duration !== undefined && d.duration !== null && d.duration !== '' && Number.isFinite(dur)) {
      session.durationMs = Math.round(dur * 1000);
    }
  }
}

function finalize(session) {
  session.loginAttempts = session.loginSucceeded + session.loginFailed;
  session.authSuccess = session.loginSucceeded > 0
    ? true
    : (session.loginAttempts > 0 ? false : null);
  const names = [...session.__usernames];
  session.usernames = names.slice(0, MAX_USERNAMES);
  session.usernamesTruncated = names.length > MAX_USERNAMES;
  session.commandsTruncated = session.commandCount > session.commands.length;
  delete session.__usernames;
  return session;
}

/**
 * Cowrie-Events zu honeypot_session-Objekten aggregieren (eines je sessionId).
 * @param {object[]} rawSources  rohe _source-Objekte (gemischt; Nicht-Cowrie wird ignoriert)
 * @param {{ maxCommands?: number, maxCommandLen?: number }} [opts]
 * @returns {object[]}  Sessions, sortiert nach firstSeen (aufsteigend)
 */
function aggregateHoneypotSessions(rawSources = [], opts = {}) {
  const maxCommands = Number.isFinite(opts.maxCommands) ? opts.maxCommands : DEFAULT_MAX_COMMANDS;
  const maxCommandLen = Number.isFinite(opts.maxCommandLen) ? opts.maxCommandLen : DEFAULT_MAX_COMMAND_LEN;
  const list = Array.isArray(rawSources) ? rawSources : [];
  const sessions = new Map();

  for (const src of list) {
    const d = (src && src.data) || {};
    const eid = d.eventid;
    if (typeof eid !== 'string' || !eid.startsWith('cowrie.')) continue;
    const sid = s(d.session);
    if (!sid) continue; // ohne Session-Key keine Aggregation
    let session = sessions.get(sid);
    if (!session) { session = newSession(sid); sessions.set(sid, session); }
    applyEvent(session, eid, d, maxCommands, maxCommandLen);
  }

  return [...sessions.values()]
    .map(finalize)
    .sort((a, b) => String(a.firstSeen || '').localeCompare(String(b.firstSeen || '')));
}

module.exports = {
  aggregateHoneypotSessions,
  isHoneypotSessionEvent,
  DEFAULT_MAX_COMMANDS,
  DEFAULT_MAX_COMMAND_LEN,
};
