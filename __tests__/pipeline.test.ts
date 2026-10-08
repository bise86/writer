import OpenAI from 'openai';
import {
  getEssay,
  getSettings,
  getSteps,
  updateEssay,
  updateStep,
} from '../src/db/database';
import {cloudOcr, reconcileOcr} from '../src/services/ocr';
import {
  retryEssay,
  runEssayPipeline,
  scoreEssay,
} from '../src/services/pipeline';
import {DEFAULT_SETTINGS} from '../src/settings';
import {validateScore} from '../src/services/score-validation';
import {Essay, PipelineStep, ScoreResult, StepId} from '../src/types';

jest.mock('openai', () => jest.fn());
jest.mock('react-native-fs', () => ({}));
jest.mock('../src/db/database', () => ({
  getEssay: jest.fn(),
  getSettings: jest.fn(),
  getSteps: jest.fn(),
  getScoreAttempts: jest.fn(),
  saveScoreAttempt: jest.fn(),
  clearRoundtableState: jest.fn(),
  getRoundtableState: jest.fn(),
  saveRoundtableState: jest.fn(),
  updateEssay: jest.fn(),
  updateStep: jest.fn(),
}));
jest.mock('../src/services/ocr', () => ({
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
  dimensionFeedback: {
    thesis: {
      strengths: ['中心明确'],
      weaknesses: ['深化不足'],
      improvements: ['补充认识变化'],
    },
    content: {
      strengths: ['有具体场景'],
      weaknesses: ['材料偏少'],
      improvements: ['增加细节证据'],
    },
    structure: {
      strengths: ['顺序清楚'],
      weaknesses: ['转折单一'],
      improvements: ['加入照应'],
    },
    language: {
      strengths: ['表达通顺'],
      weaknesses: ['句式变化少'],
      improvements: ['练习长短句'],
    },
    format: {
      strengths: ['段落清楚'],
      weaknesses: ['标点可更规范'],
      improvements: ['逐句检查标点'],
    },
  },
  paragraphReviews: [
    {
      paragraphIndex: 1,
      strengths: ['点明经历'],
      weaknesses: ['细节不足'],
      improvements: ['补充动作和感受'],
    },
  ],
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
  steps = (['vision_ocr', 'reconcile', 'scoring'] as StepId[]).map(step => ({
    essayId: essay.id,
    step,
    status: 'pending',
    detail: '',
    retryCount: 0,
    updatedAt: essay.updatedAt,
  }));
  (getSettings as jest.Mock).mockResolvedValue({
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
  });
  (getEssay as jest.Mock).mockImplementation(async () => ({...essay}));
  (getSteps as jest.Mock).mockImplementation(async () =>
    steps.map(item => ({...item})),
  );
  const database = require('../src/db/database');
  database.getScoreAttempts.mockResolvedValue([]);
  database.saveScoreAttempt.mockResolvedValue(undefined);
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

test('圆桌评审通过完整流程保存票数和批注，完成后可以重新评审', async () => {
  (getSettings as jest.Mock).mockResolvedValue({
    ...DEFAULT_SETTINGS,
    apiKey: 'test-key',
    roundtableSize: 3,
  });
  create.mockImplementation(async request => ({
    status: 'completed',
    output_text: JSON.stringify(
      request.instructions.includes('你参加作文评分和批注的圆桌评审')
        ? {
            scoreApproved: true,
            annotationsApproved: true,
            scoreReason: '符合原文',
            annotationsReason: '引用正确',
            changes: [],
          }
        : validScore,
    ),
  }));
  await runEssayPipeline({...essay});
  expect(essay.status).toBe('completed');
  expect(JSON.parse(essay.scoreJson).roundtable.rounds[0]).toMatchObject({
    scoreVotes: 3,
    annotationVotes: 3,
  });
  expect(create).toHaveBeenCalledTimes(7);
  const database = require('../src/db/database');
  expect(database.clearRoundtableState).toHaveBeenCalledTimes(1);
  await retryEssay(essay.id);
  expect(database.clearRoundtableState).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(14);
  expect(cloudOcr).toHaveBeenCalledTimes(1);
});

test('评分失败时保留识别结果，不生成基础分数，重试从评分继续', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output_text: '不是评分 JSON',
  });
  await expect(runEssayPipeline({...essay})).rejects.toThrow('连续校验未通过');
  expect(essay.scoreJson).toBe('');
  expect(essay.canonicalText).toBe(text);
  expect(essay.status).toBe('failed');
  expect(steps[2].status).toBe('failed');
  create.mockResolvedValue({
    status: 'completed',
    output_text: JSON.stringify(validScore),
  });
  await retryEssay(essay.id);
  expect(essay.status).toBe('completed');
  expect(create).toHaveBeenCalledTimes(7);
  expect(cloudOcr).toHaveBeenCalledTimes(1);
  expect(reconcileOcr).toHaveBeenCalledTimes(1);
  expect(
    require('../src/db/database').clearRoundtableState,
  ).toHaveBeenCalledTimes(1);
});

test('评分格式错误会把上一轮答案和字段错误追加到下一轮请求', async () => {
  create
    .mockResolvedValueOnce({status: 'completed', output_text: '{"score": 61}'})
    .mockResolvedValueOnce({
      status: 'completed',
      output_text: JSON.stringify(validScore),
    });
  await runEssayPipeline({...essay});
  expect(create).toHaveBeenCalledTimes(2);
  const secondInput = JSON.stringify(create.mock.calls[1][0].input);
  expect(secondInput).toContain('score');
  expect(secondInput).toContain('评分校验未通过');
  expect(essay.status).toBe('completed');
});

test('模型输出截断后不会保存部分评分', async () => {
  create.mockResolvedValue({
    status: 'incomplete',
    incomplete_details: {reason: 'max_output_tokens'},
    output_text: JSON.stringify(validScore),
  });
  await expect(runEssayPipeline({...essay})).rejects.toThrow('输出被截断');
  expect(essay.scoreJson).toBe('');
  expect(steps[2].status).toBe('failed');
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
  expect(steps[2].retryCount).toBe(1);
  expect(steps[2].status).toBe('failed');
  expect(cloudOcr).toHaveBeenCalledTimes(1);
});

test('同一作文不能并发提交，当前处理不受第二次点击影响', async () => {
  let release!: (value: {text: string}) => void;
  const pendingOcr = new Promise<{text: string}>(resolve => {
    release = resolve;
  });
  (cloudOcr as jest.Mock).mockReturnValueOnce(pendingOcr);
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
  expect(cloudOcr).toHaveBeenCalledTimes(1);
  expect(reconcileOcr).toHaveBeenCalledTimes(2);
  expect(essay.status).toBe('completed');
});

test('后续原图复核纠正标题，旧本地文字不再参与评分', async () => {
  essay.title = '错误的旧标题';
  essay.localOcr = '无法辨认的乱字';
  (cloudOcr as jest.Mock).mockResolvedValue({text: '初次错标题\n' + text});
  (reconcileOcr as jest.Mock).mockResolvedValue({
    text,
    corrections: '原图没有标题',
  });
  await runEssayPipeline({...essay});
  expect(essay.title).toBe('');
  expect(essay.localOcr).toBe('');
  expect(reconcileOcr).toHaveBeenCalledWith(
    essay.imageUris,
    '初次错标题\n' + text,
    expect.anything(),
    expect.anything(),
  );
  expect(essay.canonicalText).toBe(text);
});

test('重新识别失败会清空旧评分和旧原文，不能展示失效结果', async () => {
  essay.canonicalText = text;
  essay.scoreJson = JSON.stringify(validScore);
  essay.status = 'completed';
  (cloudOcr as jest.Mock).mockRejectedValueOnce(new Error('图片读取失败'));
  await expect(
    runEssayPipeline({...essay}, undefined, 'vision_ocr'),
  ).rejects.toThrow('图片读取失败');
  expect(essay.canonicalText).toBe('');
  expect(essay.scoreJson).toBe('');
  expect(steps.find(item => item.step === 'scoring')?.status).toBe('pending');
});

test('评分逐段覆盖句子批注，不能只有第一段的批注', () => {
  const twoParagraphs = {
    ...validScore,
    paragraphReviews: [
      validScore.paragraphReviews![0],
      {...validScore.paragraphReviews![0], paragraphIndex: 2},
    ],
  };
  expect(() => validateScore(twoParagraphs, text + '\n我走向操场。')).toThrow(
    '缺少第 2 段的句子批注',
  );
});

test('最终标题使用复核纠正的新标题', async () => {
  (cloudOcr as jest.Mock).mockResolvedValue({text: '雨中的等侍\n' + text});
  (reconcileOcr as jest.Mock).mockResolvedValue({
    text: '雨中的等待\n' + text,
    corrections: '纠正标题形近字',
  });
  create.mockResolvedValue({
    status: 'completed',
    output_text: JSON.stringify({
      ...validScore,
      titleFeedback: {
        strengths: ['标题紧扣经历'],
        weaknesses: [],
        improvements: ['在结尾呼应标题'],
      },
      annotations: [
        {...validScore.annotations[0], quote: text},
        {
          quote: '雨中的等待',
          type: 'strength',
          comment: '标题扣住关键经历',
          suggestion: '保留并在结尾呼应',
        },
      ],
    }),
  });
  await runEssayPipeline({...essay});
  expect(essay.title).toBe('雨中的等待');
  const saved = JSON.parse(essay.scoreJson) as ScoreResult;
  expect(saved.paragraphIndexing).toBe('body-v1');
  expect(saved.paragraphReviews?.map(item => item.paragraphIndex)).toEqual([1]);
  const request = create.mock.calls[0][0];
  expect(request.instructions).toContain('标题不是正文段落');
  expect(request.input).toContain(
    '"kind":"title","label":"标题","text":"雨中的等待"',
  );
  expect(request.input).toContain(
    '"kind":"paragraph","label":"第 1 段","paragraphIndex":1',
  );
});

test('标题必须单独评价，不能继续混入正文段落列表', () => {
  const original = '雨中的等待\n' + text;
  const result = {
    ...validScore,
    annotations: [
      {...validScore.annotations[0], quote: '雨中的等待'},
      {...validScore.annotations[0], quote: text},
    ],
  };
  expect(() => validateScore(result, original)).toThrow('titleFeedback');
  const withTitle = {
    ...result,
    titleFeedback: {
      strengths: ['标题扣题'],
      weaknesses: [],
      improvements: ['结尾照应'],
    },
  };
  expect(validateScore(withTitle, original).paragraphReviews).toHaveLength(1);
  expect(() =>
    validateScore(
      {
        ...withTitle,
        paragraphReviews: [
          ...withTitle.paragraphReviews!,
          {...withTitle.paragraphReviews![0], paragraphIndex: 2},
        ],
      },
      original,
    ),
  ).toThrow('paragraphIndex 必须在 1..1');
});

test('重复引用缺少位置时要求模型纠正，不能默认为第一处', () => {
  const repeated = {
    ...validScore,
    annotations: [{...validScore.annotations[0], quote: '雨中'}],
  };
  expect(() => validateScore(repeated, '雨中，我在雨中学会了等待。')).toThrow(
    '出现多次',
  );
});
