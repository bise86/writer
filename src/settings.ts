import {AppSettings} from './types';

export const REASONING_LEVELS = ['none', 'low', 'high', 'max'] as const;
export const OUTPUT_TOKEN_OPTIONS = [4000, 8000, 16000, 32000, 64000] as const;
export const ROUNDTABLE_OPTIONS = [0, 3, 5] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  modelName: 'deepseek-flash',
  reasoningEffort: 'high',
  contextWindow: 1_000_000,
  compactionThreshold: 0.8,
  maxOutputTokens: 32000,
  retryCount: 1,
  roundtableSize: 0,
  apiBaseUrl: 'https://api.deepseek.com',
  // Credentials belong to the device owner and must never be shipped in the
  // app bundle or source repository.
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

/** TextInput values can be strings at runtime. Validate before saving or calling
 * an API so NaN, fractions and negative budgets cannot bypass context checks. */
export function validateSettings(settings: AppSettings): AppSettings {
  function integer(value: unknown, label: string, minimum: number) {
    if (String(value).trim() === '') {
      throw new Error(`${label}不能为空`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new Error(`${label}必须是大于等于 ${minimum} 的整数`);
    }
    return number;
  }
  const contextWindow = integer(settings.contextWindow, '上下文大小', 1024);
  const maxOutputTokens = integer(settings.maxOutputTokens, '输出长度', 1);
  const retryCount = integer(settings.retryCount, '重试次数', 0);
  const roundtableSize = integer(
    settings.roundtableSize ?? 0,
    '圆桌评审人数',
    0,
  );
  if (!ROUNDTABLE_OPTIONS.some(value => value === roundtableSize)) {
    throw new Error('圆桌评审人数只能为 0、3 或 5');
  }
  const compactionThreshold = Number(settings.compactionThreshold);
  if (
    !Number.isFinite(compactionThreshold) ||
    compactionThreshold <= 0 ||
    compactionThreshold >= 1
  ) {
    throw new Error('压缩阈值必须大于 0% 且小于 100%');
  }
  if (Math.floor(contextWindow * compactionThreshold) < 1) {
    throw new Error('压缩阈值过小，至少需要对应 1 token');
  }
  const safetyReserve = Math.max(256, Math.ceil(contextWindow * 0.02));
  if (maxOutputTokens + safetyReserve >= contextWindow) {
    throw new Error(
      `输出长度必须小于上下文大小，并留下 ${safetyReserve} token 的安全余量和输入空间`,
    );
  }
  const apiBaseUrl = settings.apiBaseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/i.test(apiBaseUrl)) {
    throw new Error(
      'API 地址必须是有效的 HTTP 或 HTTPS 地址，不能包含密钥或查询参数',
    );
  }
  const modelName = settings.modelName.trim();
  if (!modelName) {
    throw new Error('模型名称不能为空');
  }
  return {
    apiKey: settings.apiKey,
    apiBaseUrl,
    modelName,
    contextWindow,
    maxOutputTokens,
    retryCount,
    roundtableSize: roundtableSize as AppSettings['roundtableSize'],
    compactionThreshold,
    reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort),
  };
}

// Used once when upgrading an existing installation. Preserve custom values.
export function legacyDefaultChanges(stored: Record<string, string>) {
  const previousDefaults = {
    modelName: 'gpt-5.5',
    apiBaseUrl: 'https://api.openai.com/v1',
    contextWindow: '128000',
    reasoningEffort: 'medium',
    apiKey: '',
  };
  const changes: Record<string, string> = {};
  const untouchedProvider =
    stored.apiBaseUrl === previousDefaults.apiBaseUrl &&
    stored.modelName === previousDefaults.modelName;
  for (const key of Object.keys(
    previousDefaults,
  ) as (keyof typeof previousDefaults)[]) {
    // A customized model or endpoint is one coherent provider configuration.
    // Do not pair an existing custom model with a different default provider.
    if (key !== 'reasoningEffort' && key !== 'apiKey' && !untouchedProvider) {
      continue;
    }
    if (stored[key] === previousDefaults[key]) {
      changes[key] = String(DEFAULT_SETTINGS[key]);
    }
  }
  return changes;
}
