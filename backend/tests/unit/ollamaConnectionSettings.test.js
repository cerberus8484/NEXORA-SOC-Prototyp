'use strict';

const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { resolveOllamaConnection } = require('../../src/services/ollamaConnectionSettings');

describe('resolveOllamaConnection', () => {
  test('nimmt DB-Werte, wenn sie gesetzt sind', async () => {
    const repo = createSettingsRepository();
    await repo.set('ollamaBaseUrl', 'http://10.0.10.77:11434');
    await repo.set('ollamaModel', 'llama3.2:3b');

    const res = await resolveOllamaConnection(repo, {
      OLLAMA_BASE_URL: 'http://10.0.10.88:11434',
      OLLAMA_MODEL: 'env-model',
    });

    expect(res).toEqual({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      source: 'db',
    });
  });

  test('faellt feldweise auf ENV zurueck', async () => {
    const repo = createSettingsRepository();
    await repo.set('ollamaModel', 'llama3.2:3b');

    const res = await resolveOllamaConnection(repo, {
      OLLAMA_BASE_URL: 'http://10.0.10.77:11434',
      OLLAMA_MODEL: 'env-model',
    });

    expect(res).toEqual({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      source: 'db',
    });
  });

  test('liefert none wenn weder DB noch ENV gesetzt sind', async () => {
    const repo = createSettingsRepository();
    await repo.set('ollamaBaseUrl', '');
    await repo.set('ollamaModel', '');
    const res = await resolveOllamaConnection(repo, {});
    expect(res).toEqual({
      baseUrl: '',
      model: '',
      source: 'none',
    });
  });
});
