import type {Response} from 'openai/resources/responses/responses';
import {RequestProgress} from './context';

export function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number(error.status) || undefined
    : undefined;
}

function retryable(error: unknown) {
  const status = statusOf(error);
  if (status !== undefined) {
    return (
      [408, 409, 429].includes(status) ||
      (status >= 500 && status < 600 && status !== 501)
    );
  }
  // Do not retry programming errors or local validation failures.
  return (
    error instanceof Error &&
    ['APIConnectionError', 'APIConnectionTimeoutError'].includes(error.name)
  );
}

export async function requestWithRetry<T>(
  call: () => PromiseLike<T>,
  retries: number,
  label: string,
  onProgress?: RequestProgress,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= retries || !retryable(error)) {
        throw error;
      }
      await onProgress?.(
        `${label}失败，正在重试 ${attempt + 1}/${retries}`,
        attempt + 1,
      );
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)),
      );
    }
  }
}

/** A 200 HTTP response may still be failed, truncated, refused or empty. */
export function completedText(response: Response) {
  if (response.status !== 'completed') {
    if (response.incomplete_details?.reason === 'max_output_tokens') {
      throw new Error('模型输出被截断，请增加输出长度或降低思考级别后重试');
    }
    throw new Error(
      `模型未完成请求（${response.status || '未知状态'}），请重试`,
    );
  }
  if (response.error) {
    throw new Error('模型返回了错误，未保存识别或评分结果');
  }
  if (
    response.output?.some(
      item =>
        item.type === 'message' &&
        item.content.some(part => part.type === 'refusal'),
    )
  ) {
    throw new Error('模型未能处理该内容，未保存识别或评分结果');
  }
  const text = response.output_text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('模型返回空结果，请检查输出长度、思考级别和模型能力后重试');
  }
  return text;
}
