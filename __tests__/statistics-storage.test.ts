import {spawnSync} from 'child_process';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {DEFAULT_SETTINGS} from '../src/settings';
import {ModelCall, ScoreResult} from '../src/types';
import {parseUsage} from '../src/services/usage';

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
      ...parseUsage(undefined),
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
