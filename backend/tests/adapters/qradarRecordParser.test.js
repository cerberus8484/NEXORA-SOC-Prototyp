'use strict';

const {
  detectRecordType,
  parseQRadarRecord,
} = require('../../src/integrations/adapters/qradar/qradarRecordParser');
const {
  extractRecordEntities,
} = require('../../src/integrations/adapters/qradar/qradarEntityExtractor');
const {
  mapRecordToNormalized,
} = require('../../src/integrations/adapters/qradar/qradarMapper');

// ── Realistische QRadar-Ariel-Records ───────────────────────────────────────

// QRadar Event (Log-Event aus /ariel/searches), Ariel-Feldnamen (lowercased)
const EVENT_RECORD = {
  qid:               5000023,
  qidname:           'Multiple Login Failures',
  sourceip:          '185.220.101.47',
  destinationip:     '10.99.99.45',
  sourceport:        51344,
  destinationport:   22,
  sourcemac:         'aa:bb:cc:dd:ee:ff',
  username:          'svc-backup',
  magnitude:         7,
  severity:          8,
  credibility:       7,
  relevance:         6,
  eventcount:        14,
  starttime:         1748952000000,
  endtime:           1748952600000,
  logsourceid:       63,
  logsourcename:     'WinCollect @ DC01',
  categoryname:      'Authentication.Login Failure',
  highlevelcategory: 'Authentication',
  lowlevelcategory:  'Login Failure',
  protocolid:        255,
  protocolname:      'TCP',
  identityhostname:  'DC01',
  identityusername:  'svc-backup',
  domainid:          0,
  utf8_payload:      'Failed password for svc-backup from 185.220.101.47',
};

// QRadar Flow (Netzwerk-Flow aus /ariel/searches), Ariel-Feldnamen
const FLOW_RECORD = {
  sourceip:           '10.99.99.45',
  destinationip:      '93.184.216.34',
  sourceport:         49251,
  destinationport:    443,
  sourcebytes:        2048,
  destinationbytes:   58210,
  sourcepackets:      24,
  destinationpackets: 41,
  protocolid:         6,
  protocolname:       'TCP',
  applicationid:      1001,
  application:        'Web.SecureWeb',
  flowdirection:      'L2R',
  firstpackettime:    1748952010000,
  lastpackettime:     1748952070000,
  sourceflags:        'S',
  destinationflags:   'SA',
  sourceasn:          0,
  destinationasn:     15133,
  flowsource:         'OPNsense',
};

// ── detectRecordType() ──────────────────────────────────────────────────────

describe('detectRecordType()', () => {
  test('Event-Record (qid/logsourceid) → "event"', () => {
    expect(detectRecordType(EVENT_RECORD)).toBe('event');
  });

  test('Flow-Record (bytes/packets/flowdirection) → "flow"', () => {
    expect(detectRecordType(FLOW_RECORD)).toBe('flow');
  });

  test('expliziter Typ überschreibt Heuristik', () => {
    expect(detectRecordType(EVENT_RECORD, 'flow')).toBe('flow');
  });

  test('leeres/ungültiges Objekt → "event" (Default)', () => {
    expect(detectRecordType(null)).toBe('event');
    expect(detectRecordType({})).toBe('event');
  });

  test('Feldnamen case-insensitive (SourceBytes erkannt)', () => {
    expect(detectRecordType({ SourceBytes: 10, DestinationBytes: 20 })).toBe('flow');
  });
});

// ── parseQRadarRecord() — Event ─────────────────────────────────────────────

describe('parseQRadarRecord() — Event', () => {
  const parsed = parseQRadarRecord(EVENT_RECORD);

  test('type = event, source = qradar', () => {
    expect(parsed.type).toBe('event');
    expect(parsed.source).toBe('qradar');
  });

  test('Netzwerk-Felder feldweise aufgegliedert', () => {
    expect(parsed.network.srcIp).toBe('185.220.101.47');
    expect(parsed.network.dstIp).toBe('10.99.99.45');
    expect(parsed.network.srcPort).toBe(51344);
    expect(parsed.network.dstPort).toBe(22);
    expect(parsed.network.srcMac).toBe('aa:bb:cc:dd:ee:ff');
    expect(parsed.network.protocol).toBe('TCP');
  });

  test('Identity-Felder aufgegliedert', () => {
    expect(parsed.identity.user).toBe('svc-backup');
    expect(parsed.identity.host).toBe('DC01');
  });

  test('Klassifizierung (severity/category/logsource)', () => {
    expect(parsed.severity).toBe(8);
    expect(parsed.credibility).toBe(7);
    expect(parsed.category.name).toBe('Authentication.Login Failure');
    expect(parsed.category.high).toBe('Authentication');
    expect(parsed.logSource.name).toBe('WinCollect @ DC01');
    expect(parsed.eventCount).toBe(14);
  });

  test('Zeitstempel → ISO 8601', () => {
    expect(parsed.time.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.time.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('alle Rohfelder bleiben in fields erhalten (Traceability)', () => {
    expect(parsed.fields.qid).toBe(5000023);
    expect(parsed.fields.utf8_payload).toContain('Failed password');
    expect(parsed.raw).toEqual(EVENT_RECORD);
  });

  test('case-insensitive: gemischte Großschreibung wird normalisiert', () => {
    const p = parseQRadarRecord({ SourceIP: '1.2.3.4', DestinationIP: '5.6.7.8', QID: 1 });
    expect(p.network.srcIp).toBe('1.2.3.4');
    expect(p.network.dstIp).toBe('5.6.7.8');
  });
});

// ── parseQRadarRecord() — Flow ──────────────────────────────────────────────

describe('parseQRadarRecord() — Flow', () => {
  const parsed = parseQRadarRecord(FLOW_RECORD);

  test('type = flow', () => {
    expect(parsed.type).toBe('flow');
  });

  test('5-Tuple aufgegliedert', () => {
    expect(parsed.network.srcIp).toBe('10.99.99.45');
    expect(parsed.network.dstIp).toBe('93.184.216.34');
    expect(parsed.network.srcPort).toBe(49251);
    expect(parsed.network.dstPort).toBe(443);
    expect(parsed.network.protocol).toBe('TCP');
  });

  test('Flow-spezifische Felder (bytes/packets/direction/application)', () => {
    expect(parsed.network.bytes.src).toBe(2048);
    expect(parsed.network.bytes.dst).toBe(58210);
    expect(parsed.network.packets.src).toBe(24);
    expect(parsed.network.packets.dst).toBe(41);
    expect(parsed.network.direction).toBe('L2R');
    expect(parsed.network.application).toBe('Web.SecureWeb');
    expect(parsed.network.asn.dst).toBe(15133);
    expect(parsed.network.flags.dst).toBe('SA');
  });

  test('Flow-Zeitfenster aus firstpackettime/lastpackettime', () => {
    expect(parsed.time.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.time.end).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── extractRecordEntities() — Event ─────────────────────────────────────────

describe('extractRecordEntities() — Event', () => {
  const entities = extractRecordEntities(parseQRadarRecord(EVENT_RECORD));
  const find = (kind, value) =>
    entities.find((e) => e.kind === kind && e.value === value);

  test('IPs mit Rolle (Source/Destination)', () => {
    expect(find('ip', '185.220.101.47').note).toBe('Source');
    expect(find('ip', '10.99.99.45').note).toBe('Destination');
  });

  test('User, Host, MAC aufgegliedert', () => {
    expect(find('user', 'svc-backup')).toBeTruthy();
    expect(find('host', 'DC01')).toBeTruthy();
    expect(find('mac', 'aa:bb:cc:dd:ee:ff')).toBeTruthy();
  });

  test('Ports als eigene Entitäten', () => {
    expect(find('port', '22').note).toBe('Destination');
    expect(find('port', '51344').note).toBe('Source');
  });

  test('jede Entity trägt source=qradar', () => {
    expect(entities.every((e) => e.source === 'qradar')).toBe(true);
  });

  test('keine leeren Werte, pro Record dedupliziert', () => {
    expect(entities.every((e) => e.value && e.value.length > 0)).toBe(true);
    const keys = entities.map((e) => `${e.kind}|${e.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── extractRecordEntities() — Flow ──────────────────────────────────────────

describe('extractRecordEntities() — Flow', () => {
  const entities = extractRecordEntities(parseQRadarRecord(FLOW_RECORD));
  const find = (kind, value) =>
    entities.find((e) => e.kind === kind && e.value === value);

  test('Flow-IPs/Ports aufgegliedert', () => {
    expect(find('ip', '10.99.99.45').note).toBe('Source');
    expect(find('ip', '93.184.216.34').note).toBe('Destination');
    expect(find('port', '443').note).toBe('Destination');
  });

  test('Application als Entität (flow-spezifisch)', () => {
    expect(find('application', 'Web.SecureWeb')).toBeTruthy();
  });

  test('Destination-ASN als Entität', () => {
    expect(find('asn', '15133')).toBeTruthy();
  });
});

// ── mapRecordToNormalized() ─────────────────────────────────────────────────

describe('mapRecordToNormalized() — Event', () => {
  const norm = mapRecordToNormalized(EVENT_RECORD, 'qradar');

  test('externalId = qradar:event:<qid>@<start>', () => {
    expect(norm.externalId).toMatch(/^qradar:event:5000023@/);
  });

  test('title aus qidname, priority aus severity', () => {
    expect(norm.title).toBe('Multiple Login Failures');
    expect(['high', 'critical']).toContain(norm.priority);
  });

  test('srcIp/dstIp gesetzt, datetime ISO', () => {
    expect(norm.srcIp).toBe('185.220.101.47');
    expect(norm.dstIp).toBe('10.99.99.45');
    expect(norm.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('entities-Block enthält aufgegliederte Entitäten', () => {
    expect(Array.isArray(norm.entities)).toBe(true);
    expect(norm.entities.some((e) => e.kind === 'user' && e.value === 'svc-backup')).toBe(true);
  });

  test('Raw bleibt als Evidence erhalten (Traceability)', () => {
    expect(norm.evidence[0].type).toBe('qradar_event');
    expect(norm.evidence[0].raw).toEqual(EVENT_RECORD);
  });
});

describe('mapRecordToNormalized() — Flow', () => {
  const norm = mapRecordToNormalized(FLOW_RECORD, 'qradar');

  test('type wird als flow erkannt, externalId = qradar:flow:...', () => {
    expect(norm.externalId).toMatch(/^qradar:flow:/);
    expect(norm.evidence[0].type).toBe('qradar_flow');
  });

  test('title beschreibt den Flow (Application + 5-Tuple)', () => {
    expect(norm.title).toContain('Web.SecureWeb');
    expect(norm.title).toContain('93.184.216.34');
  });

  test('entities enthalten Application', () => {
    expect(norm.entities.some((e) => e.kind === 'application' && e.value === 'Web.SecureWeb')).toBe(true);
  });
});
