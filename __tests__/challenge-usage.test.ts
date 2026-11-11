import {getChallengeUsage} from '../src/challenge/usage';
import {ChallengeCall} from '../src/challenge/types';
import {ModelCall} from '../src/types';
import {parseUsage} from '../src/services/usage';

function call(patch: Partial<ModelCall> = {}): ModelCall {
  return {
    id: 'call_1',
    operation: 'response',
    model: 'test-model',
    status: 'completed',
    startedAt: '2026-11-11T01:00:00.000Z',
    finishedAt: '2026-11-11T01:00:01.000Z',
    durationMs: 1000,
    responseId: null,
    httpStatus: 200,
    measuredInputTokens: null,
    rawUsageJson: null,
    ...parseUsage(undefined),
    ...patch,
  };
}

test('跨阶段累计全部重试消耗，缓存及思考分项不会重复加入合计', () => {
  const records: ChallengeCall[] = [
    {
      stage: 'analysis',
      call: call({
        ...parseUsage({
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: {cached_tokens: 60},
          output_tokens_details: {reasoning_tokens: 5},
        }),
      }),
    },
    {
      stage: 'generation',
      call: call({
        id: 'call_2',
        status: 'incomplete',
        ...parseUsage({input_tokens: 200, output_tokens: 40}),
      }),
    },
    {
      stage: 'generation',
      call: call({
        id: 'call_3',
        ...parseUsage({input_tokens: 150, output_tokens: 30}),
      }),
    },
    {
      stage: 'review',
      call: call({
        id: 'call_4',
        status: 'failed',
        ...parseUsage({input_tokens: 10, output_tokens: 0}),
      }),
    },
    {stage: 'repair', call: call({id: 'call_5', status: 'running'})},
  ];
  const usage = getChallengeUsage(records);
  expect(usage.total).toMatchObject({
    callCount: 5,
    failedCount: 2,
    runningCount: 1,
    inputTokens: 460,
    outputTokens: 90,
    totalTokens: 550,
    cacheReadTokens: 60,
    reasoningTokens: 5,
    cacheWriteTokens: null,
  });
  expect(usage.total.missing).toMatchObject({
    inputTokens: 1,
    totalTokens: 1,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
  });
  expect(usage.stages.generation).toMatchObject({
    callCount: 2,
    totalTokens: 420,
    failedCount: 1,
  });
  expect(usage.stages.repair).toMatchObject({
    callCount: 1,
    totalTokens: null,
    runningCount: 1,
  });
});

test('同一请求的运行与完成快照只计一次，不会漏掉另一次重试', () => {
  const usage = getChallengeUsage([
    {stage: 'analysis', call: call({status: 'running'})},
    {
      stage: 'analysis',
      call: call({...parseUsage({input_tokens: 12, output_tokens: 3})}),
    },
    {
      stage: 'analysis',
      call: call({
        id: 'retry',
        ...parseUsage({input_tokens: 10, output_tokens: 5}),
      }),
    },
  ]);
  expect(usage.total).toMatchObject({
    callCount: 2,
    totalTokens: 30,
    runningCount: 0,
  });
  expect(usage.calls).toHaveLength(2);
  expect(usage.calls[0].status).toBe('completed');
});

test('输入计数请求只展示测量值，不计入生成消耗和缺失次数', () => {
  const count = {
    stage: 'analysis' as const,
    call: call({
      id: 'count',
      operation: 'count',
      measuredInputTokens: 9000,
      ...parseUsage({input_tokens: 9000, output_tokens: 0}),
    }),
  };
  const usage = getChallengeUsage([
    count,
    {
      stage: 'analysis',
      call: call({...parseUsage({input_tokens: 10, output_tokens: 5})}),
    },
  ]);
  expect(usage.total).toMatchObject({
    callCount: 2,
    countCallCount: 1,
    totalTokens: 15,
    inputTokens: 10,
  });
  expect(usage.total.missing.inputTokens).toBe(0);
  expect(
    usage.calls.find(value => value.id === 'count')?.measuredInputTokens,
  ).toBe(9000);
  expect(getChallengeUsage([count]).total).toMatchObject({
    totalTokens: null,
    missing: expect.objectContaining({totalTokens: 0}),
  });
});

test('没有请求、未返回消耗和真实零值明确区分，中断计入未完成次数', () => {
  expect(getChallengeUsage([]).total).toMatchObject({
    callCount: 0,
    inputTokens: 0,
    totalTokens: 0,
  });
  const interrupted = getChallengeUsage([
    {stage: 'analysis', call: call({status: 'interrupted'})},
  ]);
  expect(interrupted.total).toMatchObject({
    inputTokens: null,
    totalTokens: null,
    failedCount: 1,
    missing: expect.objectContaining({totalTokens: 1}),
  });
  const zero = getChallengeUsage([
    {
      stage: 'analysis',
      call: call({...parseUsage({input_tokens: 0, output_tokens: 0})}),
    },
  ]);
  expect(zero.total).toMatchObject({
    inputTokens: 0,
    totalTokens: 0,
    missing: expect.objectContaining({totalTokens: 0}),
  });
});
