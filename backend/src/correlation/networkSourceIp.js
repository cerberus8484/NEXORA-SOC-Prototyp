'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Slice 2b.0 — Saubere Semantik der Quell-IP-Extraktion.
//
// Zwei klar getrennte Begriffe (NICHT alles ist „attacker"):
//  - extractNetworkSourceIp: die echte Netzwerkquelle eines Events. Bei Sysmon
//    z.B. nur „die andere Seite der Verbindung", NICHT automatisch ein Angreifer.
//  - extractHoneypotAttackerIp: ausschließlich Cowrie `data.src_ip` — beim
//    Honeypot ist die Gegenstelle per Definition der Angreifer (externe IP).
//
// Harte Regeln:
//  - `agent.ip` ist NIE eine Quell-/Angreifer-IP — das ist „wer hat gemeldet"
//    (Host-/Sensor-Kontext) → extractSensorIp.
//  - dst_ip, WireGuard-IP, Honeypot-/Sensor-IP gelten NIE als Angreifer.
//  - Fehlt der echte Wert → null (kein Fallback, keine Erfindung).
// ─────────────────────────────────────────────────────────────────────────

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Echte Netzwerkquelle (rollen-neutral): Cowrie → Firewall → Sysmon → null.
function extractNetworkSourceIp(event = {}) {
  const d = (event && event.data) || {};
  return clean(d.src_ip)                                       // Cowrie (externe Gegenstelle)
      || clean(d.srcip)                                        // OPNsense / Firewall (pfSense-Decoder)
      || clean(d.win && d.win.eventdata && d.win.eventdata.sourceIp) // Sysmon Event 3 (nur Netzwerkquelle)
      || null;                                                 // NIE agent.ip
}

// Angreifer-IP NUR im Honeypot-Kontext: ausschließlich Cowrie `data.src_ip`.
function extractHoneypotAttackerIp(event = {}) {
  const d = (event && event.data) || {};
  return clean(d.src_ip) || null;
}

// „Wer hat das Event gemeldet?" — Host-/Sensor-Kontext, NIE als Quelle/Angreifer.
function extractSensorIp(event = {}) {
  return clean(event && event.agent && event.agent.ip);
}

module.exports = { extractNetworkSourceIp, extractHoneypotAttackerIp, extractSensorIp };
