import englishRules from '../src/assets/english-scoring-rules.json';
jest.mock('../src/db/database', () => ({}));
jest.mock('../src/services/openai', () => ({}));
import {scoreInstructions} from '../src/services/scoring';
import {validateScore} from '../src/services/score-validation';
import {getWritingRules} from '../src/services/writing';
import {scoreMetricsFor, summarizeScores} from '../src/services/reports';
import {ScoreResult} from '../src/types';

const feedback = {
  strengths: ['原文有明确信息'],
  weaknesses: ['还可以更具体'],
  improvements: ['补充一项直接证据'],
};

const original = 'My Day\n\nI went home.';
const englishScore: ScoreResult = {
  score: 79,
  bandId: 'good',
  admissionAdjustment: 6,
  admissionReason: '第 1 段存在已确认的语言错误，未通过第三档准入条件。',
  dimensionScores: {task: 18, content: 17, organization: 13, language: 29, format: 8},
  dimensionFeedback: Object.fromEntries(englishRules.dimensions.map(item => [item.id, feedback])),
  summary: '待核题、待核原图，训练预评。',
  strengths: ['信息完整'],
  weaknesses: ['语言有一处须订正'],
  improvements: ['订正语言问题'],
  suggestions: ['逐句核对'],
  titleFeedback: feedback,
  paragraphReviews: [{paragraphIndex: 1, ...feedback}],
  annotations: ['My Day', 'I went home.'].map(quote => ({
    quote, type: 'improvement', comment: '可以更具体', suggestion: '补充直接证据',
  })),
};

test('保留英语真实分项合计 85，通过准入调整 6 得到 79 分并定为第二档', () => {
  const result = validateScore(englishScore, original, getWritingRules('english'));
  expect(result).toMatchObject({score: 79, bandId: 'good', admissionAdjustment: 6});
  expect(result.dimensionScores).toEqual(englishScore.dimensionScores);
  expect(Object.values(result.dimensionScores).reduce((sum, value) => sum + value, 0)).toBe(85);
});

test.each([
  {admissionAdjustment: -1},
  {admissionAdjustment: 6.5},
  {admissionAdjustment: 86},
  {admissionReason: ''},
  {admissionReason: 123},
  {score: 78, admissionAdjustment: 7},
  {score: 79, admissionAdjustment: 0},
])('拒绝无效准入调整、缺失证据和重复扣分：%j', patch => {
  expect(() => validateScore({...englishScore, ...patch}, original, getWritingRules('english'))).toThrow();
});

test.each(['chinese', 'english'] as const)('%s 评分提示的示例分数满足其入档底线', type => {
  const rules = getWritingRules(type);
  const example = scoreInstructions(0, type).split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line))
    .find(value => value.dimensionScores);
  const text = type === 'english' ? 'I went home.' : '我走回了家。';
  expect(() => validateScore({
    ...example,
    annotations: [{...example.annotations[0], quote: text}],
  }, text, rules)).not.toThrow();
});

test('英语圆桌按任务与交际规则审阅，并说明缺失命题和原图的限制', () => {
  const instructions = scoreInstructions(3, 'english');
  expect(instructions).toContain('任务回应与交际效果');
  expect(instructions).toContain('不给通知或邀请函强加主题升华');
  expect(instructions).toContain('待核题、待核原图，训练预评');
  expect(instructions).toContain('admissionAdjustment');
});

test('英语评分细则是完整的模型可读 JSON，并保留第三档定位', () => {
  expect(englishRules.total).toBe(100);
  expect(englishRules.dimensions.map(item => item.id)).toEqual([
    'task',
    'content',
    'organization',
    'language',
    'format',
  ]);
  expect(englishRules.dimensions.reduce((sum, item) => sum + item.max, 0)).toBe(
    100,
  );
  expect(englishRules.bands[2].min).toBe(80);
  expect(englishRules.thirdBandIsExamFullQuality).toBe(true);
  expect(scoreInstructions(0, 'english')).toContain(
    'task/content/organization/language/format',
  );
  expect(scoreInstructions(0, 'english')).toContain(englishRules.id);
});

test('英语评分校验使用英语五项权重且标题不计入正文段落', () => {
  const result = validateScore(
    {
      score: 80,
      bandId: 'high',
      dimensionScores: {
        task: 17,
        content: 16,
        organization: 12,
        language: 27,
        format: 8,
      },
      dimensionFeedback: Object.fromEntries(
        getWritingRules('english').dimensions.map(item => [item.id, feedback]),
      ),
      summary: '完整、准确地完成了英语写作任务。',
      strengths: ['信息完整'],
      weaknesses: ['细节仍可精修'],
      improvements: ['增加具体场景'],
      suggestions: ['练习读者意识'],
      titleFeedback: feedback,
      paragraphReviews: [{paragraphIndex: 1, ...feedback}],
      annotations: [
        {
          quote: 'My Day',
          start: -1,
          end: -1,
          type: 'strength',
          comment: '标题清楚',
          suggestion: '保持简洁',
        },
        {
          quote: 'I went home.',
          start: -1,
          end: -1,
          type: 'improvement',
          comment: '信息准确但可以更具体',
          suggestion: '补充一个动作或结果',
        },
      ],
    },
    'My Day\n\nI went home.',
    getWritingRules('english'),
  );
  expect(result.score).toBe(80);
  expect(result.bandName).toBe('满分质量基准');
  expect(result.paragraphReviews).toHaveLength(1);
});

test('英语书信称呼单独评价，不计为正文第一段', () => {
  const text = 'Dear Tom,\n\nI went home.';
  const value = {
    ...englishScore,
    score: 79,
    admissionAdjustment: 6,
    paragraphReviews: [{paragraphIndex: 1, ...feedback}],
    salutationFeedback: feedback,
    annotations: [
      {quote: 'Dear Tom,', type: 'style', comment: '称呼得体', suggestion: '保持称呼与对象一致'},
      {quote: 'I went home.', type: 'improvement', comment: '信息可更具体', suggestion: '补充一个原因'},
    ],
  };
  const result = validateScore(value, text, getWritingRules('english'));
  expect(result.paragraphReviews).toHaveLength(1);
  expect(result.salutationFeedback).toEqual(feedback);
});

test('英文报表按英文分项动态汇总，而不是套用中文分项', () => {
  const report = summarizeScores(
    [
      {
        id: 'score-1',
        essayId: 'english-1',
        title: 'My Day',
        scoredAt: '2026-10-10T00:00:00.000Z',
        estimatedTime: false,
        scores: {
          total: 80,
          task: 17,
          content: 16,
          organization: 12,
          language: 27,
          format: 8,
        },
      },
    ],
    scoreMetricsFor(getWritingRules('english').dimensions),
  );
  expect(report.average).toMatchObject({
    total: 80,
    task: 17,
    organization: 12,
    language: 27,
  });
});
