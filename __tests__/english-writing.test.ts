import englishRules from '../src/assets/english-scoring-rules.json';
jest.mock('../src/db/database', () => ({}));
jest.mock('../src/services/openai', () => ({}));
import {scoreInstructions} from '../src/services/scoring';
import {validateScore} from '../src/services/score-validation';
import {getWritingRules} from '../src/services/writing';

const feedback = {
  strengths: ['原文有明确信息'],
  weaknesses: ['还可以更具体'],
  improvements: ['补充一项直接证据'],
};

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
    'My Day\nI went home.',
    getWritingRules('english'),
  );
  expect(result.score).toBe(80);
  expect(result.bandName).toBe('满分质量基准');
  expect(result.paragraphReviews).toHaveLength(1);
});
