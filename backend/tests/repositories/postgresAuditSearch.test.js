'use strict';

// A6a — PostgresAuditRepository.findRecent: Volltext-Suche muss vollständig
// parametrisiert sein (kein SQL-String-Concat, kein Injection-Vektor) und mit
// den anderen Filtern zusammenarbeiten. Pool wird gemockt → kein echter DB-Zugriff.

jest.mock('../../src/db/pool', () => ({ query: jest.fn() }));

const { query } = require('../../src/db/pool');
const { PostgresAuditRepository } = require('../../src/repositories/PostgresAuditRepository');

const repo = new PostgresAuditRepository();

beforeEach(() => {
  query.mockReset();
  // 1. Aufruf = COUNT, 2. Aufruf = SELECT data
  query
    .mockResolvedValueOnce({ rows: [{ total: '0' }] })
    .mockResolvedValueOnce({ rows: [] });
});

describe('PostgresAuditRepository.findRecent — search (A6a)', () => {
  it('erzeugt parametrisiertes LIKE über die erlaubten Felder; Suchbegriff NICHT im SQL-String', async () => {
    await repo.findRecent({ limit: 50, offset: 0, search: 'Mimikatz' });

    const countSql    = query.mock.calls[0][0];
    const countParams = query.mock.calls[0][1];

    expect(countSql).toMatch(/LOWER\(actor_label\) LIKE \$1/);
    expect(countSql).toMatch(/LOWER\(action\) LIKE \$1/);
    expect(countSql).toMatch(/LOWER\(target_type\) LIKE \$1/);
    expect(countSql).toMatch(/LOWER\(target_id\) LIKE \$1/);
    // Der Suchbegriff darf NICHT im SQL-Text stehen — nur als gebundener Parameter.
    expect(countSql).not.toMatch(/Mimikatz/i);
    expect(countParams).toEqual(['%mimikatz%']);
  });

  it('kombiniert search mit action-Filter — korrekte Platzhalter-Reihenfolge', async () => {
    await repo.findRecent({ limit: 10, offset: 5, action: 'LOGIN', search: 'admin' });

    const dataSql    = query.mock.calls[1][0];
    const dataParams = query.mock.calls[1][1];

    expect(dataSql).toMatch(/action = \$1/);
    expect(dataSql).toMatch(/LIKE \$2/);
    expect(dataSql).toMatch(/LIMIT \$3 OFFSET \$4/);
    expect(dataParams).toEqual(['LOGIN', '%admin%', 10, 5]);
  });

  it('COUNT und SELECT nutzen identische WHERE-Parameter (kein Drift)', async () => {
    await repo.findRecent({ limit: 25, offset: 0, search: 'x' });

    const countParams = query.mock.calls[0][1];
    const dataParams  = query.mock.calls[1][1];
    // dataParams = filterParams + [limit, offset]; die Filter-Präfixe müssen identisch sein.
    expect(dataParams.slice(0, countParams.length)).toEqual(countParams);
  });
});
