'use strict';

const fs = require('fs');
const path = require('path');

describe('Correlation Read-Pfad Guard', () => {
  test('tickets-GET-Route importiert und ruft CorrelationEngine.correlate nicht synchron auf', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/routes/tickets.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"]\.\.\/correlation\/CorrelationEngine['"]\)/);
    expect(source).not.toMatch(/\bcorrelate\s*\(/);
  });
});
