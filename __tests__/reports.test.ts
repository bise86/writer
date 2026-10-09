import {
  dateLabel,
  parseDate,
  recentMonth,
  reportBounds,
  ReportEntry,
  summarizeScores,
} from '../src/services/reports';

test('最近一个月正确处理跨年及月末，不溢出到本月', () => {
  expect(recentMonth(new Date(2026, 9, 9, 12))).toEqual({
    start: '2026-09-09',
    end: '2026-10-09',
  });
  expect(recentMonth(new Date(2026, 2, 31))).toEqual({
    start: '2026-02-28',
    end: '2026-03-31',
  });
  expect(recentMonth(new Date(2024, 2, 31))).toEqual({
    start: '2024-02-29',
    end: '2024-03-31',
  });
  expect(recentMonth(new Date(2026, 0, 31))).toEqual({
    start: '2025-12-31',
    end: '2026-01-31',
  });
});

test('日期范围按本地自然日包含结束日全天，不用 UTC 日期误差截掉夜间成绩', () => {
  const range = reportBounds({start: '2026-10-01', end: '2026-10-09'});
  expect(range.from).toBe(new Date(2026, 9, 1).toISOString());
  expect(range.until).toBe(new Date(2026, 9, 10).toISOString());
  expect(dateLabel(parseDate('2024-02-29')!)).toBe('2024-02-29');
  for (const value of [
    '2026-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-10-00',
    '2026-1-9',
    '',
    'not-a-date',
  ]) {
    expect(parseDate(value)).toBeUndefined();
    expect(() => reportBounds({start: value, end: '2026-10-09'})).toThrow(
      '有效日期',
    );
  }
  expect(() => reportBounds({start: '2026-10-10', end: '2026-10-09'})).toThrow(
    '不能晚于',
  );
});

test('统计各项原始分数，零分算有效记录，无记录则保持空值', () => {
  const entry: ReportEntry = {
    id: '1',
    essayId: 'e1',
    title: '练习',
    scoredAt: new Date().toISOString(),
    estimatedTime: false,
    scores: {
      total: 80,
      thesis: 20,
      content: 22,
      structure: 16,
      language: 15,
      format: 7,
    },
  };
  const zero: ReportEntry = {
    ...entry,
    id: '2',
    essayId: 'e2',
    estimatedTime: true,
    scores: {
      total: 0,
      thesis: 0,
      content: 0,
      structure: 0,
      language: 0,
      format: 0,
    },
  };
  expect(summarizeScores([entry, zero])).toMatchObject({
    count: 2,
    average: {
      total: 40,
      thesis: 10,
      content: 11,
      structure: 8,
      language: 7.5,
      format: 3.5,
    },
    highest: 80,
    lowest: 0,
    estimatedCount: 1,
  });
  expect(summarizeScores([])).toMatchObject({
    count: 0,
    average: null,
    highest: null,
    lowest: null,
  });
});
