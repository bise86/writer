import OpenAI from 'openai';
import {
  DEFAULT_SETTINGS,
  legacyDefaultChanges,
  normalizeReasoningEffort,
} from '../src/settings';
import {runResponse, visionResponse} from '../src/services/openai';

jest.mock('openai', () => jest.fn());
jest.mock('react-native-fs', () => ({
  readFile: jest.fn().mockResolvedValue('image'),
}));

const createResponse = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  createResponse.mockResolvedValue({status: 'completed', output_text: 'ok'});
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    responses: {create: createResponse},
  }));
});

test('旧安装迁移默认配置，API Key 和其他设置保留', () => {
  const stored = {
    apiBaseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-5.5',
    contextWindow: '128000',
    reasoningEffort: 'medium',
    apiKey: 'user-key',
    retryCount: '0',
    maxOutputTokens: '8192',
  };
  expect({...stored, ...legacyDefaultChanges(stored)}).toEqual({
    apiBaseUrl: 'https://api.deepseek.com',
    modelName: 'deepseek-flash',
    contextWindow: '1000000',
    reasoningEffort: 'high',
    apiKey: 'user-key',
    retryCount: '0',
    maxOutputTokens: '8192',
  });
});

test('迁移保留自定义配置，包括关闭思考', () => {
  expect(
    legacyDefaultChanges({
      apiBaseUrl: 'https://example.test/v1',
      modelName: 'custom-text',
      contextWindow: '262144',
      reasoningEffort: 'none',
    }),
  ).toEqual({});
  expect(normalizeReasoningEffort('none')).toBe('none');
  expect(normalizeReasoningEffort('medium')).toBe('high');
  expect(normalizeReasoningEffort(undefined)).toBe('high');
});

test('新默认设置用于实际 SDK 请求', async () => {
  await runResponse('作文正文', '评分', {
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
  });
  expect(OpenAI).toHaveBeenCalledWith(
    expect.objectContaining({baseURL: 'https://api.deepseek.com'}),
  );
  expect(createResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'deepseek-flash',
      reasoning: {effort: 'high'},
    }),
  );
  expect(DEFAULT_SETTINGS.contextWindow).toBe(1_000_000);
});

test.each(['none', 'low', 'high', 'max'] as const)(
  'DeepSeek 请求透传 %s 思考级别',
  async effort => {
    await runResponse('作文正文', '评分', {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      reasoningEffort: effort,
    });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({reasoning: {effort}}),
    );
  },
);

test('视觉 OCR 使用相同的新默认模型，并支持关闭思考', async () => {
  await visionResponse('file:///essay.jpg', '识别', {
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
    reasoningEffort: 'none',
  });
  expect(createResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'deepseek-flash',
      reasoning: {effort: 'none'},
      input: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({type: 'input_image'}),
          ]),
        }),
      ]),
    }),
  );
});
