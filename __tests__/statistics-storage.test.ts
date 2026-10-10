import {spawnSync} from 'child_process';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {DEFAULT_SETTINGS} from '../src/settings';
import {ModelCall, ScoreResult} from '../src/types';
import {parseUsage} from '../src/services/usage';
import RNFS from 'react-native-fs';

// Exercise the shipped SQL against real SQLite, including views, triggers,
// migrations, atomic score publication and late replies after deletion.
let mockFile = '';
const mockExecute = jest.fn(async (sql: string, params: unknown[] = []) => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
c.row_factory=sqlite3.Row
q=json.load(sys.stdin)
try:
 cursor=c.execute(q['sql'],q['params'])
 rows=[dict(r) for r in cursor.fetchall()]
 c.commit()
 print(json.dumps(rows))
finally:
 c.close()
`,
      mockFile,
    ],
    {input: JSON.stringify({sql, params}), encoding: 'utf8'},
  );
  if (result.status) {
    throw new Error(result.stderr);
  }
  const values = JSON.parse(result.stdout);
  return [
    {rows: {length: values.length, item: (index: number) => values[index]}},
  ];
});
jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(async () => ({executeSql: mockExecute})),
}));
jest.mock('react-native-fs', () => ({
  exists: jest.fn(async () => false),
  readDir: jest.fn(async () => []),
  unlink: jest.fn(async () => undefined),
}));

let directory: string;
let db: typeof import('../src/db/database');
const settings = {...DEFAULT_SETTINGS, apiKey: 'test-key'};
const score: ScoreResult = {
  score: 61,
  bandId: 'pass',
  summary: '总评',
  strengths: [],
  weaknesses: [],
  improvements: ['改进'],
  suggestions: ['建议'],
  annotations: [],
  dimensionScores: {
    thesis: 16,
    content: 14,
    structure: 11,
    language: 14,
    format: 6,
  },
};
const call = (id: string, patch: Partial<ModelCall> = {}): ModelCall => ({
  ...parseUsage({
    input_tokens: 100,
    output_tokens: 20,
    input_tokens_details: {cached_tokens: 60, cache_write_tokens: 10},
  }),
  id,
  operation: 'response',
  model: 'model-test',
  status: 'completed',
  startedAt: '2026-10-09T01:00:00.000Z',
  finishedAt: '2026-10-09T01:00:01.000Z',
  durationMs: 1000,
  responseId: null,
  httpStatus: 200,
  measuredInputTokens: null,
  rawUsageJson: '{}',
  ...patch,
});
async function rows(sql: string, params: unknown[] = []) {
  const [result] = await mockExecute(sql, params);
  return Array.from({length: result.rows.length}, (_, i) =>
    result.rows.item(i),
  );
}
beforeEach(() => {
  jest.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'writer-statistics-'));
  mockFile = join(directory, 'essay.db');
  db = require('../src/db/database');
});
afterEach(() => rmSync(directory, {recursive: true, force: true}));

test('报表按评分日期去重，包含结束日夜间，后续评分不改写过往报表，删除同步移除', async () => {
  const essays = await Promise.all(
    ['a', 'b', 'c', 'd'].map(name => db.createEssay(`file:///${name}.jpg`)),
  );
  const saveAt = async (
    essayId: string,
    runId: string,
    date: Date,
    value = score,
  ) => {
    await db.saveEssayScore(essayId, runId, value, settings);
    await mockExecute(
      'UPDATE score_records SET scored_at = ? WHERE run_id = ?',
      [date.toISOString(), runId],
    );
  };
  const newer = {
    ...score,
    score: 62,
    dimensionScores: {...score.dimensionScores, content: 15},
  };
  await saveAt(
    essays[0].id,
    'before-range',
    new Date(2026, 8, 30, 23, 59, 59, 999),
  );
  await saveAt(essays[0].id, 'first-in-range', new Date(2026, 9, 1));
  await saveAt(essays[0].id, 'last-in-range', new Date(2026, 9, 4, 12), newer);
  await saveAt(
    essays[1].id,
    'end-of-day',
    new Date(2026, 9, 9, 23, 59, 59, 999),
  );
  await saveAt(essays[2].id, 'after-range', new Date(2026, 9, 10));
  const range = {start: '2026-10-01', end: '2026-10-09'};
  const report = await db.getScoreReport(range);
  expect(report.count).toBe(2);
  expect(report.entries.map(entry => entry.id)).toEqual([
    'score_last-in-range',
    'score_end-of-day',
  ]);
  expect(report.average).toMatchObject({total: 61.5, content: 14.5});
  await saveAt(essays[0].id, 'future-regrade', new Date(2026, 9, 12));
  expect(await db.getScoreReport(range)).toEqual(report);
  await db.updateEssay(essays[1].id, {scoreJson: '', status: 'failed'});
  expect((await db.getScoreReport(range)).count).toBe(2);
  await db.deleteEssay(essays[0].id);
  const remaining = await db.getScoreReport(range);
  expect(remaining.count).toBe(1);
  expect(remaining.average?.total).toBe(61);
  expect(
    (await db.getScoreReport({start: '2000-01-01', end: '2000-01-02'})).average,
  ).toBeNull();
}, 30000);

test('评分时间完全相同时报表只取最后保存的一次，并标明旧版估算时间', async () => {
  const essay = await db.createEssay('file:///one.jpg');
  await db.saveEssayScore(essay.id, 'tie-a', score, settings);
  await db.saveEssayScore(
    essay.id,
    'tie-b',
    {
      ...score,
      score: 62,
      dimensionScores: {...score.dimensionScores, content: 15},
    },
    settings,
  );
  await mockExecute('UPDATE score_records SET scored_at = ?, time_source = ?', [
    new Date(2026, 9, 9, 12).toISOString(),
    'legacy_updated_at',
  ]);
  const report = await db.getScoreReport({
    start: '2026-10-09',
    end: '2026-10-09',
  });
  expect(report.count).toBe(1);
  expect(report.entries[0].id).toBe('score_tie-b');
  expect(report.highest).toBe(62);
  expect(report.estimatedCount).toBe(1);
}, 30000);

test('所有阶段、失败重试和计数请求分别入库，总计无重复，未知用量保留', async () => {
  const essay = await db.createEssay('file:///one.jpg');
  await db.saveModelCall(
    essay.id,
    'run-1',
    'vision_ocr',
    call('ocr', {status: 'running', ...parseUsage(undefined)}),
  );
  await db.saveModelCall(essay.id, 'run-1', 'vision_ocr', call('ocr'));
  await db.saveModelCall(essay.id, 'run-1', 'reconcile', call('review'));
  await db.saveModelCall(
    essay.id,
    'run-1',
    'scoring',
    call('failed', {status: 'failed', ...parseUsage(undefined)}),
  );
  await db.saveModelCall(essay.id, 'run-2', 'scoring', call('retry'));
  await db.saveModelCall(
    essay.id,
    'run-2',
    'scoring',
    call('count', {
      operation: 'count',
      measuredInputTokens: 9999,
      ...parseUsage({input_tokens: 9999, output_tokens: 1}),
    }),
  );
  const usage = await db.getEssayUsage(essay.id);
  expect(usage.total).toMatchObject({
    callCount: 5,
    failedCount: 1,
    countCallCount: 1,
    inputTokens: 300,
    outputTokens: 60,
    totalTokens: 360,
    cacheReadTokens: 180,
    cacheWriteTokens: 30,
    missing: {inputTokens: 1, cacheWriteTokens: 1},
  });
  expect(usage.stages.scoring).toMatchObject({
    callCount: 3,
    inputTokens: 100,
    outputTokens: 20,
  });
  expect(usage.calls.filter(item => item.id === 'ocr')).toHaveLength(1);
  expect(usage.calls.map(item => item.runId)).toEqual([
    'run-1',
    'run-1',
    'run-1',
    'run-2',
    'run-2',
  ]);
  jest.resetModules();
  db = require('../src/db/database');
  expect((await db.getEssayUsage(essay.id)).total).toEqual(usage.total);
}, 30000);

test('总分和分项按时间保留历史，JSON 与数字同时保存，重复提交不会多记', async () => {
  const essay = await db.createEssay('file:///one.jpg');
  await db.saveEssayScore(essay.id, 'first', score, settings);
  await db.saveEssayScore(essay.id, 'first', score, settings);
  expect(await rows('SELECT * FROM score_records')).toHaveLength(1);
  expect((await db.getEssay(essay.id))?.status).toBe('completed');
  await db.updateEssay(essay.id, {scoreJson: '', status: 'scoring'});
  expect(
    (await rows('SELECT is_current FROM score_records'))[0].is_current,
  ).toBe(0);
  const newer = {
    ...score,
    score: 62,
    dimensionScores: {...score.dimensionScores, content: 15},
  };
  await db.saveEssayScore(essay.id, 'second', newer, settings);
  const saved = await rows('SELECT * FROM score_records ORDER BY rowid');
  expect(saved.map(item => item.total_score)).toEqual([61, 62]);
  expect(saved.map(item => item.is_current)).toEqual([0, 1]);
  expect(saved[1]).toMatchObject({
    thesis_score: 16,
    content_score: 15,
    structure_score: 11,
    language_score: 14,
    format_score: 6,
    time_source: 'scored_at',
    model: settings.modelName,
    roundtable_size: 0,
  });
  expect(Date.parse(saved[1].scored_at)).toBeGreaterThan(0);
  expect(JSON.parse((await db.getEssay(essay.id))!.scoreJson).score).toBe(62);
  await expect(
    db.saveEssayScore(essay.id, 'bad', {...score, score: 100}, settings),
  ).rejects.toThrow();
  expect(await rows('SELECT * FROM score_records')).toHaveLength(2);
  expect(JSON.parse((await db.getEssay(essay.id))!.scoreJson).score).toBe(62);
}, 30000);

test('单篇和按时间删除都清除统计；迟到响应不会重建记录，清日志不删统计', async () => {
  const essays = await Promise.all(
    ['one', 'two', 'three'].map(name => db.createEssay(`file:///${name}.jpg`)),
  );
  for (const essay of essays) {
    await db.saveModelCall(essay.id, essay.id, 'scoring', call(essay.id));
    await db.saveEssayScore(essay.id, essay.id, score, settings);
    await db.saveScoreAttempt(essay.id, 'source', 'output', '');
  }
  await db.clearLogsAndCache();
  expect(await rows('SELECT * FROM model_calls')).toHaveLength(3);
  await db.deleteEssay(essays[0].id);
  await db.saveModelCall(essays[0].id, 'late', 'scoring', call('late'));
  await db.saveEssayScore(essays[0].id, 'late', score, settings);
  await db.saveScoreAttempt(essays[0].id, 'source', 'output', '');
  await db.updateStep(essays[0].id, 'scoring', 'success', 'late');
  for (const table of [
    'model_calls',
    'score_records',
    'score_attempts',
    'pipeline_steps',
    'app_logs',
  ]) {
    expect(
      await rows(`SELECT * FROM ${table} WHERE essay_id = ?`, [essays[0].id]),
    ).toHaveLength(0);
  }
  await mockExecute('UPDATE essays SET created_at = ? WHERE id = ?', [
    '2000-01-01T00:00:00.000Z',
    essays[1].id,
  ]);
  await db.clearEssaysBefore(new Date('2001-01-01T00:00:00.000Z'));
  expect(await rows('SELECT essay_id FROM model_calls')).toEqual([
    {essay_id: essays[2].id},
  ]);
  expect(await rows('SELECT essay_id FROM score_records')).toEqual([
    {essay_id: essays[2].id},
  ]);
  expect((await db.getEssayUsage(essays[0].id)).total.callCount).toBe(0);
}, 30000);

test('旧评分迁移不伪造用量或精确评分时间；中断请求可识别且不重复迁移', async () => {
  const essay = await db.createEssay('file:///old.jpg');
  await db.updateEssay(essay.id, {
    scoreJson: JSON.stringify(score),
    status: 'completed',
    updatedAt: '2026-01-01T12:00:00.000Z',
  });
  await mockExecute('PRAGMA user_version = 5');
  await db.saveModelCall(
    essay.id,
    'run-old',
    'scoring',
    call('interrupted', {
      status: 'running',
      finishedAt: null,
      durationMs: null,
      ...parseUsage(undefined),
    }),
  );
  jest.resetModules();
  db = require('../src/db/database');
  await db.initDatabase();
  const saved = await rows('SELECT * FROM score_records');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    total_score: 61,
    scored_at: '2026-01-01T12:00:00.000Z',
    time_source: 'legacy_updated_at',
    model: null,
  });
  const usage = await db.getEssayUsage(essay.id);
  expect(usage.total).toMatchObject({
    callCount: 1,
    inputTokens: null,
    failedCount: 1,
  });
  expect(usage.calls[0]).toMatchObject({
    status: 'interrupted',
    finishedAt: null,
  });
  jest.resetModules();
  db = require('../src/db/database');
  await db.initDatabase();
  expect(await rows('SELECT * FROM score_records')).toHaveLength(1);
  expect((await rows('PRAGMA user_version'))[0].user_version).toBe(6);
}, 30000);

test('新作文与三个步骤原子入库，任一步骤失败都不留下半条记录', async () => {
  await db.initDatabase();
  await mockExecute(`CREATE TRIGGER fail_stage BEFORE INSERT ON pipeline_steps
    WHEN NEW.step = 'reconcile' BEGIN SELECT RAISE(ABORT, 'stage storage failed'); END`);
  await expect(db.createEssay('file:///one.jpg')).rejects.toThrow('stage storage failed');
  expect(await rows('SELECT * FROM essays')).toHaveLength(0);
  expect(await rows('SELECT * FROM pipeline_steps')).toHaveLength(0);
  await mockExecute('DROP TRIGGER fail_stage');
  const essay = await db.createEssay('file:///one.jpg', 'english');
  expect(essay.writingType).toBe('english');
  expect((await db.getSteps(essay.id)).map(item => item.step)).toEqual(['vision_ocr', 'reconcile', 'scoring']);
}, 30000);

test.each(['single', 'time'] as const)('%s 删除数据库失败时，图片、流程和历史仍完整保留', async mode => {
  const essay = await db.createEssay('file:///one.jpg');
  await db.saveEssayScore(essay.id, 'keep-score', score, settings);
  await db.saveModelCall(essay.id, 'keep-call', 'scoring', call('keep-call'));
  await db.saveScoreAttempt(essay.id, 'source', 'output', '');
  await mockExecute('UPDATE essays SET created_at = ?', ['2000-01-01T00:00:00.000Z']);
  await mockExecute(`CREATE TRIGGER fail_delete BEFORE DELETE ON essays
    BEGIN SELECT RAISE(ABORT, 'delete failed'); END`);
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
  (RNFS.unlink as jest.Mock).mockClear();
  try {
    await expect(mode === 'single' ? db.deleteEssay(essay.id) : db.clearEssaysBefore(new Date('2001-01-01T00:00:00.000Z')))
      .rejects.toThrow('delete failed');
    expect(await db.getEssay(essay.id)).toBeDefined();
    expect(await db.getSteps(essay.id)).toHaveLength(3);
    expect(await db.getScoreAttempts(essay.id)).toHaveLength(1);
    expect((await db.getEssayUsage(essay.id)).total.callCount).toBe(1);
    expect(await rows('SELECT * FROM score_records')).toHaveLength(1);
    expect(RNFS.unlink).not.toHaveBeenCalled();
  } finally {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
  }
}, 30000);

test('整套 API 设置原子保存，写入失败不留下新地址配旧模型', async () => {
  const before = await db.getSettings();
  await mockExecute(`CREATE TRIGGER fail_settings BEFORE INSERT ON settings
    WHEN NEW.key = 'modelName' AND NEW.value = 'new-model'
    BEGIN SELECT RAISE(ABORT, 'settings write failed'); END`);
  await expect(db.saveSettings({...before, apiBaseUrl: 'https://new.example.com/v1', apiKey: 'new-test-key', modelName: 'new-model'}))
    .rejects.toThrow('settings write failed');
  expect(await db.getSettings()).toEqual(before);
}, 30000);

test('英语准入调整、重评、报表和删除使用英语历史，不混入中文记录', async () => {
  const chinese = await db.createEssay('file:///chinese.jpg');
  const english = await db.createEssay('file:///english.jpg', 'english');
  const englishScore: ScoreResult = {
    ...score, score: 79, bandId: 'good', admissionAdjustment: 6,
    admissionReason: '一处语言错误未达到第三档条件',
    dimensionScores: {task: 18, content: 17, organization: 13, language: 29, format: 8},
  };
  await db.saveEssayScore(chinese.id, 'chinese', score, settings);
  await db.saveEssayScore(english.id, 'english-a', englishScore, settings, 'english');
  const range = {start: '2000-01-01', end: '2099-12-31'};
  expect((await db.getScoreReport(range)).entries.map(entry => entry.essayId)).toEqual([chinese.id]);
  const initial = await db.getScoreReport(range, 'english');
  expect(initial.entries[0]).toMatchObject({essayId: english.id, scores: {total: 79, language: 29}, admissionAdjustment: 6});
  expect(initial.average?.task).toBe(18);
  expect(JSON.parse((await db.getEssay(english.id))!.scoreJson)).toEqual(englishScore);
  await db.saveEssayScore(english.id, 'english-b', {...englishScore, admissionAdjustment: 0, admissionReason: '无准入调整', score: 85, bandId: 'high'}, settings, 'english');
  expect((await db.getScoreReport(range, 'english')).count).toBe(1);
  expect((await rows('SELECT is_current FROM writing_score_records ORDER BY rowid')).map(item => item.is_current)).toEqual([0, 1]);
  await mockExecute('UPDATE essays SET created_at = ?', ['2000-01-01T00:00:00.000Z']);
  await db.clearEssaysBefore(new Date('2001-01-01T00:00:00.000Z'), 'english');
  expect(await db.getEssay(chinese.id)).toBeDefined();
  expect(await rows('SELECT * FROM writing_score_records')).toHaveLength(0);
  await db.saveEssayScore(english.id, 'late-english', englishScore, settings, 'english');
  expect(await rows('SELECT * FROM writing_score_records')).toHaveLength(0);
}, 30000);

test('英语历史分项损坏时明确报错，不伪造为零分统计', async () => {
  const essay = await db.createEssay('file:///english.jpg', 'english');
  const englishScore = {...score, score: 60, dimensionScores: {task: 12, content: 12, organization: 9, language: 21, format: 6}};
  await db.saveEssayScore(essay.id, 'english', englishScore, settings, 'english');
  await mockExecute('UPDATE writing_score_records SET dimension_scores_json = ?', ['null']);
  await expect(db.getScoreReport({start: '2000-01-01', end: '2099-12-31'}, 'english')).rejects.toThrow('分项数据无效');
}, 30000);
