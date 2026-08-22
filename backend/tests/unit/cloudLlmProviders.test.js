'use strict';

// Cloud-LLM-Provider (Anthropic/OpenAI/Google): korrekter API-Call, Key-Handling,
// und Wiederverwendung der gemeinsamen Parse-Logik (geerbt von der Analyse-Basis).

const { AnthropicLlmProvider } = require('../../src/agents/providers/AnthropicLlmProvider');
const { OpenAiLlmProvider }    = require('../../src/agents/providers/OpenAiLlmProvider');
const { GoogleAiLlmProvider }  = require('../../src/agents/providers/GoogleAiLlmProvider');

function fakeHttp(responder) {
  return { calls: [], async request(url, opts) { this.calls.push({ url, opts }); return responder(url, opts); } };
}
const JSON_REPLY = '{"proposal":"Host isolieren","rationale":"C2-Verdacht","confidence":0.8}';
const TICKET = { id: 't1', title: 'PowerShell -enc' };

describe('AnthropicLlmProvider', () => {
  it('ruft die Messages-API mit x-api-key + version und parst content[].text', async () => {
    const http = fakeHttp(() => ({ status: 200, data: { content: [{ type: 'text', text: JSON_REPLY }] } }));
    const p = new AnthropicLlmProvider({ apiKey: 'sk-ant-test', model: 'claude-x', http });
    const out = await p.propose({ ticket: TICKET, kind: 'triage' });

    expect(http.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(http.calls[0].opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(http.calls[0].opts.headers['anthropic-version']).toBeTruthy();
    expect(http.calls[0].opts.body.model).toBe('claude-x');
    expect(http.calls[0].opts.body.messages[0].content).toContain('PowerShell');
    expect(out.proposal).toBe('Host isolieren');
    expect(out.confidence).toBe(0.8);
    expect(p.name).toBe('anthropic:claude-x');
  });

  it('sendet keine Sampling-Parameter, damit neuere Claude-Modelle nicht mit HTTP 400 ablehnen', async () => {
    const http = fakeHttp(() => ({ status: 200, data: { content: [{ type: 'text', text: JSON_REPLY }] } }));
    const p = new AnthropicLlmProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      http,
      params: { temperature: 0.4, topP: 0.9 },
    });

    await p.propose({ ticket: TICKET, kind: 'triage' });

    expect(http.calls[0].opts.body.temperature).toBeUndefined();
    expect(http.calls[0].opts.body.top_p).toBeUndefined();
    expect(http.calls[0].opts.body.max_tokens).toBeTruthy();
  });

  it('nutzt ohne UI-Override genug Output-Budget für das SOC-JSON-Schema', async () => {
    const saved = process.env.ANTHROPIC_MAX_TOKENS;
    delete process.env.ANTHROPIC_MAX_TOKENS;
    const http = fakeHttp(() => ({ status: 200, data: { content: [{ type: 'text', text: JSON_REPLY }] } }));
    const p = new AnthropicLlmProvider({ apiKey: 'sk-ant-test', model: 'claude-x', http });

    await p.propose({ ticket: TICKET, kind: 'triage' });

    expect(http.calls[0].opts.body.max_tokens).toBe(6000);
    if (saved === undefined) delete process.env.ANTHROPIC_MAX_TOKENS; else process.env.ANTHROPIC_MAX_TOKENS = saved;
  });

  it('wirft (misconfigured) ohne API-Key', async () => {
    const http = fakeHttp(() => ({ status: 200, data: {} }));
    const p = new AnthropicLlmProvider({ apiKey: '', model: 'claude-x', http });
    await expect(p.propose({ ticket: TICKET, kind: 'triage' })).rejects.toThrow(/Anthropic/i);
  });
});

describe('OpenAiLlmProvider', () => {
  it('ruft chat/completions mit Bearer + json_object und parst choices[].message.content', async () => {
    const http = fakeHttp(() => ({ status: 200, data: { choices: [{ message: { content: JSON_REPLY } }] } }));
    const p = new OpenAiLlmProvider({ apiKey: 'sk-oai', model: 'gpt-x', http });
    const out = await p.propose({ ticket: TICKET, kind: 'triage' });

    expect(http.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(http.calls[0].opts.headers.Authorization).toBe('Bearer sk-oai');
    expect(http.calls[0].opts.body.response_format).toEqual({ type: 'json_object' });
    expect(out.proposal).toBe('Host isolieren');
    expect(p.name).toBe('openai:gpt-x');
  });

  it('wirft ohne API-Key', async () => {
    const p = new OpenAiLlmProvider({ apiKey: '', http: fakeHttp(() => ({ status: 200, data: {} })) });
    await expect(p.propose({ ticket: TICKET, kind: 'triage' })).rejects.toThrow(/OpenAI/i);
  });
});

describe('GoogleAiLlmProvider', () => {
  it('ruft generateContent mit x-goog-api-key (Key NICHT in der URL) und parst candidates', async () => {
    const http = fakeHttp(() => ({ status: 200, data: { candidates: [{ content: { parts: [{ text: JSON_REPLY }] } }] } }));
    const p = new GoogleAiLlmProvider({ apiKey: 'goog-key', model: 'gemini-x', http });
    const out = await p.propose({ ticket: TICKET, kind: 'triage' });

    expect(http.calls[0].url).toContain('gemini-x:generateContent');
    expect(http.calls[0].url).not.toContain('goog-key'); // Key nie in der URL
    expect(http.calls[0].opts.headers['x-goog-api-key']).toBe('goog-key');
    expect(out.proposal).toBe('Host isolieren');
    expect(p.name).toBe('google:gemini-x');
  });

  it('wirft ohne API-Key', async () => {
    const p = new GoogleAiLlmProvider({ apiKey: '', http: fakeHttp(() => ({ status: 200, data: {} })) });
    await expect(p.propose({ ticket: TICKET, kind: 'triage' })).rejects.toThrow(/Google/i);
  });
});

describe('llmProviderFactory', () => {
  const {
    buildProvider,
    providerAvailability,
    DynamicLlmProvider,
    loadAgentLlmConfig,
  } = require('../../src/agents/providers/llmProviderFactory');
  const { createSettingsRepository, _resetInMemoryInstance } = require('../../src/repositories/settingsRepositoryFactory');

  it('buildProvider liefert den passenden Provider-Typ', () => {
    expect(buildProvider('anthropic').name).toMatch(/^anthropic:/);
    expect(buildProvider('openai').name).toMatch(/^openai:/);
    expect(buildProvider('google').name).toMatch(/^google:/);
    expect(buildProvider('ollama').name).toMatch(/^ollama:/);
    expect(buildProvider('unknown').name).toBeDefined(); // → Stub
  });

  it('providerAvailability meldet configured nur bei gesetztem Key', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    let av = providerAvailability().find((p) => p.provider === 'anthropic');
    expect(av.requiresKey).toBe(true);
    expect(av.configured).toBe(false);

    process.env.ANTHROPIC_API_KEY = 'x';
    av = providerAvailability().find((p) => p.provider === 'anthropic');
    expect(av.configured).toBe(true);

    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;

    const ollama = providerAvailability().find((p) => p.provider === 'ollama');
    expect(ollama.requiresKey).toBe(false);
    expect(ollama.configured).toBe(true);
  });

  it('DynamicLlmProvider nutzt bei Default-Settings den Stub', async () => {
    const dyn = new DynamicLlmProvider();
    const out = await dyn.propose({ ticket: { id: 't1', title: 'x' }, kind: 'triage' });
    expect(out).toBeTruthy();
    expect(out.proposal !== undefined || out.rationale !== undefined).toBe(true);
  });

  it('interpretiert leere UI-Modellparameter als Provider-Default, nicht als 0', async () => {
    _resetInMemoryInstance();
    const repo = createSettingsRepository();
    await repo.set('agentLlmProvider', 'anthropic');
    await repo.set('llmTemperature', '');
    await repo.set('llmTopP', '');
    await repo.set('llmMaxTokens', '');

    const cfg = await loadAgentLlmConfig();

    expect(cfg.chain[0].kind).toBe('anthropic');
    expect(cfg.params).toEqual({ temperature: undefined, topP: '', maxTokens: undefined });
    expect(cfg.chain[0].params.maxTokens).toBeUndefined();
    expect(cfg.chain[0].params.temperature).toBeUndefined();
  });

  it('traegt die UI-gespeicherte Ollama-Base-URL in die Laufzeitkette ein', async () => {
    _resetInMemoryInstance();
    const repo = createSettingsRepository();
    await repo.set('agentLlmProvider', 'ollama');
    await repo.set('ollamaBaseUrl', 'http://10.0.10.77:11434');
    await repo.set('ollamaModel', 'llama3.2:3b');

    const cfg = await loadAgentLlmConfig();

    expect(cfg.chain[0].kind).toBe('ollama');
    expect(cfg.chain[0].baseUrl).toBe('http://10.0.10.77:11434');
    expect(cfg.chain[0].model).toBe('llama3.2:3b');
  });
});
