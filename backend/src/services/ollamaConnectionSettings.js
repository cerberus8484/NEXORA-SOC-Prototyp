'use strict';

const _trim = (value) => (typeof value === 'string' ? value.trim() : '');

async function resolveOllamaConnection(settingsRepo, env = process.env) {
  const [storedBaseUrlRaw, storedModelRaw] = await Promise.all([
    settingsRepo.get('ollamaBaseUrl'),
    settingsRepo.get('ollamaModel'),
  ]);

  const storedBaseUrl = _trim(storedBaseUrlRaw);
  const storedModel = _trim(storedModelRaw);
  const envBaseUrl = _trim(env.OLLAMA_BASE_URL);
  const envModel = _trim(env.OLLAMA_MODEL);

  return {
    baseUrl: storedBaseUrl || envBaseUrl,
    model: storedModel || envModel,
    source: storedBaseUrl || storedModel ? 'db' : (envBaseUrl || envModel ? 'env' : 'none'),
  };
}

module.exports = { resolveOllamaConnection };
