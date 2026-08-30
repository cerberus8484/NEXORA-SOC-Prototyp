'use strict';

// Auto-Threat-Intel für den Deck-Load: reichert öffentliche Ticket-IPs automatisch an
// (für Honeypot-Tickets ist die Angreifer-Source-IP der primäre Indikator). Reines
// Orchestrierungs-Modul mit injiziertem enrich/isPublic — soft-fail, bounded, dedupe.

const { buildTicketThreatIntel, pickGeo } = require('../../src/correlation/ticketThreatIntel');

const okEnrich = (byIp) => async ({ indicatorValue }) => {
  const r = byIp[indicatorValue];
  return r ? { ok: true, result: r } : { ok: false, error: 'none' };
};

const RES_88 = {
  verdict: 'malicious', score: 100, confidence: 67, source: 'provider',
  summary: 'AbuseIPDB: 100% Confidence, 1262 Reports, NL.',
  tags: ['Data Center', 'NL', 'LU'],
  providers: [
    { provider: 'mock', status: 'ok', details: {} },
    { provider: 'abuseipdb', status: 'ok', details: { country: 'NL', usageType: 'Data Center/Web Hosting/Transit', totalReports: 1262 } },
    { provider: 'virustotal', status: 'ok', details: { country: 'LU', asOwner: 'Offshore LC', reputation: -6, malicious: 17 } },
  ],
};

describe('buildTicketThreatIntel', () => {
  test('reichert öffentliche IP an (Honeypot-Angreifer), extrahiert Land/ASN/Reports', async () => {
    const out = await buildTicketThreatIntel({
      ips: ['176.65.139.88'],
      enrich: okEnrich({ '176.65.139.88': RES_88 }),
      isPublic: () => true,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      indicatorValue: '176.65.139.88', verdict: 'malicious', score: 100, source: 'provider',
      country: 'NL', asnOwner: 'Offshore LC', usageType: 'Data Center/Web Hosting/Transit', totalReports: 1262,
    });
  });

  test('private/reservierte IPs werden NIE angefragt (kein Quota-Verbrauch)', async () => {
    const calls = [];
    const enrich = async (q) => { calls.push(q.indicatorValue); return { ok: true, result: RES_88 }; };
    const out = await buildTicketThreatIntel({
      ips: ['10.99.99.80', '10.99.99.5', '176.65.139.88'],
      enrich,
      isPublic: (ip) => ip === '176.65.139.88',
    });
    expect(calls).toEqual(['176.65.139.88']);   // nur die öffentliche
    expect(out).toHaveLength(1);
  });

  test('dedupliziert und ist auf max begrenzt', async () => {
    const calls = [];
    const enrich = async (q) => { calls.push(q.indicatorValue); return { ok: true, result: RES_88 }; };
    await buildTicketThreatIntel({
      ips: ['1.1.1.1', '1.1.1.1', '2.2.2.2', '3.3.3.3'],
      enrich, isPublic: () => true, max: 2,
    });
    expect(calls).toEqual(['1.1.1.1', '2.2.2.2']); // dedupe + max 2
  });

  test('soft-fail: ein Lookup-Fehler bricht NICHT, andere IPs kommen durch', async () => {
    const enrich = async ({ indicatorValue }) => {
      if (indicatorValue === '1.1.1.1') throw new Error('rate limit');
      return { ok: true, result: RES_88 };
    };
    const out = await buildTicketThreatIntel({
      ips: ['1.1.1.1', '2.2.2.2'], enrich, isPublic: () => true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].indicatorValue).toBe('2.2.2.2');
  });

  test('ok:false (kein Treffer) wird ausgelassen', async () => {
    const out = await buildTicketThreatIntel({
      ips: ['9.9.9.9'], enrich: okEnrich({}), isPublic: () => true,
    });
    expect(out).toEqual([]);
  });

  test('ohne enrich-Funktion → leeres Array (kein Crash)', async () => {
    expect(await buildTicketThreatIntel({ ips: ['1.1.1.1'] })).toEqual([]);
  });
});

describe('pickGeo', () => {
  test('extrahiert erstes vorhandenes Land/ASN/usageType/Reports über Provider', () => {
    expect(pickGeo(RES_88.providers)).toEqual({
      country: 'NL', asnOwner: 'Offshore LC', usageType: 'Data Center/Web Hosting/Transit', totalReports: 1262,
    });
  });
  test('leere Provider → alle null', () => {
    expect(pickGeo([])).toEqual({ country: null, asnOwner: null, usageType: null, totalReports: null });
  });
});
