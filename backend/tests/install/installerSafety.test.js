'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_INSTALL_1 — Safety-Gate für den Linux Bootstrap Installer.
//
// Unverhandelbare Regel: der Installer installiert, enrollt und meldet NUR
// read-only Systemdaten. Er ändert NIEMALS IP/DHCP/Gateway/DNS/VLAN/NAT/
// Routing/Sniffing/Firewall/Wazuh/OPNsense. Dieser Test erzwingt das statisch:
// jede ausführbare Zeile der Installer-/Agent-Skripte wird gegen eine
// Forbidden-Liste geprüft (Kommentare werden vorher entfernt). Findet der Scan
// auch nur eine solche Anweisung → CI rot.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const INSTALL_DIR = path.join(__dirname, '../../../deploy/install');
const BOOTSTRAP = path.join(INSTALL_DIR, 'bootstrap.sh');
const AGENT     = path.join(INSTALL_DIR, 'nexora-agent.sh');
const UNIT      = path.join(INSTALL_DIR, 'nexora-agent.service');

const read = (p) => fs.readFileSync(p, 'utf8');

// Kommentare entfernen (alles ab '#' bis Zeilenende) — auch Shebang & Inline.
// Die Skripte verwenden bewusst kein '#' in Strings/Parameter-Expansion.
const stripComments = (raw) => raw.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');

// Host-verändernde Netz-/Firewall-/Security-Werkzeuge — im Installer verboten.
const FORBIDDEN = /(\biptables\b|\bip6tables\b|\bnft\b|\bnftables\b|\bfirewall-cmd\b|\bufw\b|\bpfctl\b|opnsense|wazuh|ossec|\bnmcli\b|\bnetplan\b|\bdhclient\b|\bdhcpcd\b|\bdhcpd\b|\bresolvectl\b|systemd-resolve|\bip\s+(addr|link|route|a|l|r|neigh|rule|tunnel)\b|\broute\s+(add|del|delete|flush)\b|\bvconfig\b|\bbrctl\b|\btc\s+qdisc\b|\btcpdump\b|\btshark\b|\bsysctl\s+-w\b|\bvlan\b|\bnat\b)/i;

describe('P_INSTALL_1 — Dateien vorhanden', () => {
  test('bootstrap.sh, nexora-agent.sh, nexora-agent.service existieren', () => {
    expect(fs.existsSync(BOOTSTRAP)).toBe(true);
    expect(fs.existsSync(AGENT)).toBe(true);
    expect(fs.existsSync(UNIT)).toBe(true);
  });
});

describe('P_INSTALL_1 — No-Network-Change-Safety (Forbidden-Scan)', () => {
  for (const file of [BOOTSTRAP, AGENT, UNIT]) {
    test(`${path.basename(file)} enthält keine host-/netz-verändernde Anweisung`, () => {
      const code = stripComments(read(file));
      const hits = code.split('\n').filter((l) => FORBIDDEN.test(l)).map((l) => l.trim());
      expect(hits).toEqual([]);
    });
  }

  test('Forbidden-Regex schlägt bei einer echten Gefahr an (Selbsttest)', () => {
    expect(FORBIDDEN.test('iptables -A INPUT -j DROP')).toBe(true);
    expect(FORBIDDEN.test('ip addr add 10.0.0.1/24 dev eth0')).toBe(true);
    expect(FORBIDDEN.test('nmcli con mod')).toBe(true);
    expect(FORBIDDEN.test('systemctl restart wazuh-agent')).toBe(true);
    // Read-only / erlaubt darf NICHT anschlagen:
    expect(FORBIDDEN.test('hostname -I')).toBe(false);
    expect(FORBIDDEN.test('uname -r')).toBe(false);
    expect(FORBIDDEN.test('curl -fsS "$SERVER/api/v1/provisioning/enroll"')).toBe(false);
  });
});

describe('P_INSTALL_1 — bootstrap.sh Struktur-Vertrag', () => {
  let src;
  beforeAll(() => { src = read(BOOTSTRAP); });

  test('fail-fast + HTTP-Fehler hart (set -eu, curl -fsS)', () => {
    expect(src).toMatch(/set -eu/);
    expect(src).toMatch(/curl -fsS/);
  });
  test('erfordert --server und --token', () => {
    expect(src).toMatch(/--server/);
    expect(src).toMatch(/--token/);
  });
  test('enrollt gegen /provisioning/enroll mit Token + read-only Inventar', () => {
    expect(src).toMatch(/\/provisioning\/enroll/);
    expect(src).toMatch(/hostname/);
    expect(src).toMatch(/uname/);
    expect(src).toMatch(/capabilities/);
  });
  test('schreibt Config nur für root lesbar (chmod 600)', () => {
    expect(src).toMatch(/chmod 600/);
  });
  test('extrahiert die nodeId aus der Enroll-Antwort', () => {
    expect(src).toMatch(/nodeId/);
  });
});

describe('P_INSTALL_1 — nexora-agent.sh Struktur-Vertrag', () => {
  let src;
  beforeAll(() => { src = read(AGENT); });

  test('Heartbeat gegen /heartbeat mit Bearer-Token', () => {
    expect(src).toMatch(/\/heartbeat/);
    expect(src).toMatch(/Authorization: Bearer/);
  });
  test('periodischer Loop (sleep) mit healthy-Status', () => {
    expect(src).toMatch(/sleep/);
    expect(src).toMatch(/healthy/);
  });
  test('meldet nur read-only Inventar (uname / hostname)', () => {
    expect(src).toMatch(/uname/);
    expect(src).toMatch(/hostname/);
  });
});

describe('P_INSTALL_1 Slice 2 — Node-Credential-Handoff (kein Enrollment-Token im Betrieb)', () => {
  let boot; let agent;
  beforeAll(() => { boot = read(BOOTSTRAP); agent = read(AGENT); });

  test('bootstrap.sh extrahiert das Node-Credential aus der Enrollment-Antwort', () => {
    expect(boot).toMatch(/nodeCredential/);
    expect(boot).toMatch(/NODE_CRED/);
  });
  test('agent.env enthält Server, NodeId und Node-Credential', () => {
    expect(boot).toMatch(/NEXORA_SERVER=/);
    expect(boot).toMatch(/NEXORA_NODE_ID=/);
    expect(boot).toMatch(/NEXORA_NODE_CREDENTIAL=/);
  });
  test('bootstrap.sh persistiert NIEMALS den Enrollment-Token (kein NEXORA_TOKEN= in agent.env)', () => {
    // Der Enrollment-Token darf nur als $TOKEN im Speicher leben, nie auf Platte.
    expect(boot).not.toMatch(/NEXORA_TOKEN=/);
  });
  test('agent.sh nutzt für den Heartbeat ausschließlich das Node-Credential', () => {
    expect(agent).toMatch(/Authorization: Bearer/);
    expect(agent).toMatch(/NEXORA_NODE_CREDENTIAL/);
    expect(agent).not.toMatch(/NEXORA_TOKEN/);
  });
  test('Secrets stehen NICHT in der curl-Kommandozeile (argv/ps-sicher)', () => {
    // Node-Credential geht über eine stdin-Config (-K -), nicht als -H-Argument.
    expect(agent).toMatch(/-K -/);
    expect(agent).not.toMatch(/-H "Authorization: Bearer \$NEXORA_NODE_CREDENTIAL"/);
    // Enrollment-Token (im Body) geht über stdin (--data-binary @-), nicht als -d-Argument.
    expect(boot).toMatch(/--data-binary @-/);
    expect(boot).not.toMatch(/-d "\$PAYLOAD"/);
  });
  test('bootstrap.sh aktiviert kein Shell-Tracing (kein set -x → kein Secret-Leak in Logs)', () => {
    expect(boot).not.toMatch(/set\s+-x/);
    expect(agent).not.toMatch(/set\s+-x/);
  });
});
