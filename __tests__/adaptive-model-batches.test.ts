import {runAdaptiveBatches} from '../src/shared/model/batches';
import {ModelOutputTruncatedError} from '../src/shared/model/request';

test('截断只拆当前批，已经完成的批次不重跑', async () => {
  const completed: number[] = [];
  const run = jest.fn(async (batch: number[]) => {
    if (batch.length === 2 && batch[0] === 3) {
      throw new ModelOutputTruncatedError();
    }
    completed.push(...batch);
  });
  await runAdaptiveBatches([1, 2, 3, 4], 2, run);
  expect(run.mock.calls.map(([batch]) => batch)).toEqual([
    [1, 2],
    [3, 4],
    [3],
    [4],
  ]);
  expect(completed).toEqual([1, 2, 3, 4]);
});

test('单题截断仅重试一次，持续超限不使用任何不完整结果', async () => {
  const run = jest.fn(async (_batch: string[]) => {
    throw new ModelOutputTruncatedError();
  });
  await expect(runAdaptiveBatches(['q1', 'q2'], 1, run)).rejects.toBeInstanceOf(
    ModelOutputTruncatedError,
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.every(([batch]) => batch[0] === 'q1')).toBe(true);
});

test('单题第二次完整返回时继续后续题，不改变输出预算或伪造片段', async () => {
  let calls = 0;
  const completed: string[] = [];
  await runAdaptiveBatches(['q1', 'q2'], 1, async batch => {
    if (calls++ === 0) {
      throw new ModelOutputTruncatedError();
    }
    completed.push(...batch);
  });
  expect(calls).toBe(3);
  expect(completed).toEqual(['q1', 'q2']);
});

test.each([
  Object.assign(new Error('auth'), {status: 401}),
  new SyntaxError('invalid JSON'),
])('认证或格式错误不当作输出截断拆批：%s', async error => {
  const run = jest.fn(async () => {
    throw error;
  });
  await expect(runAdaptiveBatches([1, 2], 2, run)).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
});

test('停止后不再发送新批次，已完成批次保留', async () => {
  const controller = new AbortController();
  const completed: number[] = [];
  const run = jest.fn(async (batch: number[]) => {
    completed.push(...batch);
    controller.abort();
  });
  await expect(
    runAdaptiveBatches([1, 2, 3], 1, run, {signal: controller.signal}),
  ).rejects.toThrow('停止');
  expect(completed).toEqual([1]);
  expect(run).toHaveBeenCalledTimes(1);
});
