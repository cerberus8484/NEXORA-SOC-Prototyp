export type OllamaUiState = 'not_configured' | 'configured' | 'reachable' | 'offline' | 'model_missing';

export function getOllamaUiState({
  baseUrl,
  model,
  reachable,
  modelAvailable,
}: {
  baseUrl: string;
  model: string;
  reachable: boolean | null;
  modelAvailable?: boolean | null;
}): OllamaUiState {
  const hasBaseUrl = baseUrl.trim().length > 0;
  const hasModel = model.trim().length > 0;

  if (!hasBaseUrl || !hasModel) return 'not_configured';
  if (reachable === true && modelAvailable === false) return 'model_missing';
  if (reachable === true) return 'reachable';
  if (reachable === false) return 'offline';
  return 'configured';
}
