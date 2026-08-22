'use strict';

const { probeOllamaConnection } = require('../../src/services/ollamaConnectionProbe');

describe('probeOllamaConnection', () => {
  test('liefert not_configured ohne Base-URL', async () => {
    const res = await probeOllamaConnection({});
    expect(res).toMatchObject({
      reachable: false,
      modelAvailable: null,
      reason: 'not_configured',
    });
  });

  test('meldet erreichbaren Ollama-Host mit vorhandenem Modell', async () => {
    const httpClient = {
      request: jest.fn().mockResolvedValue({
        data: { models: [{ name: 'llama3.2:3b' }, { name: 'nomic-embed-text' }] },
      }),
    };

    const res = await probeOllamaConnection({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      requireModel: true,
      httpClient,
    });

    expect(httpClient.request).toHaveBeenCalledWith('http://10.0.10.77:11434/api/tags', { method: 'GET' });
    expect(res).toMatchObject({
      reachable: true,
      modelAvailable: true,
      reason: 'ok',
      message: 'Ollama erreichbar',
      models: ['llama3.2:3b', 'nomic-embed-text'],
    });
  });

  test('unterscheidet zwischen erreichbarem Host und fehlendem Modell', async () => {
    const httpClient = {
      request: jest.fn().mockResolvedValue({
        data: { models: [{ name: 'llama3.1:8b' }] },
      }),
    };

    const res = await probeOllamaConnection({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      requireModel: true,
      httpClient,
    });

    expect(res).toMatchObject({
      reachable: true,
      modelAvailable: false,
      reason: 'model_missing',
      models: ['llama3.1:8b'],
    });
    expect(res.message).toMatch(/nicht geladen/i);
  });
});
