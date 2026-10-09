import {parseUsage, trackModelCall} from '../src/services/usage';
import {ModelCall} from '../src/types';

test('Responses 返回的缓存读写、思考 token 按原值保存，不重复计入总量', () => {
  expect(
    parseUsage({
      input_tokens: 100,
      output_tokens: 30,
      total_tokens: 130,
      input_tokens_details: {cached_tokens: 60, cache_write_tokens: 25},
      output_tokens_details: {reasoning_tokens: 10},
    }),
  ).toEqual({
    inputTokens: 100,
    outputTokens: 30,
    totalTokens: 130,
    cacheReadTokens: 60,
    cacheWriteTokens: 25,
    cacheMissTokens: null,
    reasoningTokens: 10,
  });
});
test('兼容 DeepSeek 的命中/未命中；不把未命中伪造为写入量', () => {
  expect(
    parseUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_cache_hit_tokens: 70,
      prompt_cache_miss_tokens: 30,
    }),
  ).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 70,
    cacheMissTokens: 30,
    cacheWriteTokens: null,
  });
});
test('未知、无效及真实零值明确区分，不用估算值替代消耗', () => {
  expect(parseUsage(undefined).inputTokens).toBeNull();
  expect(
    parseUsage({input_tokens: -1, output_tokens: '20', total_tokens: NaN})
      .totalTokens,
  ).toBeNull();
  expect(
    parseUsage({
      input_tokens: 0,
      output_tokens: 0,
      input_tokens_details: {cached_tokens: 0, cache_write_tokens: 0},
    }),
  ).toMatchObject({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
});
test('每次实际请求在开始前记录，截断也保留已消耗的 token', async () => {
  const records: ModelCall[] = [];
  const onCall = jest.fn(async call => {
    records.push(call);
  });
  await trackModelCall(
    async () => {
      expect(records[0].status).toBe('running');
      return {
        status: 'incomplete',
        id: 'response-1',
        usage: {input_tokens: 10, output_tokens: 20},
      };
    },
    'response',
    'model',
    onCall,
  );
  expect(records).toHaveLength(2);
  expect(records[1]).toMatchObject({
    id: records[0].id,
    status: 'incomplete',
    inputTokens: 10,
    outputTokens: 20,
  });
  expect(records[1].finishedAt).not.toBeNull();
  expect(JSON.parse(records[1].rawUsageJson!)).toEqual({
    input_tokens: 10,
    output_tokens: 20,
  });
});
test('网络错误记录一次失败；有服务端 usage 则照实保存', async () => {
  const onCall = jest.fn(async (_call: ModelCall) => {});
  const error = Object.assign(new Error('timeout'), {
    status: 503,
    usage: {input_tokens: 25},
  });
  await expect(
    trackModelCall(
      async () => {
        throw error;
      },
      'response',
      'model',
      onCall,
    ),
  ).rejects.toBe(error);
  expect(onCall.mock.calls[1][0]).toMatchObject({
    status: 'failed',
    httpStatus: 503,
    inputTokens: 25,
    outputTokens: null,
  });
});
test('记录失败不重发模型请求，写前失败时不发送请求', async () => {
  const call = jest.fn(async () => ({status: 'completed'}));
  const onCall = jest.fn().mockRejectedValueOnce(new Error('disk full'));
  await expect(
    trackModelCall(call, 'response', 'model', onCall),
  ).rejects.toThrow('统计保存失败');
  expect(call).not.toHaveBeenCalled();
  onCall
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('disk full'));
  await expect(
    trackModelCall(call, 'response', 'model', onCall),
  ).rejects.toThrow('统计保存失败');
  expect(call).toHaveBeenCalledTimes(1);
});
test('计数接口的测量值不会冒充生成的输入消耗', async () => {
  const onCall = jest.fn(async (_call: ModelCall) => {});
  await trackModelCall(
    async () => ({input_tokens: 100000}),
    'count',
    'model',
    onCall,
  );
  expect(onCall.mock.calls[1][0]).toMatchObject({
    operation: 'count',
    measuredInputTokens: 100000,
    inputTokens: null,
    outputTokens: null,
  });
});
