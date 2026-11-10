import {
  dateLabel,
  englishComparisonNote,
  englishRubricLabel,
  parseDate,
  recentMonth,
  reportBounds,
  ReportEntry,
  summarizeScores,
} from '../src/services/reports';
import {readScoreReport} from '../src/db/reports';
import type {SQLiteDatabase} from 'react-native-sqlite-storage';

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

test('英文报表保留原记录版本及成绩，未记录版本保持未知，不按新标准重算', async () => {
  const values = {
    task: 18,
    content: 17,
    organization: 13,
    language: 29,
    format: 8,
  };
  const records = [
    {
      id: 'v3',
      essay_id: 'essay-v3',
      title: '旧练习',
      scored_at: '2026-10-08T00:00:00.000Z',
      time_source: 'scored_at',
      total_score: 85,
      dimension_scores_json: JSON.stringify(values),
      rubric_version: 'english-writing-zhongkao-100-v3:3',
    },
    {
      id: 'v4',
      essay_id: 'essay-v4',
      title: '新练习',
      scored_at: '2026-10-09T00:00:00.000Z',
      time_source: 'scored_at',
      total_score: 79,
      dimension_scores_json: JSON.stringify(values),
      rubric_version: 'english-writing-zhongkao-enhanced-100-v4:4',
    },
    {
      id: 'unknown',
      essay_id: 'essay-unknown',
      title: '无版本练习',
      scored_at: '2026-10-10T00:00:00.000Z',
      time_source: 'legacy_updated_at',
      total_score: 85,
      dimension_scores_json: JSON.stringify(values),
      rubric_version: null,
    },
  ];
  const executeSql = jest.fn(async (..._args: unknown[]) => [
    {rows: {length: records.length, item: (index: number) => records[index]}},
  ]);
  const report = await readScoreReport(
    {executeSql} as unknown as SQLiteDatabase,
    {start: '2026-10-01', end: '2026-10-10'},
    'english',
  );
  expect(report.entries.map(item => item.scores.total)).toEqual([85, 79, 85]);
  expect(report.entries.map(item => item.rubricVersion)).toEqual([
    'english-writing-zhongkao-100-v3:3',
    'english-writing-zhongkao-enhanced-100-v4:4',
    undefined,
  ]);
  expect(report.entries[1].admissionAdjustment).toBe(6);
  expect(executeSql).toHaveBeenCalledTimes(1);
  expect(executeSql.mock.calls[0][0]).toContain('s.rubric_version');
  expect(englishComparisonNote(report.entries)).toContain('不宜直接比较');
});

test('英文版本说明区分强化前后，空版本不猜测，同版本不制造比较警告', () => {
  const entry = (rubricVersion?: string): ReportEntry => ({
    id: '1',
    essayId: 'e1',
    title: '练习',
    scoredAt: '',
    estimatedTime: false,
    scores: {total: 85},
    rubricVersion,
  });
  const version = 'english-writing-gaokao-enhanced-100-v4:4';
  expect(englishRubricLabel(version)).toContain('较 v3 提高一档');
  expect(englishRubricLabel('english-writing-gaokao-100-v3:3')).toContain(
    '本次强化前',
  );
  expect(
    englishRubricLabel('english-writing-high-school-enhanced-100-v2:2'),
  ).toBe('旧版强化训练 v2');
  for (const value of [null, undefined, '', ' ', 4]) {
    expect(englishRubricLabel(value)).toContain('版本未记录');
  }
  expect(
    englishComparisonNote([entry(version), entry(version)]),
  ).toBeUndefined();
  expect(englishComparisonNote([entry(''), entry()])).toContain(
    '可比性无法确认',
  );
  expect(englishComparisonNote([entry(version), entry()])).toContain(
    '不宜直接比较',
  );
  expect(englishComparisonNote([entry()])).toBeUndefined();
});
