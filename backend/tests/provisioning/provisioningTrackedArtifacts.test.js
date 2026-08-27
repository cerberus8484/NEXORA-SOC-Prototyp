'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

describe('startup release artifacts', () => {
  test('tracks token modules required during application startup', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const requiredPaths = [
      'backend/src/domain/ApiToken.js',
      'backend/src/middleware/apiTokenAuth.js',
      'backend/src/repositories/InMemoryApiTokenRepository.js',
      'backend/src/repositories/PostgresApiTokenRepository.js',
      'backend/src/repositories/apiTokenRepositoryFactory.js',
      'backend/src/routes/apiTokens.js',
      'backend/src/services/ApiTokenService.js',
      'backend/src/services/EnrollmentTokenService.js',
    ];

    for (const requiredPath of requiredPaths) {
      const trackedPath = execFileSync(
        'git',
        ['ls-files', '--error-unmatch', requiredPath],
        { cwd: repositoryRoot, encoding: 'utf8' },
      );
      expect(trackedPath.trim()).toBe(requiredPath);
    }
  });
});
