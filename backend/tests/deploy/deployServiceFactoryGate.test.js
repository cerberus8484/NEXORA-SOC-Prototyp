'use strict';

const factory = require('../../src/deploy/deployServiceFactory');
const deployArmStore = require('../../src/services/deployArmStore');

describe('Deploy-Gate Key-Separation', () => {
  const original = {};

  beforeEach(() => {
    for (const key of ['DEPLOY_ENABLED', 'SETTINGS_ENC_KEY', 'JWT_SECRET']) original[key] = process.env[key];
    process.env.DEPLOY_ENABLED = 'true';
    process.env.JWT_SECRET = 'j'.repeat(32);
  });

  afterEach(() => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  });

  test('gleicher SETTINGS_ENC_KEY und JWT_SECRET ist nicht dediziert und hält das Gate inert', async () => {
    process.env.SETTINGS_ENC_KEY = process.env.JWT_SECRET;
    jest.spyOn(deployArmStore, 'isArmed').mockResolvedValue(true);

    expect(factory.isEncKeyDedicated()).toBe(false);
    await expect(factory.isDeployEnabled()).resolves.toBe(false);

    deployArmStore.isArmed.mockRestore();
  });
});
