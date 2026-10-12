import rules from '../src/assets/scoring-rules.json';
import highRules from '../src/assets/high-scoring-rules.json';
import highEnglishRules from '../src/assets/high-english-scoring-rules.json';
import {validateScore} from '../src/services/score-validation';
import {getWritingRules} from '../src/services/writing';

test('评分规则包含五档、五个分项，并且总分封顶为 100', () => {
  expect(rules.total).toBe(100);
  expect(rules.dimensions).toHaveLength(5);
  expect(rules.bands).toHaveLength(5);
  expect(rules.bands[0].min).toBeLessThan(rules.bands[4].min);
  expect(rules.dimensions.reduce((sum: number, item: {max: number}) => sum + item.max, 0)).toBe(100);
});

test('规则明确要求主题深化和语言表现，避免单靠套话进入高档', () => {
  expect(rules.rules.themeDeepening).toBeTruthy();
  expect(rules.rules.techniquePolicy).toBeTruthy();
  expect(rules.rules.ceiling.length).toBeGreaterThan(0);
});

test('高中中文和英语规则独立、总分完整且第三档对应高中高考满分基准', () => {
  for (const rubric of [highRules, highEnglishRules]) {
    expect(rubric.educationLevel).toBe('high');
    expect(rubric.dimensions.reduce((sum, item) => sum + item.max, 0)).toBe(100);
    expect(rubric.bands).toHaveLength(5);
    expect(rubric.bands[2].min).toBe(80);
    expect(rubric.thirdBandIsExamFullQuality).toBe(true);
    expect(rubric.rules.admissionPolicy).toBeTruthy();
    expect(rubric.rules.materialPolicy).toBeTruthy();
    expect(rubric.rules.crossLevelPolicy).toContain('独立评阅');
    expect(rubric.rules.quantitativePolicy).toBeTruthy();
    expect(rubric.highSchoolCapabilities.length).toBeGreaterThanOrEqual(6);
  }
  expect(highRules.id).not.toBe(rules.id);
  expect(highEnglishRules.id).not.toBe('english-writing-enhanced-100-v1');
  expect(Object.values(highRules.bands[1].floor).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(74);
  expect(Object.values(highEnglishRules.bands[1].floor).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(74);
});

test('同一份只达到初中良好档的中文分项不能直接通过高中良好档', () => {
  const feedback = {
    strengths: ['有明确表达'],
    weaknesses: ['高中层级证据不足'],
    improvements: ['补充关系分析'],
  };
  const middleLike = {
    score: 74,
    bandId: 'good',
    dimensionScores: {
      thesis: 18,
      content: 17,
      structure: 14,
      language: 18,
      format: 7,
    },
    summary: '基本完整。',
    strengths: ['基本完整'],
    weaknesses: ['分析不足'],
    improvements: ['补充分析'],
    suggestions: ['重写一段'],
    dimensionFeedback: {
      thesis: feedback,
      content: feedback,
      structure: feedback,
      language: feedback,
      format: feedback,
    },
    paragraphReviews: [{paragraphIndex: 1, ...feedback}],
    annotations: [
      {
        quote: '初春',
        start: -1,
        end: -1,
        type: 'improvement',
        comment: '需要展开',
        suggestion: '补充关系分析',
      },
    ],
  };
  expect(() =>
    validateScore(middleLike, '初春，我在雨中学会了等待。', getWritingRules('chinese', 'high')),
  ).toThrow();
});
