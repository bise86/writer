import rules from '../src/assets/scoring-rules.json';

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
