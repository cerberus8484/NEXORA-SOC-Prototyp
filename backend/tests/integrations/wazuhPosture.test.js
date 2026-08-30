'use strict';

const { WazuhApiClient } = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { WazuhIndexerClient } = require('../../src/integrations/adapters/wazuh/WazuhIndexerClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

describe('WazuhApiClient.getAgentSca', () => {
  test('aggregiert SCA-Policies (worstScore + totalFail, fail berechnet)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/sca/001', 200, { data: { affected_items: [
      { policy_id: 'cis_win11', name: 'CIS Win11', pass: 116, invalid: 9, total_checks: 482, score: 24 },
      { policy_id: 'other', name: 'Other', pass: 40, fail: 10, invalid: 0, total_checks: 50, score: 80 },
    ] } });
    const c = new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http });
    const r = await c.getAgentSca('001');
    expect(r.worstScore).toBe(24);
    expect(r.policies[0].fail).toBe(482 - 116 - 9); // 357 (kein fail-Feld → berechnet)
    expect(r.policies[1].fail).toBe(10);            // fail-Feld vorhanden
    expect(r.totalFail).toBe(357 + 10);
  });

  test('ohne Policies → leeres Resultat (worstScore null)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/sca/002', 200, { data: { affected_items: [] } });
    const r = await new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http }).getAgentSca('002');
    expect(r).toEqual({ policies: [], worstScore: null, totalFail: 0 });
  });

  test('ohne Config → null', async () => {
    expect(await new WazuhApiClient({}).getAgentSca('1')).toBeNull();
  });
});

describe('WazuhIndexerClient.agentVulnerabilities', () => {
  function client() {
    const c = new WazuhIndexerClient({ url: 'https://wz:9200', user: 'u', password: 'p' });
    c._searchOn = async (index, body) => {
      expect(index).toBe('wazuh-states-vulnerabilities-*');
      expect(body.query.bool.filter[0].term['agent.id']).toBe('007');
      return {
        hits: { total: { value: 42 }, hits: [
          { _source: { vulnerability: { id: 'CVE-2024-9999', severity: 'Critical', score: { base: 9.8 } }, package: { name: 'openssl', version: '1.1' } } },
          { _source: { vulnerability: { id: 'CVE-2023-1', severity: 'High', score: { base: 7.5 } }, package: { name: 'vim', version: '9.0' } } },
        ] },
        aggregations: { sev: { buckets: [
          { key: 'Critical', doc_count: 5 }, { key: 'High', doc_count: 10 },
          { key: 'Medium', doc_count: 20 }, { key: 'Low', doc_count: 7 }, { key: '-', doc_count: 3 },
        ] } },
      };
    };
    return c;
  }

  test('zählt Severities + liefert schwerste CVEs', async () => {
    const r = await client().agentVulnerabilities('007');
    expect(r.critical).toBe(5);
    expect(r.high).toBe(10);
    expect(r.medium).toBe(20);
    expect(r.low).toBe(7);
    expect(r.total).toBe(42);
    expect(r.topCves[0]).toMatchObject({ cve: 'CVE-2024-9999', severity: 'Critical', score: 9.8, package: 'openssl' });
  });

  test('ohne Config → null', async () => {
    expect(await new WazuhIndexerClient({}).agentVulnerabilities('1')).toBeNull();
  });
});
