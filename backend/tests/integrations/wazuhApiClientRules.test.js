'use strict';

const { WazuhApiClient } = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

describe('WazuhApiClient.listRules', () => {
  test('ohne Config → leer', async () => {
    const r = await new WazuhApiClient({}).listRules({});
    expect(r).toEqual({ items: [], total: 0 });
  });

  test('normalisiert Regeln inkl. MITRE', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'TOKEN123');
    http.mockUrl('/rules', 200, {
      data: {
        total_affected_items: 1,
        affected_items: [{
          id: 100001, level: 12, description: 'PowerShell: IEX detected',
          groups: ['windows', 'execution', 'high_confidence'], mitre: ['T1059.001'], filename: '001_powershell.xml',
        }],
      },
    });
    const c = new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http });
    const r = await c.listRules({ search: 'powershell', limit: 50 });
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ id: 100001, level: 12, filename: '001_powershell.xml' });
    expect(r.items[0].mitre).toContain('T1059.001');
    expect(r.items[0].groups).toContain('execution');
    // Query enthält search + limit
    const last = http.getLastRequest();
    expect(last.url).toContain('search=powershell');
    expect(last.url).toContain('limit=50');
  });

  test('MITRE als Objekt {id:[...]} wird ebenfalls normalisiert', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    http.mockUrl('/rules', 200, { data: { total_affected_items: 1, affected_items: [{ id: 5, level: 3, description: 'x', groups: [], mitre: { id: ['T1110'] }, filename: 'f.xml' }] } });
    const r = await new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http }).listRules({});
    expect(r.items[0].mitre).toEqual(['T1110']);
  });
});

describe('WazuhApiClient.getRuleDetail', () => {
  test('ohne Config → null', async () => {
    expect(await new WazuhApiClient({}).getRuleDetail('87702')).toBeNull();
  });

  test('Frequency-Regel: liefert if_matched_sid + frequency aus details', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    http.mockUrl('/rules', 200, { data: { total_affected_items: 1, affected_items: [{
      id: 87702, level: 10, groups: ['multiple_blocks'],
      details: { frequency: '18', timeframe: '45', if_matched_sid: '87701' },
    }] } });
    const c = new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http });
    const d = await c.getRuleDetail('87702');
    expect(d).toMatchObject({ id: 87702, level: 10, frequency: 18, ifMatchedSid: '87701' });
    expect(http.getLastRequest().url).toContain('rule_ids=87702');
  });

  test('unbekannte Regel → null', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    http.mockUrl('/rules', 200, { data: { total_affected_items: 0, affected_items: [] } });
    const c = new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http });
    expect(await c.getRuleDetail('99999')).toBeNull();
  });
});

describe('WazuhApiClient.putRuleFile — Fehlererkennung (kein Silent-Failure)', () => {
  const client = (http) => new WazuhApiClient({ url: 'https://wz:55000', user: 'u', password: 'p', http });

  test('Erfolg (total_failed_items=0) → kein Wurf', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    http.mockUrl('/rules/files/', 200, { data: { affected_items: ['etc/rules/soc_fp.xml'], total_affected_items: 1, total_failed_items: 0, failed_items: [] } });
    await expect(client(http).putRuleFile('soc_fp.xml', '<group><rule id="900000"/></group>')).resolves.toBeDefined();
  });

  test('Wazuh meldet failed_items trotz HTTP 200 → wirft mit Code/Message', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    // exakt die echte Antwort beim PUT einer leeren Regelgruppe
    http.mockUrl('/rules/files/', 200, { data: { affected_items: [], total_affected_items: 0, total_failed_items: 1, failed_items: [{ error: { code: 1113, message: 'XML syntax error' }, id: ['etc/rules/soc_fp.xml'] }] } });
    await expect(client(http).putRuleFile('soc_fp.xml', '<group name="soc_fp,"></group>'))
      .rejects.toThrow(/1113|XML syntax error|nicht geschrieben/);
  });

  test('deleteRuleFile ruft DELETE auf', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'T');
    http.mockUrl('/rules/files/', 200, { data: { affected_items: ['etc/rules/soc_fp.xml'], total_affected_items: 1, total_failed_items: 0 } });
    await client(http).deleteRuleFile('soc_fp.xml');
    expect(http.getLastRequest().method).toBe('DELETE');
  });
});
