import {runAdaptiveBatches} from '../src/shared/model/batches';
import {ModelOutputTruncatedError} from '../src/shared/model/request';
import {ContextBudgetError} from '../src/shared/model/context';

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

test('输入上下文超限仅拆当前批，保留原数据和已完成批次', async () => {
  const items = [
    {id: 'q1', text: '原题一与必需规则'},
    {id: 'q2', text: '原题二与必需规则'},
    {id: 'q3', text: '原题三与必需规则'},
    {id: 'q4', text: '原题四与必需规则'},
  ];
  const completed: typeof items = [];
  const onSplit = jest.fn();
  const run = jest.fn(async (batch: typeof items) => {
    if (batch.length > 1 && batch[0].id === 'q3') {
      throw new ContextBudgetError('输入超过可用上下文');
    }
    completed.push(...batch);
  });
  await runAdaptiveBatches(items, 2, run, {onSplit});
  expect(run.mock.calls.map(([batch]) => batch.map(item => item.id))).toEqual(
    [['q1', 'q2'], ['q3', 'q4'], ['q3'], ['q4']],
  );
  expect(onSplit).toHaveBeenCalledWith(items.slice(2), 'input');
  expect(completed).toEqual(items);
  completed.forEach((item, index) => expect(item).toBe(items[index]));
});

test('单题输入上下文超限不重复收费请求，也不处理后续题', async () => {
  const failure = new ContextBudgetError('单题必需输入仍超限');
  const onSplit = jest.fn();
  const run = jest.fn(async (_batch: string[]) => {
    throw failure;
  });
  await expect(
    runAdaptiveBatches(['q1', 'q2'], 1, run, {onSplit}),
  ).rejects.toBe(failure);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(['q1']);
  expect(onSplit).not.toHaveBeenCalled();
});

test('输入批次拆小后遇到单题输出截断，仍只重试当前单题一次', async () => {
  const onSplit = jest.fn();
  const completed: string[] = [];
  let firstQuestionAttempts = 0;
  const run = jest.fn(async (batch: string[]) => {
    if (batch.length > 1) {
      throw new ContextBudgetError('本批输入超限');
    }
    if (batch[0] === 'q1' && firstQuestionAttempts++ === 0) {
      throw new ModelOutputTruncatedError();
    }
    completed.push(...batch);
  });
  await runAdaptiveBatches(['q1', 'q2'], 2, run, {onSplit});
  expect(run.mock.calls.map(([batch]) => batch)).toEqual([
    ['q1', 'q2'],
    ['q1'],
    ['q1'],
    ['q2'],
  ]);
  expect(onSplit.mock.calls).toEqual([
    [['q1', 'q2'], 'input'],
    [['q1'], 'output'],
  ]);
  expect(completed).toEqual(['q1', 'q2']);
});

test('拆批后单题输入仍超限立即停止，已成功批次不会重跑', async () => {
  const failure = new ContextBudgetError('第三题原文无法容纳');
  const completed: number[] = [];
  const run = jest.fn(async (batch: number[]) => {
    if (batch.includes(3)) {
      throw failure;
    }
    completed.push(...batch);
  });
  await expect(runAdaptiveBatches([1, 2, 3, 4], 2, run)).rejects.toBe(failure);
  expect(run.mock.calls.map(([batch]) => batch)).toEqual([
    [1, 2],
    [3, 4],
    [3],
  ]);
  expect(completed).toEqual([1, 2]);
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
