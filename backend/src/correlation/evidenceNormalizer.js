'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Evidence-Normalizer-Registry (Correlation Engine, CE-1)
//
// Dispatcht ein Ticket je nach `source` auf den passenden Normalizer und
// liefert immer eine ParsedEvidence-Struktur (gleiche Form wie das Frontend-
// Modell). Damit zeigen ALLE Quellen — nicht nur Wazuh — strukturierte
// Forensik-Felder im Analyse-Deck. Quellen ohne eigenen Rich-Normalizer
// nutzen den generischen Pfad über die flachen Ticketfelder.
//
// Rein (keine Seiteneffekte) → gut testbar. ADR-009: fehlende Quelle = leeres
// Feld (undefined), keine Fake-Daten.
// ─────────────────────────────────────────────────────────────────────────

const { normalizeWazuhEvidence } = require('../integrations/adapters/wazuh/wazuhEvidenceNormalizer');

const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const SOURCE_LABEL = { wazuh: 'Wazuh', qradar: 'QRadar', splunk: 'Splunk', email: 'E-Mail', manual: 'Manuell' };

const str = (v) => (v == null || v === '' ? undefined : String(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

// Roh-Hash in das `algo=wert`-Format bringen, das die Evidence-Cards erwarten
// (identisch zum Frontend-Fallback, damit beide Wege dasselbe zeigen).
function toHashes(hash) {
  const h = str(hash);
  if (!h) return undefined;
  if (h.includes('=')) return h;                       // bereits „sha256=…"
  if (/^[a-f0-9]{64}$/i.test(h)) return `sha256=${h}`;
  if (/^[a-f0-9]{40}$/i.test(h)) return `sha1=${h}`;
  if (/^[a-f0-9]{32}$/i.test(h)) return `md5=${h}`;
  return `hash=${h}`;
}

// Typisierte Ticket-Payloads (der Data-Plane-Korrelator und der Editor liefern sie):
// Befehle und Logins sind echte Artefakte und gehören in die Evidence.
// Tunnel/Download bleiben bewusst ungemappt — die Payloads-Ansicht rendert sie
// bereits direkt aus `ticket.payloads` (sessionActivityModel); doppelt wäre redundant.
function payloadArtifacts(payloads) {
  const list = Array.isArray(payloads) ? payloads : [];
  const kindOf = (p) => (p && typeof p === 'object' && p.fields ? str(p.fields.kind) : undefined);
  const commands = list.filter((p) => p && typeof p === 'object'
    && (p.type === 'Command' || kindOf(p) === 'command') && Boolean(str(p.raw)));
  const login = list.find((p) => kindOf(p) === 'login' && p.fields && str(p.fields.user));
  return { commands, loginUser: login ? str(login.fields.user) : undefined };
}

// payload.contains* ehrlich BESTIMMEN statt vier fest verdrahtete 'unknown' zu
// behaupten. Ohne prüfbaren Text bleibt es bei 'unknown' — das ist dann die Wahrheit.
const UNKNOWN_FLAGS = {
  containsCredentials: 'unknown', containsToken: 'unknown',
  containsScript: 'unknown', containsBase64: 'unknown',
};
function detectPayloadFlags(text) {
  const t = str(text);
  if (!t) return { ...UNKNOWN_FLAGS };
  return {
    containsCredentials: /pass(word|wd)\s*[=:]|credential|secret\s*[=:]/i.test(t),
    containsToken:       /bearer\s+\S|token\s*[=:]|eyJ[A-Za-z0-9_-]{8,}|api[_-]?key\s*[=:]/i.test(t),
    containsScript:      /powershell|cmd\.exe|\/bin\/(ba|z|k)?sh|python[0-9.]*\s|<script|wget\s|curl\s/i.test(t),
    containsBase64:      /[A-Za-z0-9+/]{40,}={0,2}/.test(t),
  };
}

// Flow-/Netzwerk-Statistik aus den flachen Ticketfeldern. GETEILT: der generische UND
// der Wazuh-Fallback nutzen dieselbe Zuordnung, damit die „Flow Statistics"- und
// „Communication Map"-Sektionen für JEDE Quelle befüllt werden (Pakete, Firewall-Action,
// Event-Zahl, beobachtetes Zeitfenster, Dauer). Fehlt ein Feld → undefined (ADR-009).
function flatNetwork(ticket = {}) {
  const firstSeen = str(ticket.firstSeen);
  const lastSeen  = str(ticket.lastSeen);
  const a = firstSeen ? Date.parse(firstSeen) : NaN;
  const b = lastSeen ? Date.parse(lastSeen) : NaN;
  const durationMs = Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : undefined;
  return {
    protocol:        str(ticket.protocol),
    action:          str(ticket.firewallAction),   // block/pass/permitted/denied
    bytesSent:       num(ticket.bytesSent),
    bytesReceived:   num(ticket.bytesRecv),
    packetsSent:     num(ticket.pktsSent),
    packetsReceived: num(ticket.pktsRecv),
    eventCount:      num(ticket.eventCount),
    firstSeen,
    lastSeen,
    durationMs,
  };
}

// Generischer Normalizer: nur flache Ticketfelder (jede Quelle befüllt sie).
// Reicht, damit Splunk/QRadar/E-Mail-Tickets Source/Destination/Network zeigen.
function normalizeGenericEvidence(ticket = {}) {
  // Prozess-Evidence aus zwei Quellen: den flachen Ticketfeldern (die der
  // Frontend-Fallback längst liest — sonst zeigt die Anzeige mehr als die
  // maßgebliche Evidence) UND den typisierten Payload-Artefakten.
  // Explizit gesetzte Felder haben Vorrang vor abgeleiteten.
  const { commands, loginUser } = payloadArtifacts(ticket.payloads);
  const image       = str(ticket.process);
  const commandLine = str(ticket.commandLine) || (commands[0] ? str(commands[0].raw) : undefined);
  const hashes      = toHashes(ticket.hash);
  const user        = str(ticket.user) || loginUser;

  const process = (image || commandLine) ? {
    image,
    commandLine,
    user,
    hashes,
    // Ehrlichkeit: ParsedEvidence trägt EINEN Prozess. Kamen mehrere Befehle,
    // führt der erste — die echte Anzahl bleibt sichtbar, damit niemand
    // „ein Befehl" liest, wo mehrere abgesetzt wurden.
    ...(commands.length > 1 ? { commandCount: commands.length } : {}),
    ...(commands.length === 1 && !str(ticket.commandLine) ? { commandCount: 1 } : {}),
  } : undefined;

  // Hash ohne Prozess = Datei-Artefakt (kein Doppeleintrag).
  const file = (hashes && !process) ? { hashes } : undefined;

  // Prüfbarer Text für die Payload-Merkmale: alles, was wir real vorliegen haben.
  const inspectable = [commandLine, str(ticket.logs), ...commands.map((c) => str(c.raw))]
    .filter(Boolean).join('\n') || undefined;

  return {
    id: ticket.id || '',
    type: process ? 'process' : 'network',
    detection: {
      sourceSystem: SOURCE_LABEL[ticket.source] || str(ticket.source) || 'Manuell',
      ruleId:    str(ticket.offenseId),
      ruleName:  str(ticket.title),
      severity:  SEV_LABEL[ticket.priority] || undefined,
      timestamp: str(ticket.datetime) || str(ticket.createdAt),
      status:    str(ticket.status),
      description: str(ticket.description),
    },
    source: {
      host:       str(ticket.hostname),
      user,                                  // flaches Feld, sonst aus dem Login-Payload
      ip:         str(ticket.srcIp),
      port:       num(ticket.port),
      zone:       str(ticket.network),
      interface:  undefined,
      macAddress: str(ticket.mac),
    },
    destination: {
      // dstIp hat Vorrang; sonst der externe/Angreifer-Kontakt (Perimeter-/Honeypot-Tickets
      // tragen das Ziel oft in extIp/attackerIp statt dstIp).
      ip:   str(ticket.dstIp) || str(ticket.extIp) || str(ticket.attackerIp),
      port: undefined,
      fqdn: str(ticket.dstFqdn) || str(ticket.extFqdn),
      sni: undefined, httpHost: undefined, country: undefined,
      asn: undefined, organization: undefined, reputation: undefined,
    },
    nat: {
      originalSourceIp:      str(ticket.srcIp),
      originalDestinationIp: str(ticket.dstIp),
      postNatSourceIp:       str(ticket.postNatSrc),
      postNatDestinationIp:  str(ticket.postNatDst),
    },
    network: flatNetwork(ticket),
    payload: detectPayloadFlags(inspectable),
    metadata: {
      mitreTechnique: str(ticket.mitre),
      logSource:      str(ticket.category),
      agentName:      str(ticket.hostname),
    },
    ...(process ? { process } : {}),
    ...(file ? { file } : {}),
    // Beobachtetes Flow-Fenster bevorzugen (echte Ereigniszeit); sonst Ticket-Lebenszeit.
    firstSeen: str(ticket.firstSeen) || str(ticket.createdAt),
    lastSeen:  str(ticket.lastSeen) || str(ticket.updatedAt),
    // Roh-Log durchreichen — Quellen ohne eigenen Parser (crowdsec/splunk/manuell)
    // hatten ihn bisher gar nicht in der Evidence.
    raw: str(ticket.logs),
  };
}

// source → Rich-Normalizer. Nicht eingetragene Quellen fallen auf generisch.
// `dataplane` brauchte kurzzeitig einen eigenen Normalizer; seine Payload-Auswertung
// ist jetzt IM generischen Normalizer und gilt damit für alle Quellen (qradar/splunk/
// email/crowdsec/manuell profitieren mit) — der Sonderweg ist entfallen.
// wazuh bleibt eigen: es parst zusätzlich den Roh-Alert (Sysmon/eventdata/DNS/FIM).
const NORMALIZERS = { wazuh: normalizeWazuhEvidence };

function normalizeEvidence(ticket = {}) {
  const fn = NORMALIZERS[ticket.source] || normalizeGenericEvidence;
  return fn(ticket);
}

module.exports = { normalizeGenericEvidence, normalizeEvidence, flatNetwork, NORMALIZERS };
