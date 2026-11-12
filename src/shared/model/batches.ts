import {checkCancelled, ModelOutputTruncatedError} from './request';
import {ContextBudgetError} from './context';

export type AdaptiveBatchLimit = 'input' | 'output';

/** Split explicit input/output limits. Completed batches are never replayed. */
export async function runAdaptiveBatches<T>(
  items: readonly T[],
  size: number,
  run: (batch: T[]) => Promise<void>,
  options: {
    signal?: AbortSignal;
    onSplit?: (
      batch: T[],
      limit?: AdaptiveBatchLimit,
    ) => void | Promise<void>;
  } = {},
): Promise<void> {
  const visit = async (batch: T[], retry = 0): Promise<void> => {
    checkCancelled(options.signal);
    try {
      await run(batch);
    } catch (error) {
      checkCancelled(options.signal);
      const inputLimit = error instanceof ContextBudgetError;
      if (!inputLimit && !(error instanceof ModelOutputTruncatedError)) {
        throw error;
      }
      if (batch.length === 1) {
        // Repeating the same single input cannot reduce its context footprint.
        if (!inputLimit && retry === 0) {
          await options.onSplit?.(batch, 'output');
          return visit(batch, 1);
        }
        throw error;
      }
      await options.onSplit?.(batch, inputLimit ? 'input' : 'output');
      const middle = Math.ceil(batch.length / 2);
      await visit(batch.slice(0, middle));
      await visit(batch.slice(middle));
    }
  };
  const batchSize = Math.max(1, Math.floor(size) || 1);
  for (let index = 0; index < items.length; index += batchSize) {
    await visit(items.slice(index, index + batchSize));
  }
}
