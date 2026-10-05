import OpenAI from 'openai';
import {
  getEssay,
  getSettings,
  getSteps,
  updateEssay,
  updateStep,
} from '../src/db/database';
import {cloudOcr, localOcrPages, reconcileOcr} from '../src/services/ocr';
import {
  retryEssay,
  runEssayPipeline,
  scoreEssay,
} from '../src/services/pipeline';
import {DEFAULT_SETTINGS} from '../src/settings';
import {Essay, PipelineStep, ScoreResult, StepId} from '../src/types';

jest.mock('openai', () => jest.fn());
jest.mock('react-native-fs', () => ({}));
jest.mock('../src/db/database', () => ({
  getEssay: jest.fn(),
  getSettings: jest.fn(),
  getSteps: jest.fn(),
  updateEssay: jest.fn(),
  updateStep: jest.fn(),
}));
jest.mock('../src/services/ocr', () => ({
  localOcrPages: jest.fn(),
  cloudOcr: jest.fn(),
  reconcileOcr: jest.fn(),
}));

const create = jest.fn();
const text = '初春，我在雨中学会了等待。';
const validScore: ScoreResult = {
  score: 61,
  bandId: 'pass',
  dimensionScores: {
    thesis: 16,
    content: 14,
    structure: 11,
    language: 14,
    format: 6,
  },
  summary: '中心明确，需要加强描写。',
  strengths: ['中心明确'],
  weaknesses: ['描写不足'],
  improvements: ['补充细节'],
  suggestions: ['练习动作描写'],
  annotations: [
    {
      quote: '雨中',
      start: -1,
      end: -1,
      type: 'improvement',
      comment: '场景可以更具体',
      suggestion: '补充雨声和动作',
    },
  ],
};
let essay: Essay;
let steps: PipelineStep[];

beforeEach(() => {
  jest.resetAllMocks();
  essay = {
    id: 'essay-1',
    title: '',
    imageUri: 'file:///essay.jpg',
    imageUris: ['file:///essay.jpg'],
    status: 'queued',
    localOcr: '',
    visionOcr: '',
    canonicalText: '',
    corrections: '',
    scoreJson: '',
    error: '',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  };
  steps = (['local_ocr', 'vision_ocr', 'reconcile', 'scoring'] as StepId[]).map(
    step => ({
      essayId: essay.id,
      step,
      status: 'pending',
      detail: '',
      retryCount: 0,
      updatedAt: essay.updatedAt,
    }),
  );
  (getSettings as jest.Mock).mockResolvedValue({
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
  });
  (getEssay as jest.Mock).mockImplementation(async () => ({...essay}));
  (getSteps as jest.Mock).mockImplementation(async () =>
    steps.map(item => ({...item})),
  );
  (updateEssay as jest.Mock).mockImplementation(async (_id, patch) =>
    Object.assign(essay, patch),
  );
  (updateStep as jest.Mock).mockImplementation(
    async (_id, step, status, detail, retryCount) => {
      Object.assign(
        steps.find(item => item.step === step)!,
        {status, detail},
        retryCount === undefined ? {} : {retryCount},
      );
    },
  );
  (localOcrPages as jest.Mock).mockResolvedValue({text});
  (cloudOcr as jest.Mock).mockResolvedValue({text});
  (reconcileOcr as jest.Mock).mockResolvedValue({text, corrections: '一致'});
  create.mockResolvedValue({
    status: 'completed',
    output_text: JSON.stringify(validScore),
  });
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    responses: {create},
  }));
});

afterEach(() => jest.useRealTimers());

test('有效评分按原文定位批注并持久化', async () => {
  await runEssayPipeline({...essay});
  expect(essay.status).toBe('completed');
  const score = JSON.parse(essay.scoreJson);
  expect(score.score).toBe(61);
  expect(text.slice(score.annotations[0].start, score.annotations[0].end)).toBe(
    '雨中',
  );
  expect(steps.every(item => item.status === 'success')).toBe(true);
});

test('评分失败时保留识别结果，不生成基础分数，重试从评分继续', async () => {
  create.mockResolvedValueOnce({
    status: 'completed',
    output_text: '不是评分 JSON',
  });
  await expect(runEssayPipeline({...essay})).rejects.toThrow('有效 JSON');
  expect(essay.scoreJson).toBe('');
  expect(essay.canonicalText).toBe(text);
  expect(essay.status).toBe('failed');
  expect(steps[3].status).toBe('failed');
  await retryEssay(essay.id);
  expect(essay.status).toBe('completed');
  expect(create).toHaveBeenCalledTimes(2);
  expect(localOcrPages).toHaveBeenCalledTimes(1);
  expect(cloudOcr).toHaveBeenCalledTimes(1);
  expect(reconcileOcr).toHaveBeenCalledTimes(1);
});

test('模型输出截断后不会保存部分评分', async () => {
  create.mockResolvedValue({
    status: 'incomplete',
    incomplete_details: {reason: 'max_output_tokens'},
    output_text: JSON.stringify(validScore),
  });
  await expect(runEssayPipeline({...essay})).rejects.toThrow('输出被截断');
  expect(essay.scoreJson).toBe('');
  expect(steps[3].status).toBe('failed');
});

test.each([
  {...validScore, score: 100},
  {...validScore, dimensionScores: {thesis: 61}},
  {...validScore, bandId: 'model'},
  {
    ...validScore,
    annotations: [
      {quote: '原文没有的句子', type: 'style', comment: '', suggestion: ''},
    ],
  },
  {...validScore, strengths: '应为数组'},
  {score: 80},
  null,
])('无效评分结构、分数或引用会失败：%j', async score => {
  create.mockResolvedValue({
    status: 'completed',
    output_text: JSON.stringify(score),
  });
  await expect(scoreEssay(text)).rejects.toThrow();
});

test('空作文不会请求模型', async () => {
  await expect(scoreEssay(' ')).rejects.toThrow('不能评分');
  expect(create).not.toHaveBeenCalled();
});

test('整个流程只按配置重试 SDK 请求一次，不重新运行已完成的步骤', async () => {
  jest.useFakeTimers();
  create.mockRejectedValue(
    Object.assign(new Error('服务暂时不可用'), {status: 503}),
  );
  const result = runEssayPipeline({...essay}).catch(error => error);
  await jest.runAllTimersAsync();
  expect(await result).toBeInstanceOf(Error);
  expect(create).toHaveBeenCalledTimes(2);
  expect(steps[3].retryCount).toBe(1);
  expect(steps[3].status).toBe('failed');
  expect(cloudOcr).toHaveBeenCalledTimes(1);
});

test('同一作文不能并发提交，当前处理不受第二次点击影响', async () => {
  let release!: (value: {text: string}) => void;
  const pendingOcr = new Promise<{text: string}>(resolve => {
    release = resolve;
  });
  (localOcrPages as jest.Mock).mockReturnValueOnce(pendingOcr);
  const first = runEssayPipeline({...essay});
  await expect(runEssayPipeline({...essay})).rejects.toThrow('正在处理中');
  release({text});
  await first;
  expect(create).toHaveBeenCalledTimes(1);
  expect(essay.status).toBe('completed');
});

test('校对失败后仅重新校对和评分', async () => {
  (reconcileOcr as jest.Mock).mockRejectedValueOnce(new Error('校对失败'));
  await expect(runEssayPipeline({...essay})).rejects.toThrow('校对失败');
  await retryEssay(essay.id);
  expect(localOcrPages).toHaveBeenCalledTimes(1);
  expect(cloudOcr).toHaveBeenCalledTimes(1);
  expect(reconcileOcr).toHaveBeenCalledTimes(2);
  expect(essay.status).toBe('completed');
});
