import rules from '../src/assets/scoring-rules.json';
import highRules from '../src/assets/high-scoring-rules.json';
import highEnglishRules from '../src/assets/high-english-scoring-rules.json';

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
    expect(rubric.rules.crossLevelPolicy).toContain('因切换学段而提高');
  }
  expect(highRules.id).not.toBe(rules.id);
  expect(highEnglishRules.id).not.toBe('english-writing-enhanced-100-v1');
});
