'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

describe('provisioning release artifacts', () => {
  test('tracks the enrollment token service required during application startup', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const trackedPath = execFileSync(
      'git',
      ['ls-files', '--error-unmatch', 'backend/src/services/EnrollmentTokenService.js'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );

    expect(trackedPath.trim()).toBe('backend/src/services/EnrollmentTokenService.js');
  });
});
