import { describe, expect, it } from 'vitest';
import { getOllamaUiState } from './kiStatusModel';

describe('getOllamaUiState', () => {
  it('ohne URL oder Modell -> nicht konfiguriert', () => {
    expect(getOllamaUiState({ baseUrl: '', model: '', reachable: null })).toBe('not_configured');
    expect(getOllamaUiState({ baseUrl: 'http://10.0.10.77:11434', model: '', reachable: true })).toBe('not_configured');
  });

  it('mit URL und Modell, aber ohne Reachability -> konfiguriert', () => {
    expect(getOllamaUiState({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      reachable: null,
    })).toBe('configured');
  });

  it('mit URL und Modell und Reachability=true -> erreichbar', () => {
    expect(getOllamaUiState({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      reachable: true,
    })).toBe('reachable');
  });

  it('mit erreichbarem Host aber fehlendem Modell -> model_missing', () => {
    expect(getOllamaUiState({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      reachable: true,
      modelAvailable: false,
    })).toBe('model_missing');
  });

  it('mit URL und Modell und Reachability=false -> offline', () => {
    expect(getOllamaUiState({
      baseUrl: 'http://10.0.10.77:11434',
      model: 'llama3.2:3b',
      reachable: false,
    })).toBe('offline');
  });
});
