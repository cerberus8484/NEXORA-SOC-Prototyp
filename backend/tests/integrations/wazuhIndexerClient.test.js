'use strict';

const { WazuhIndexerClient } = require('../../src/integrations/adapters/wazuh/WazuhIndexerClient');

const CREDS = { url: 'https://wazuh:9200', user: 'admin', password: 'secret' };

// Deterministischer Stub für _search: antwortet anhand der Body-Struktur.
function stub(client) {
  client._search = async (body) => {
    if (body.aggs?.over_time) {
      return { aggregations: { over_time: { buckets: [
        { key_as_string: '2026-06-07T10:00:00Z', doc_count: 5 },
        { key_as_string: '2026-06-07T11:00:00Z', doc_count: 8 },
      ] } } };
    }
    if (body.aggs?.sev) {
      return { aggregations: { sev: { buckets: {
        critical: { doc_count: 1 }, high: { doc_count: 2 }, medium: { doc_count: 3 }, low: { doc_count: 4 },
      } } } };
    }
    if (body.aggs?.top) {
      const field = body.aggs.top.terms.field;
      if (field === 'rule.mitre.tactic') return { aggregations: { top: { buckets: [
        { key: 'Execution', doc_count: 10, sub: { buckets: [{ key: 'T1059' }, { key: 'T1106' }] } },
      ] } } };
      if (field === 'agent.name')  return { aggregations: { top: { buckets: [{ key: 'CLIENT-042', doc_count: 7 }] } } };
      if (field === 'data.srcip')  return { aggregations: { top: { buckets: [{ key: '185.220.101.12', doc_count: 3 }] } } };
      return { aggregations: { top: { buckets: [] } } };
    }
    if (body.sort) {
      return { hits: { hits: [{ _source: {
        '@timestamp': '2026-06-07T11:30:00Z',
        rule: { id: '100201', level: 12, description: 'Suspicious outbound connection' },
        agent: { name: 'CLIENT-042' }, data: { srcip: '192.168.240.44', dstip: '185.220.101.12' },
      } }] } };
    }
    return { hits: { total: { value: 100 } } }; // _count
  };
  return client;
}

describe('WazuhIndexerClient', () => {
  test('isEnabled false ohne Credentials', () => {
    expect(new WazuhIndexerClient({}).isEnabled()).toBe(false);
    expect(new WazuhIndexerClient(CREDS).isEnabled()).toBe(true);
  });

  test('severity mappt die vier Bänder', async () => {
    const c = stub(new WazuhIndexerClient(CREDS));
    expect(await c._severity()).toEqual({ critical: 1, high: 2, medium: 3, low: 4 });
  });

  test('recentAlerts leitet Severity aus rule.level ab', async () => {
    const c = stub(new WazuhIndexerClient(CREDS));
    const recent = await c._recentAlerts();
    expect(recent[0].severity).toBe('critical');
    expect(recent[0].ruleId).toBe('100201');
    expect(recent[0].srcIp).toBe('192.168.240.44');
  });

  test('topTactics berechnet Prozent gegen Gesamt', async () => {
    const c = stub(new WazuhIndexerClient(CREDS));
    const t = await c._topTactics();
    expect(t[0].tactic).toBe('Execution');
    expect(t[0].pct).toBe(10);            // 10 / 100
    expect(t[0].techniques).toEqual(['T1059', 'T1106']);
  });

  test('dashboard liefert das komplette Indexer-DTO', async () => {
    const c = stub(new WazuhIndexerClient(CREDS));
    const d = await c.dashboard();
    expect(d.kpis.alertsToday).toBe(100);
    expect(d.kpis.ruleMatches).toBe(100);
    expect(d.severity.medium).toBe(3);
    expect(d.timeSeries.length).toBe(2);
    expect(d.topHosts[0].host).toBe('CLIENT-042');
    expect(d.topSourceIps[0].reputation).toBe('unknown'); // kein Fake-Reputation-Label
  });

  test('ticketFlows-Projektion enthält Event-Computer + initiated (CE-4.4) + bestehende Sysmon-Felder', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] }, aggregations: {} }; };
    await c.ticketFlows({ ruleId: '100951', agentId: '009' });
    // CE-4.4.1: Felder, die der FQDN-Pfad braucht.
    expect(captured._source).toContain('data.win.system.computer');
    expect(captured._source).toContain('data.win.eventdata.initiated');
    // Bestehende Sysmon-Event-3-Felder bleiben erhalten.
    for (const f of ['data.win.eventdata.sourceIp', 'data.win.eventdata.destinationIp',
      'data.win.eventdata.destinationPort', 'data.win.eventdata.image']) {
      expect(captured._source).toContain(f);
    }
  });

  test('ticketFlows flowOnly=true (Host-Case): Query verlangt NUR flow-relevante Events (size bleibt begrenzt)', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] }, aggregations: {} }; };
    await c.ticketFlows({ agentId: '009', flowOnly: true });
    const filterStr = JSON.stringify(captured.query.bool.filter);
    // Flow-Relevanz (Sysmon E3 eventID 3 ODER Firewall src/dst-IP) MUSS im Filter sein,
    // damit Nicht-Flow-Events (WMI/FileCreate) ältere Flows nicht aus dem Fenster drängen.
    expect(filterStr).toContain('data.win.system.eventID');
    expect(filterStr).toContain('data.srcip');
    expect(filterStr).toContain('minimum_should_match'); // nur Flow-Events matchen
    expect(captured.size).toBeLessThanOrEqual(50);        // kontrolliert, keine unbounded Query
  });

  test('ticketFlows rule-scoped (flowOnly default false): Query UNVERÄNDERT, kein Flow-Relevanz-Filter', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] }, aggregations: {} }; };
    await c.ticketFlows({ ruleId: '87702', agentId: '003' }); // INC000357-Pfad (Firewall, rule-scoped)
    const filterStr = JSON.stringify(captured.query.bool.filter);
    expect(filterStr).toContain('87702');                       // rule.id-Filter bleibt
    expect(filterStr).not.toContain('data.win.system.eventID'); // KEIN Flow-Relevanz-Filter im rule-scoped Pfad
  });

  test('ticketFlows: Cowrie-Honeypot wird mitgeholt (Projektion + Flow-Relevanz) — Slice 1', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] }, aggregations: {} }; };
    await c.ticketFlows({ agentId: '013', flowOnly: true });
    // Ohne diese Felder in der Projektion käme das Cowrie-Event feld-leer beim Flow-Normalizer an.
    for (const f of ['data.eventid', 'data.src_ip', 'data.src_port', 'data.dst_ip', 'data.dst_port',
      'data.session', 'data.sensor', 'data.duration', 'data.timestamp']) {
      expect(captured._source).toContain(f);
    }
    // 2b.2: agent.id wird projiziert, damit der belegte Honeypot-Agent aus den Cowrie-Sources ableitbar ist.
    expect(captured._source).toContain('agent.id');
    // Flow-Relevanz-Filter (Host-Case) muss ALLE Cowrie-Events zulassen (Präfix cowrie.).
    expect(JSON.stringify(captured.query.bool.filter)).toContain('cowrie.');
  });

  test('ticketFlows mappt Events + Aggregate (first/last/count/ports/actions)', async () => {
    const c = new WazuhIndexerClient(CREDS);
    c._search = async (body) => {
      // Filter enthält rule.id + Zeitfenster, should enthält srcip/agent
      expect(JSON.stringify(body.query.bool.filter)).toContain('87702');
      return {
        hits: { total: { value: 412 }, hits: [{ _source: {
          '@timestamp': '2026-06-07T14:15:49Z', rule: { id: '87702', level: 5, description: 'pfSense block' },
          agent: { name: 'OPNsense' }, data: { srcip: '192.168.240.109', dstip: '224.0.0.7', srcport: '8001', dstport: '8001', protocol: 'udp', action: 'block' },
        } }] },
        aggregations: {
          first: { value_as_string: '2026-06-06T20:44:26Z' }, last: { value_as_string: '2026-06-07T14:15:49Z' },
          dstports: { buckets: [{ key: '8001', doc_count: 412 }] }, actions: { buckets: [{ key: 'block', doc_count: 412 }] },
        },
      };
    };
    const r = await c.ticketFlows({ ruleId: '87702', srcIp: '192.168.240.109', agentId: '003' });
    expect(r.count).toBe(412);
    expect(r.first).toBe('2026-06-06T20:44:26Z');
    expect(r.last).toBe('2026-06-07T14:15:49Z');
    expect(r.actions).toEqual([{ action: 'block', count: 412 }]);
    expect(r.dstPorts).toEqual([{ port: '8001', count: 412 }]);
    expect(r.events[0]).toMatchObject({ srcIp: '192.168.240.109', dstIp: '224.0.0.7', action: 'block', protocol: 'udp' });
  });

  test('ticketFlows ohne Config → null', async () => {
    expect(await new WazuhIndexerClient({}).ticketFlows({ ruleId: '1' })).toBeNull();
  });

  test('telemetry mappt Filter-Serien + Histogramm zu {t,count}-Reihen', async () => {
    const c = new WazuhIndexerClient(CREDS);
    const histo = (counts) => ({ over_time: { buckets: counts.map((n, i) => ({ key_as_string: `2026-06-11T0${i}:00:00Z`, doc_count: n })) } });
    c._search = async (body) => {
      if (body.aggs?.series) {
        // Eine Query für alle Serien (filters-Agg + date_histogram)
        expect(JSON.stringify(body)).toContain('4625');
        expect(JSON.stringify(body)).toContain('1116');
        expect(JSON.stringify(body)).toContain('pfsense'); // Live-Gruppenname (verifiziert)
        // WEF-Serie: am Collector gesammelt, aber NICHT dort entstanden
        // (location ist im Live-Index 'EventChannel', taugt nicht als Filter)
        expect(JSON.stringify(body)).toContain('WEC01');
        expect(JSON.stringify(body)).toContain('data.win.system.computer');
        // Agent-Buffer-Warnungen (Regel 202/203) als eigene Serie + Pro-Agent-Agg
        expect(body.aggs.bufferAgents.filter.terms['rule.id']).toEqual(['202', '203']);
        expect(body.aggs.bufferAgents.aggs.byAgent.terms.field).toBe('agent.name');
        // Volle Zeitachse erzwingen — sonst keine Kurve bei dünnen Serien
        expect(body.aggs.series.aggs.over_time.date_histogram.extended_bounds).toEqual({ min: 'now-24h', max: 'now' });
        // Pro-Agent-Serien für die Netz-Zonen (Mapping Agent→VLAN macht das Frontend)
        expect(body.aggs.byAgent.terms.field).toBe('agent.name');
        expect(body.aggs.byAgent.aggs.over_time.date_histogram.extended_bounds).toEqual({ min: 'now-24h', max: 'now' });
        return { aggregations: {
          series: { buckets: {
            events:   histo([50, 80]),
            alerts:   histo([2, 5]),
            dcLogons: histo([10, 14]),
            dcFailed: histo([0, 3]),
            defender: histo([0, 1]),
            fwBlock:  histo([7, 9]),
            fwPass:   histo([120, 140]),
            wef:      histo([4, 6]),
            agentBuffer: histo([1, 2]),
          } },
          byAgent: { buckets: [
            { key: 'WEC01', doc_count: 99, ...histo([60, 39]) },
            { key: 'WindowsClient', doc_count: 31, ...histo([20, 11]) },
          ] },
          // OPNsense meldet Buffer 90% voll (202), DC01 sogar geflutet (203).
          bufferAgents: { byAgent: { buckets: [
            { key: 'OPNsense', doc_count: 4, byRule: { buckets: [{ key: '202', doc_count: 4 }] } },
            { key: 'DC01', doc_count: 2, byRule: { buckets: [{ key: '202', doc_count: 1 }, { key: '203', doc_count: 1 }] } },
          ] } },
        } };
      }
      // Zwei sortierte Suchen: Defender-Recent (Gruppen-Filter) + Live-Feed (_recentAlerts)
      if (JSON.stringify(body.query).includes('windows_defender')) {
        return { hits: { hits: [{ _source: {
          '@timestamp': '2026-06-11T08:15:00Z',
          rule: { level: 12, description: 'Windows Defender: Malware erkannt' },
          agent: { name: 'WEC01' },
          data: { win: { system: { eventID: '1116' }, eventdata: { threatName: 'Virus:DOS/EICAR_Test_File' } } },
        } }] } };
      }
      return { hits: { hits: [{ _source: {
        '@timestamp': '2026-06-11T08:20:00Z',
        rule: { id: '100612', level: 9, description: 'Sysmon - Suspicious FileCreate' },
        agent: { name: 'WindowsClient' }, data: {},
      } }] } };
    };

    const t = await c.telemetry();
    expect(t.series.events).toEqual([
      { t: '2026-06-11T00:00:00Z', count: 50 },
      { t: '2026-06-11T01:00:00Z', count: 80 },
    ]);
    expect(t.series.dcFailed[1].count).toBe(3);
    expect(t.series.fwBlock[0].count).toBe(7);
    expect(t.series.fwPass[1].count).toBe(140);
    expect(t.series.wef[1].count).toBe(6);
    expect(t.agents).toEqual([
      { name: 'WEC01', points: [
        { t: '2026-06-11T00:00:00Z', count: 60 }, { t: '2026-06-11T01:00:00Z', count: 39 },
      ] },
      { name: 'WindowsClient', points: [
        { t: '2026-06-11T00:00:00Z', count: 20 }, { t: '2026-06-11T01:00:00Z', count: 11 },
      ] },
    ]);
    expect(t.series.agentBuffer).toEqual([
      { t: '2026-06-11T00:00:00Z', count: 1 }, { t: '2026-06-11T01:00:00Z', count: 2 },
    ]);
    // OPNsense nur 202 (Warnung), DC01 zusätzlich 203 (Events verworfen)
    expect(t.bufferAgents).toEqual([
      { name: 'OPNsense', warn: 4, full: 0 },
      { name: 'DC01', warn: 1, full: 1 },
    ]);
    expect(t.defenderRecent[0]).toMatchObject({
      host: 'WEC01', eventID: '1116', threat: 'Virus:DOS/EICAR_Test_File',
    });
    expect(t.recent[0]).toMatchObject({
      ruleId: '100612', severity: 'high', host: 'WindowsClient',
    });
  });

  test('telemetry ohne Config → null', async () => {
    expect(await new WazuhIndexerClient({}).telemetry()).toBeNull();
  });
});

describe('ticketHoneypotSessions (Slice 2b.1) — session-bezogene, fenster-begrenzte Query', () => {
  const base = { agentId: '013', srcIp: '185.220.101.45', firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z' };

  test('Query: agent.id + data.src_ip + Zeitfenster (±15min) + cowrie-only', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketHoneypotSessions(base);
    const fstr = JSON.stringify(captured.query.bool.filter);
    expect(fstr).toContain('"agent.id"');
    expect(fstr).toContain('013');
    expect(fstr).toContain('data.src_ip');
    expect(fstr).toContain('185.220.101.45');
    expect(fstr).toContain('2026-06-24T08:00:30.000Z'); // firstSeen - 15min
    expect(fstr).toContain('2026-06-24T08:35:00.000Z'); // lastSeen + 15min
    expect(fstr).toContain('cowrie.');                  // nur Cowrie-Events
  });

  test('Projektion: Session-Felder ja, data.password NIEMALS', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketHoneypotSessions(base);
    for (const f of ['data.eventid', 'data.session', 'data.src_ip', 'data.username', 'data.input',
      'data.url', 'data.shasum', 'data.hassh']) {
      expect(captured._source).toContain(f);
    }
    expect(captured._source).not.toContain('data.password');
  });

  test('optionale sessionId verengt die Query zusätzlich', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketHoneypotSessions({ ...base, sessionId: 'abc123' });
    expect(JSON.stringify(captured.query.bool.filter)).toContain('abc123');
  });

  test('fehlende Voraussetzungen → KEINE breite Suche, leeres Ergebnis mit Grund', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let called = false;
    c._search = async () => { called = true; return { hits: { hits: [] } }; };
    expect(await c.ticketHoneypotSessions({ ...base, agentId: null })).toMatchObject({ events: [], reason: 'missing_agent' });
    expect(await c.ticketHoneypotSessions({ ...base, srcIp: '' })).toMatchObject({ events: [], reason: 'missing_src_ip' });
    expect(await c.ticketHoneypotSessions({ ...base, firstSeen: null, lastSeen: null })).toMatchObject({ events: [], reason: 'missing_time_window' });
    expect(called).toBe(false);
  });

  test('size auf dokumentierte Obergrenze begrenzt', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketHoneypotSessions({ ...base, size: 99999 });
    expect(captured.size).toBeLessThanOrEqual(1000);
  });

  test('mappt rohe _source-Events (für aggregateHoneypotSessions)', async () => {
    const c = new WazuhIndexerClient(CREDS);
    c._search = async () => ({ hits: { total: { value: 1 }, hits: [
      { _source: { '@timestamp': '2026-06-24T08:15:31Z', data: { eventid: 'cowrie.login.failed', session: 's1', username: 'root' } } },
    ] } });
    const r = await c.ticketHoneypotSessions(base);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].data.eventid).toBe('cowrie.login.failed');
    expect(r.total).toBe(1);
  });

  test('ohne Config → null', async () => {
    expect(await new WazuhIndexerClient({}).ticketHoneypotSessions(base)).toBeNull();
  });
});

describe('ticketFirewallFlows (Slice 3b.1) — Firewall-Kandidaten für Exposure-Stitching', () => {
  const base = { srcIp: '91.92.40.10', firstSeen: '2026-06-24T08:15:30.000Z', lastSeen: '2026-06-24T08:20:00.000Z' };

  test('Query: Firewall-Gruppen + data.srcip + Zeitfenster; Projektion 5-Tuple + id', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketFirewallFlows(base);
    const fstr = JSON.stringify(captured.query.bool.filter);
    expect(fstr).toContain('rule.groups');
    expect(fstr).toContain('pfsense');
    expect(fstr).toContain('data.srcip');
    expect(fstr).toContain('91.92.40.10');
    for (const f of ['data.id', 'data.srcip', 'data.dstip', 'data.srcport', 'data.dstport', 'data.protocol', 'data.action']) {
      expect(captured._source).toContain(f);
    }
  });

  test('fehlende src_ip / Zeitfenster → KEINE Suche, leeres Ergebnis mit Grund', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let called = false;
    c._search = async () => { called = true; return { hits: { hits: [] } }; };
    expect(await c.ticketFirewallFlows({ ...base, srcIp: '' })).toMatchObject({ flows: [], reason: 'missing_src_ip' });
    expect(await c.ticketFirewallFlows({ ...base, firstSeen: null, lastSeen: null })).toMatchObject({ flows: [], reason: 'missing_time_window' });
    expect(called).toBe(false);
  });

  test('mappt Hits → engine-fertige Firewall-Flows (sourceType firewall + eventId)', async () => {
    const c = new WazuhIndexerClient(CREDS);
    c._search = async () => ({ hits: { total: { value: 1 }, hits: [
      { _id: 'doc-1', _source: { '@timestamp': '2026-06-24T08:15:35.000Z', data: { id: 'fw-1', srcip: '91.92.40.10', dstip: '203.0.113.7', srcport: '54321', dstport: '2222', protocol: 'TCP', action: 'pass' } } },
    ] } });
    const r = await c.ticketFirewallFlows(base);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]).toMatchObject({ sourceType: 'firewall', eventId: 'fw-1', sourceIp: '91.92.40.10', destinationIp: '203.0.113.7', destinationPort: 2222, protocol: 'tcp', action: 'pass' });
  });

  test('size auf Obergrenze begrenzt', async () => {
    const c = new WazuhIndexerClient(CREDS);
    let captured = null;
    c._search = async (body) => { captured = body; return { hits: { total: { value: 0 }, hits: [] } }; };
    await c.ticketFirewallFlows({ ...base, size: 99999 });
    expect(captured.size).toBeLessThanOrEqual(1000);
  });

  test('ohne Config → null', async () => {
    expect(await new WazuhIndexerClient({}).ticketFirewallFlows(base)).toBeNull();
  });
});
