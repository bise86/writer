export const SCORE_METRICS = [
  {key: 'total', label: '总分', max: 100},
  {key: 'thesis', label: '审题与立意', max: 25},
  {key: 'content', label: '内容与选材', max: 25},
  {key: 'structure', label: '结构与技法', max: 20},
  {key: 'language', label: '语言与表达', max: 20},
  {key: 'format', label: '书写与规范', max: 10},
] as const;
export type ScoreMetric = string;
export type ScoreMetricDefinition = {key: string; label: string; max: number};
export function scoreMetricsFor(
  dimensions: readonly {id: string; name: string; max: number}[],
): ScoreMetricDefinition[] {
  return [
    {key: 'total', label: '总分', max: 100},
    ...dimensions.map(item => ({
      key: item.id,
      label: item.name,
      max: item.max,
    })),
  ];
}
export type ReportRange = {start: string; end: string};
export type ReportEntry = {
  id: string;
  essayId: string;
  title: string;
  scoredAt: string;
  estimatedTime: boolean;
  scores: Record<string, number>;
  admissionAdjustment?: number;
};
export type ScoreReport = {
  entries: ReportEntry[];
  count: number;
  average: Record<string, number> | null;
  highest: number | null;
  lowest: number | null;
  estimatedCount: number;
};

export function dateLabel(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse calendar dates in local time, without UTC parsing or silent rollover. */
export function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9998) {
    return undefined;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

export function recentMonth(now = new Date()): ReportRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = Math.min(now.getDate(), new Date(year, month, 0).getDate());
  return {
    start: dateLabel(new Date(year, month - 1, day)),
    end: dateLabel(now),
  };
}

export function reportBounds(range: ReportRange) {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end) {
    throw new Error('请选择有效日期，格式为 YYYY-MM-DD');
  }
  if (start > end) {
    throw new Error('开始日期不能晚于结束日期');
  }
  // Next local midnight includes the entire last day, even across DST changes.
  const until = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  return {from: start.toISOString(), until: until.toISOString()};
}

export function summarizeScores(
  entries: ReportEntry[],
  metrics: readonly ScoreMetricDefinition[] = SCORE_METRICS,
): ScoreReport {
  const report: ScoreReport = {
    entries,
    count: entries.length,
    average: null,
    highest: null,
    lowest: null,
    estimatedCount: entries.filter(entry => entry.estimatedTime).length,
  };
  if (!entries.length) {
    return report;
  }
  report.average = Object.fromEntries(
    metrics.map(({key}) => [
      key,
      entries.reduce((sum, entry) => sum + entry.scores[key], 0) /
        entries.length,
    ]),
  ) as Record<ScoreMetric, number>;
  report.highest = entries.reduce(
    (max, entry) => Math.max(max, entry.scores.total),
    0,
  );
  report.lowest = entries.reduce(
    (min, entry) => Math.min(min, entry.scores.total),
    100,
  );
  return report;
}
