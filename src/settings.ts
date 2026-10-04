import {AppSettings} from './types';

export const REASONING_LEVELS = ['none', 'low', 'high', 'max'] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  modelName: 'deepseek-flash',
  visionModelName: 'deepseek-flash',
  reasoningEffort: 'high',
  contextWindow: 1_000_000,
  compactionThreshold: 0.8,
  maxOutputTokens: 5000,
  retryCount: 1,
  apiBaseUrl: 'https://api.deepseek.com',
  apiKey: '',
};

export function normalizeReasoningEffort(
  value: unknown,
): AppSettings['reasoningEffort'] {
  return (
    REASONING_LEVELS.find(level => level === value) ??
    DEFAULT_SETTINGS.reasoningEffort
  );
}

// Used once when upgrading an existing installation. Preserve custom values.
export function legacyDefaultChanges(stored: Record<string, string>) {
  const previousDefaults = {
    modelName: 'gpt-5.5',
    visionModelName: 'gpt-4.1-mini',
    apiBaseUrl: 'https://api.openai.com/v1',
    contextWindow: '128000',
    reasoningEffort: 'medium',
  };
  const changes: Record<string, string> = {};
  for (const key of Object.keys(
    previousDefaults,
  ) as (keyof typeof previousDefaults)[]) {
    if (stored[key] === previousDefaults[key]) {
      changes[key] = String(DEFAULT_SETTINGS[key]);
    }
  }
  return changes;
}
