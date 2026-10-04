import OpenAI from 'openai';
import type {ResponseInput} from 'openai/resources/responses/responses';
import {DEFAULT_SETTINGS, validateSettings} from '../src/settings';
import {AppSettings} from '../src/types';
import {runResponse, visionResponse} from '../src/services/openai';
import {
  contextBudget,
  estimateInputTokens,
  estimateTextTokens,
  splitTextByBudget,
} from '../src/services/context';

jest.mock('openai', () => jest.fn());
jest.mock('react-native-fs', () => ({
  readFile: jest.fn().mockResolvedValue('image'),
}));

const create = jest.fn();
const compact = jest.fn();
const count = jest.fn();
const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'secret-test-key',
  retryCount: 0,
};
const openai: AppSettings = {
  ...settings,
  apiBaseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-5.5',
};
const done = (text = '完成') => ({status: 'completed', output_text: text});
const failure = (status: number, message = 'request failed') =>
  Object.assign(new Error(message), {status});

beforeEach(() => {
  jest.resetAllMocks();
  create.mockResolvedValue(done());
  count.mockResolvedValue({input_tokens: 100});
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    responses: {create, compact, inputTokens: {count}},
  }));
});

afterEach(() => jest.useRealTimers());

test.each(['none', 'low', 'high', 'max'] as const)(
  'DeepSeek 通过 reasoning.effort 传递 %s，不传 OpenAI 专用字段',
  async effort => {
    await runResponse('作文原文', '评分细则', {
      ...settings,
      reasoningEffort: effort,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({reasoning: {effort}}),
    );
    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('context_management');
    expect(body).not.toHaveProperty('model_context_window');
    expect(compact).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  },
);

test('GPT 将上下文和比例转换成受支持的阈值，并关闭隐式截断', async () => {
  await runResponse('原文', '规则', openai);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      context_management: [{type: 'compaction', compact_threshold: 800000}],
      max_output_tokens: 5000,
      reasoning: {effort: 'high'},
      truncation: 'disabled',
    }),
  );
  expect(create.mock.calls[0][0]).not.toHaveProperty('model_context_window');
  expect(create.mock.calls[0][0]).not.toHaveProperty(
    'model_auto_compact_token_limit',
  );
});

test('高输出预算会降低压缩阈值，预留输出和安全空间', async () => {
  const configured = {
    ...openai,
    contextWindow: 10000,
    maxOutputTokens: 3000,
    compactionThreshold: 0.9,
  };
  await runResponse('原文', '规则', configured);
  expect(create.mock.calls[0][0].context_management[0].compact_threshold).toBe(
    6744,
  );
});

test.each([
  {contextWindow: NaN},
  {contextWindow: -1},
  {contextWindow: 1024.5},
  {contextWindow: ''},
  {compactionThreshold: 0},
  {compactionThreshold: 1},
  {compactionThreshold: Infinity},
  {compactionThreshold: 0.0000000001},
  {maxOutputTokens: 1000000},
  {maxOutputTokens: 990000},
  {retryCount: -1},
  {retryCount: 0.5},
  {apiBaseUrl: 'not-a-url'},
])('非法配置在调用模型前被拒绝：%j', async patch => {
  await expect(
    runResponse('原文', '规则', {...settings, ...patch} as AppSettings),
  ).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

test('表单数值被转换成数值，并剔除旧独立 OCR 模型字段', () => {
  const result = validateSettings({
    ...settings,
    contextWindow: '1000000',
    retryCount: '0',
    visionModelName: 'old-model',
  } as unknown as AppSettings);
  expect(result.contextWindow).toBe(1000000);
  expect(result.retryCount).toBe(0);
  expect(result).not.toHaveProperty('visionModelName');
});

test('中文、表情按保守文本预算计算，分段不破坏字符或漏字', () => {
  expect(estimateTextTokens('中😀A')).toBe(8);
  const original = '中😀A'.repeat(30);
  const chunks = splitTextByBudget(original, 19);
  expect(chunks.join('')).toBe(original);
  expect(chunks.every(chunk => estimateTextTokens(chunk) <= 19)).toBe(true);
});

test('图片 Base64 不作为文本 token 计数，图片和当前文字完整传递', async () => {
  const image = 'data:image/jpeg;base64,' + 'a'.repeat(2_000_000);
  const input: ResponseInput = [
    {
      role: 'user',
      content: [{type: 'input_image', image_url: image, detail: 'high'}],
    },
  ];
  expect(estimateInputTokens(input)).toBeLessThan(40000);
  await runResponse(input, '识别所有文字', {
    ...settings,
    contextWindow: 50000,
    maxOutputTokens: 1000,
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0].input).toEqual(input);
  expect(compact).not.toHaveBeenCalled();
});

test('仅原文达到压缩阈值但仍在输入预算内时，不对原文作摘要', async () => {
  const text = 'a'.repeat(8200);
  const onProgress = jest.fn();
  await runResponse(
    text,
    '规则',
    {...settings, contextWindow: 10000, maxOutputTokens: 500},
    settings.modelName,
    {onProgress},
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0].input).toBe(text);
  expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('必需原文'));
});

test('作文、规则和输出合计超限时停止，不删减原文或发送超预算请求', async () => {
  await expect(
    runResponse('中'.repeat(400), '规则'.repeat(400), {
      ...settings,
      contextWindow: 4096,
      maxOutputTokens: 1000,
    }),
  ).rejects.toThrow('不会删减作文');
  expect(create).not.toHaveBeenCalled();
});

test('云端 OCR 使用唯一配置的模型', async () => {
  await visionResponse('file:///essay.jpg', '识别', {
    ...settings,
    modelName: 'custom-vision-and-grading',
    reasoningEffort: 'none',
  });
  expect(create.mock.calls[0][0].model).toBe('custom-vision-and-grading');
  expect(create.mock.calls[0][0].reasoning).toEqual({effort: 'none'});
});

test('DeepSeek 分段压缩历史，当前原文和细则不参与摘要', async () => {
  const configured = {...settings, contextWindow: 4096, maxOutputTokens: 512};
  const input = '不可替换的作文原文';
  const instructions = '完整的评分细则';
  const history = [
    {role: 'assistant' as const, content: '旧对话'.repeat(1200)},
  ];
  const snapshot = JSON.stringify(history);
  create.mockImplementation(body =>
    Promise.resolve(
      done(
        body.instructions === instructions
          ? '最终结果'
          : '保留关键事实的简短摘要',
      ),
    ),
  );
  const result = await runResponse(
    input,
    instructions,
    configured,
    configured.modelName,
    {history},
  );
  expect(result.text).toBe('最终结果');
  expect(create.mock.calls.length).toBeGreaterThan(2);
  for (const [body] of create.mock.calls.slice(0, -1)) {
    expect(body.model).toBe(settings.modelName);
    expect(body.reasoning).toEqual({effort: 'high'});
    expect(body.input).not.toContain(input);
    expect(body.instructions).not.toContain(instructions);
    expect(
      estimateInputTokens(body.input) + estimateTextTokens(body.instructions),
    ).toBeLessThan(contextBudget(configured).inputLimit);
  }
  const final = create.mock.calls[create.mock.calls.length - 1][0];
  expect(final.instructions).toBe(instructions);
  expect(final.input[final.input.length - 1]).toEqual({
    role: 'user',
    content: input,
  });
  expect(JSON.stringify(history)).toBe(snapshot);
  expect(compact).not.toHaveBeenCalled();
  expect(count).not.toHaveBeenCalled();
});

test('返回更长的摘要会停止，不会陷入无限循环或继续评分', async () => {
  create.mockResolvedValue(done('x'.repeat(20000)));
  await expect(
    runResponse(
      '原文',
      '规则',
      {...settings, contextWindow: 10000, maxOutputTokens: 500},
      settings.modelName,
      {history: [{role: 'assistant', content: 'a'.repeat(8300)}]},
    ),
  ).rejects.toThrow('没有缩短');
  expect(create).toHaveBeenCalledTimes(1);
});

test('过大的历史有请求次数上限，不会无界收费', async () => {
  await expect(
    runResponse(
      '原文',
      '规则',
      {...settings, contextWindow: 4096, maxOutputTokens: 512},
      settings.modelName,
      {history: [{role: 'assistant', content: 'a'.repeat(200000)}]},
    ),
  ).rejects.toThrow('处理上限');
  expect(create).not.toHaveBeenCalled();
});

test('GPT 原生压缩只收到历史，完整压缩输出与当前原文一起重放', async () => {
  const configured = {...openai, contextWindow: 10000, maxOutputTokens: 500};
  const history = [{role: 'assistant' as const, content: 'a'.repeat(8300)}];
  const output = [
    {
      type: 'compaction',
      id: 'compact-id',
      encrypted_content: 'opaque-token-data',
    },
  ];
  count
    .mockResolvedValueOnce({input_tokens: 8500})
    .mockResolvedValueOnce({input_tokens: 1000});
  compact.mockResolvedValue({output});
  await runResponse('完整作文', '完整细则', configured, configured.modelName, {
    history,
  });
  expect(compact).toHaveBeenCalledWith(
    expect.objectContaining({model: configured.modelName, input: history}),
  );
  expect(create.mock.calls[0][0].input).toEqual([
    ...output,
    {role: 'user', content: '完整作文'},
  ]);
  expect(create.mock.calls[0][0].instructions).toBe('完整细则');
  expect(count.mock.calls[1][0].model).toBe(configured.modelName);
});

test('原生压缩接口不存在时回退历史摘要，不把整个作文发去摘要', async () => {
  const configured = {...openai, contextWindow: 10000, maxOutputTokens: 500};
  count.mockResolvedValue({input_tokens: 8500});
  compact.mockRejectedValue(failure(404));
  create
    .mockResolvedValueOnce(done('简短摘要'))
    .mockResolvedValueOnce(done('最终结果'));
  await runResponse('完整作文', '完整细则', configured, configured.modelName, {
    history: [{role: 'assistant', content: 'a'.repeat(8300)}],
  });
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0][0].input).not.toContain('完整作文');
});

test('无效的原生压缩返回被拒绝，不默默丢弃历史', async () => {
  count.mockResolvedValue({input_tokens: 8500});
  compact.mockResolvedValue({output: []});
  await expect(
    runResponse(
      '原文',
      '规则',
      {...openai, contextWindow: 10000, maxOutputTokens: 500},
      openai.modelName,
      {history: [{role: 'assistant', content: 'a'.repeat(8300)}]},
    ),
  ).rejects.toThrow('压缩结果无效');
  expect(create).not.toHaveBeenCalled();
});

test('模型名不能让 DeepSeek 或未知网关调用 OpenAI 专用接口', async () => {
  for (const base of [
    'https://api.deepseek.com',
    'https://api.openai.com.example.test',
    'https://gateway.example.test/v1',
  ]) {
    await runResponse('原文', '规则', {...openai, apiBaseUrl: base});
    expect(
      create.mock.calls[create.mock.calls.length - 1][0],
    ).not.toHaveProperty('context_management');
  }
});

test('retryCount=0 时网络失败只调用一次', async () => {
  create.mockRejectedValue(failure(503));
  await expect(runResponse('原文', '规则', settings)).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});

test('retryCount=1 恰好重试一次，并显示重试过程', async () => {
  jest.useFakeTimers();
  create
    .mockRejectedValueOnce(failure(503))
    .mockResolvedValueOnce(done('成功'));
  const onProgress = jest.fn();
  const result = runResponse(
    '原文',
    '规则',
    {...settings, retryCount: 1},
    settings.modelName,
    {onProgress},
  );
  await jest.runAllTimersAsync();
  await expect(result).resolves.toMatchObject({text: '成功'});
  expect(create).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenCalledWith(
    expect.stringContaining('重试 1/1'),
    1,
  );
  expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({maxRetries: 0}));
});

test('临时连接错误遵循重试次数', async () => {
  jest.useFakeTimers();
  create
    .mockRejectedValueOnce(
      Object.assign(new Error('connection'), {name: 'APIConnectionError'}),
    )
    .mockResolvedValueOnce(done());
  const result = runResponse('原文', '规则', {...settings, retryCount: 1});
  await jest.runAllTimersAsync();
  await result;
  expect(create).toHaveBeenCalledTimes(2);
});

test.each([400, 401, 403, 404])('HTTP %s 不反复请求', async status => {
  create.mockRejectedValue(failure(status));
  await expect(
    runResponse('原文', '规则', {...settings, retryCount: 3}),
  ).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});

test('实际模型上下文超限明确失败，不盲目删减后重试', async () => {
  create.mockRejectedValue(failure(400, 'context_length_exceeded'));
  await expect(
    runResponse('原文', '规则', {...settings, retryCount: 1}),
  ).rejects.toThrow('实际上下文限制');
  expect(create).toHaveBeenCalledTimes(1);
});

test.each([
  {
    status: 'incomplete',
    incomplete_details: {reason: 'max_output_tokens'},
    output_text: '部分结果',
  },
  {status: 'failed', output_text: '不应保存'},
  {status: 'completed', output_text: ''},
  {status: 'completed', output_text: ' ', error: null},
  {status: 'completed', output_text: '忽略', error: {message: '失败'}},
  {
    status: 'completed',
    output_text: '拒绝',
    output: [{type: 'message', content: [{type: 'refusal'}]}],
  },
])('无效或截断的响应不会当作成功：%j', async response => {
  create.mockResolvedValue(response);
  await expect(runResponse('原文', '规则', settings)).rejects.toThrow();
});

test('服务端错误中的 API Key 不会进入流程日志', async () => {
  create.mockRejectedValue(failure(400, `invalid ${settings.apiKey}`));
  await expect(runResponse('原文', '规则', settings)).rejects.toThrow(
    'invalid [已隐藏密钥]',
  );
});
