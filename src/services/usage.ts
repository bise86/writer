import {ModelCall, ModelOperation, TokenUsage} from '../types';

export const TOKEN_FIELDS = {
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  totalTokens: 'total_tokens',
  cacheReadTokens: 'cache_read_tokens',
  cacheWriteTokens: 'cache_write_tokens',
  cacheMissTokens: 'cache_miss_tokens',
  reasoningTokens: 'reasoning_tokens',
} as const;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function tokens(...values: unknown[]): number | null {
  return (
    (values.find(
      value =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    ) as number | undefined) ?? null
  );
}
/** Missing data is unknown, never a measured zero. Cache misses are not writes. */
export function parseUsage(value: unknown): TokenUsage {
  const usage = object(value);
  const input = object(usage.input_tokens_details);
  const prompt = object(usage.prompt_tokens_details);
  const output = object(usage.output_tokens_details);
  const completion = object(usage.completion_tokens_details);
  const inputTokens = tokens(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = tokens(usage.output_tokens, usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: tokens(
      usage.total_tokens,
      inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null,
    ),
    cacheReadTokens: tokens(
      input.cached_tokens,
      usage.prompt_cache_hit_tokens,
      prompt.cached_tokens,
      usage.cache_read_input_tokens,
    ),
    cacheWriteTokens: tokens(
      input.cache_write_tokens,
      usage.cache_write_tokens,
      usage.cache_creation_input_tokens,
      prompt.cache_write_tokens,
    ),
    cacheMissTokens: tokens(
      usage.prompt_cache_miss_tokens,
      input.cache_miss_tokens,
    ),
    reasoningTokens: tokens(
      output.reasoning_tokens,
      completion.reasoning_tokens,
    ),
  };
}

let sequence = 0;
export const newRecordId = (prefix: string) =>
  `${prefix}_${Date.now()}_${++sequence}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;

/** Persistence is outside the SDK error path: a disk error must not resend a
 * successful billable request. Write 'running' first to survive process death. */
export async function trackModelCall<T>(
  call: () => PromiseLike<T>,
  operation: ModelOperation,
  model: string,
  onCall?: (record: ModelCall) => Promise<void>,
): Promise<T> {
  if (!onCall) {
    return call();
  }
  const started = Date.now();
  const record: ModelCall = {
    ...parseUsage(undefined),
    id: newRecordId('call'),
    operation,
    model,
    status: 'running',
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    durationMs: null,
    responseId: null,
    httpStatus: null,
    measuredInputTokens: null,
    rawUsageJson: null,
  };
  const persist = async () => {
    try {
      await onCall({...record});
    } catch {
      throw new Error('模型调用统计保存失败，请检查本机存储后重试');
    }
  };
  await persist();
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = await call();
  } catch (requestError) {
    failure = requestError;
    failed = true;
  }
  const response = object(result);
  const error = object(failure);
  const rawUsage = response.usage ?? error.usage ?? object(error.error).usage;
  Object.assign(record, parseUsage(rawUsage), {
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - started),
    status:
      failed ||
      response.error ||
      response.status === 'failed' ||
      response.status === 'cancelled'
        ? 'failed'
        : response.status === 'incomplete'
        ? 'incomplete'
        : 'completed',
    responseId: typeof response.id === 'string' ? response.id : null,
    httpStatus: failed ? tokens(error.status) : 200,
    // A count endpoint reports the size of a proposed input, not billed usage.
    measuredInputTokens:
      operation === 'count' ? tokens(response.input_tokens) : null,
    rawUsageJson:
      rawUsage && typeof rawUsage === 'object'
        ? JSON.stringify(rawUsage)
        : null,
  });
  await persist();
  if (failed) {
    throw failure;
  }
  return result as T;
}
