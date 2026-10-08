import type {
  ResponseFormatTextConfig,
  ResponseInput,
} from 'openai/resources/responses/responses';
import {AppSettings} from '../types';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ModelInput = string | ResponseInput;
export type RequestProgress = (
  detail: string,
  retryCount?: number,
) => void | Promise<void>;

export interface RequestOptions {
  signal?: AbortSignal;
  // Only explicitly supplied historical text is eligible for summarization.
  // The current input and instructions (including the rubric) are immutable.
  history?: HistoryMessage[];
  onProgress?: RequestProgress;
  textFormat?: ResponseFormatTextConfig;
}

export class ContextBudgetError extends Error {}

/** Byte-level upper estimate for text, intentionally conservative for Chinese.
 * It avoids treating four Chinese characters as one token. It is not a tokenizer. */
export function estimateTextTokens(text: string) {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

// Image encoding bytes are not text tokens. Reserve a conservative image budget;
// providers still enforce their model's actual visual token and size limits.
export const IMAGE_TOKEN_RESERVE = 32768;

export function estimateInputTokens(input: ModelInput): number {
  if (typeof input === 'string') {
    return estimateTextTokens(input) + 16;
  }
  return input.reduce((sum, item) => {
    if ('type' in item && item.type === 'compaction') {
      throw new ContextBudgetError(
        '原生压缩结果必须由服务端计数，不能把加密数据当作文字估算',
      );
    }
    if (!('role' in item) || !('content' in item)) {
      throw new ContextBudgetError(
        '当前作文流程仅接受文字消息和图片，不能忽略未知输入类型',
      );
    }
    if (typeof item.content === 'string') {
      return sum + 16 + estimateTextTokens(item.content);
    }
    let total = sum + 16;
    for (const part of item.content) {
      if (part.type === 'input_text' || part.type === 'output_text') {
        total += estimateTextTokens(part.text);
      } else if (part.type === 'input_image') {
        total += IMAGE_TOKEN_RESERVE;
      } else {
        throw new ContextBudgetError('当前作文流程不支持此输入内容类型');
      }
    }
    return total;
  }, 0);
}

export function inputItems(input: ModelInput): ResponseInput {
  return typeof input === 'string' ? [{role: 'user', content: input}] : input;
}

export function contextBudget(settings: AppSettings) {
  const reserve = Math.max(256, Math.ceil(settings.contextWindow * 0.02));
  const inputLimit =
    settings.contextWindow - settings.maxOutputTokens - reserve;
  if (inputLimit <= 0) {
    throw new ContextBudgetError(
      '上下文不足以容纳输出及安全余量，请调整上下文或输出长度',
    );
  }
  return {
    inputLimit,
    // Respect both the selected percentage and the reserved output budget.
    compactThreshold: Math.min(
      Math.floor(settings.contextWindow * settings.compactionThreshold),
      inputLimit,
    ),
  };
}

export function usesOpenAIContext(settings: AppSettings, model: string) {
  // Do not infer a third-party endpoint's capabilities just from its model name.
  return (
    /^https:\/\/api\.openai\.com(?::443)?(?:\/|$)/i.test(settings.apiBaseUrl) &&
    /^(gpt-|o\d)/i.test(model)
  );
}

export function validateHistory(history: HistoryMessage[]) {
  for (const message of history) {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      throw new ContextBudgetError(
        '可压缩历史只能包含 user/assistant 文字消息',
      );
    }
  }
}

/** Split on Unicode code points, never truncate a chunk or split a surrogate. */
export function splitTextByBudget(text: string, budget: number): string[] {
  if (budget < 4) {
    throw new ContextBudgetError('可用于摘要的上下文空间不足');
  }
  const chunks: string[] = [];
  let chunk = '';
  let count = 0;
  for (const char of text) {
    const size = estimateTextTokens(char);
    if (count + size > budget) {
      chunks.push(chunk);
      chunk = '';
      count = 0;
    }
    chunk += char;
    count += size;
  }
  if (chunk) {
    chunks.push(chunk);
  }
  return chunks;
}
