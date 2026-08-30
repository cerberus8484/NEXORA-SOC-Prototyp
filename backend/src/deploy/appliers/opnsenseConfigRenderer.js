'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — OPNsense config.xml-Renderer.
//
// Rendert die validierten Vorgaben (Hostname, LAN-IP/CIDR/VLAN, Gateway, DNS)
// deterministisch in ein OPNsense-config.xml-Fragment. ALLE dynamischen Werte
// werden XML-escaped (OWASP A03 — verhindert config.xml-Injection). Es wird
// NIE ein Secret gerendert (der Renderer liest nur bekannte Netzwerk-Felder).
// ─────────────────────────────────────────────────────────────────────────

// & muss zuerst ersetzt werden, sonst würden die Entities selbst wieder escaped.
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {object} params validierte Deploy-Params (secret-frei) */
function renderConfigXml(params = {}) {
  const dns = Array.isArray(params.dns) ? params.dns : [];
  const dnsXml = dns.map((d) => `    <dnsserver>${esc(d)}</dnsserver>`).join('\n');
  const vlanXml = params.vlanTag != null ? `\n      <tag>${esc(params.vlanTag)}</tag>` : '';

  return `<?xml version="1.0"?>
<opnsense>
  <system>
    <hostname>${esc(params.hostname)}</hostname>
${dnsXml}
  </system>
  <interfaces>
    <lan>
      <if>${esc(params.lanInterface)}</if>
      <ipaddr>${esc(params.staticIp)}</ipaddr>
      <subnet>${esc(params.cidr)}</subnet>${vlanXml}
    </lan>
    <wan>
      <if>${esc(params.wanInterface)}</if>
    </wan>
  </interfaces>
  <gateways>
    <gateway_item>
      <name>WAN_GW</name>
      <gateway>${esc(params.gateway)}</gateway>
    </gateway_item>
  </gateways>
</opnsense>`;
}

module.exports = { renderConfigXml, esc };
