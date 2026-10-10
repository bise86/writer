import {SQLiteDatabase} from 'react-native-sqlite-storage';
import {
  AppSettings,
  EssayUsage,
  ModelCall,
  ScoreResult,
  StepId,
  TokenUsage,
  UsageSummary,
  WritingType,
} from '../types';
import {TOKEN_FIELDS} from '../services/usage';
import {getWritingProfile, normalizeWritingType} from '../services/writing';

const columns = Object.values(TOKEN_FIELDS);
const dimensions = [
  'thesis',
  'content',
  'structure',
  'language',
  'format',
] as const;

export async function initializeStatistics(
  database: SQLiteDatabase,
  backfill: boolean,
) {
  await database.executeSql(`CREATE TABLE IF NOT EXISTS model_calls (
    id TEXT PRIMARY KEY NOT NULL, essay_id TEXT NOT NULL, run_id TEXT NOT NULL,
    stage TEXT NOT NULL, operation TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, response_id TEXT, http_status INTEGER,
    ${columns
      .map(
        column =>
          `${column} INTEGER CHECK (${column} IS NULL OR ${column} >= 0)`,
      )
      .join(', ')},
    measured_input_tokens INTEGER, raw_usage_json TEXT
  )`);
  await database.executeSql(
    'CREATE INDEX IF NOT EXISTS model_calls_essay_stage_time ON model_calls (essay_id, stage, started_at)',
  );
  await database.executeSql(
    'CREATE INDEX IF NOT EXISTS model_calls_time_model ON model_calls (started_at, model)',
  );
  await database.executeSql(`CREATE TABLE IF NOT EXISTS score_records (
    id TEXT PRIMARY KEY NOT NULL, essay_id TEXT NOT NULL, run_id TEXT, model TEXT,
    roundtable_size INTEGER, rubric_version TEXT, scored_at TEXT NOT NULL,
    time_source TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1,
    total_score INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 100), band_id TEXT NOT NULL,
    thesis_score INTEGER NOT NULL CHECK (thesis_score BETWEEN 0 AND 25),
    content_score INTEGER NOT NULL CHECK (content_score BETWEEN 0 AND 25),
    structure_score INTEGER NOT NULL CHECK (structure_score BETWEEN 0 AND 20),
    language_score INTEGER NOT NULL CHECK (language_score BETWEEN 0 AND 20),
    format_score INTEGER NOT NULL CHECK (format_score BETWEEN 0 AND 10),
    score_json TEXT NOT NULL,
    CHECK (total_score = thesis_score + content_score + structure_score + language_score + format_score)
  )`);
  await database.executeSql(
    'CREATE INDEX IF NOT EXISTS score_records_essay_time ON score_records (essay_id, scored_at)',
  );
  await database.executeSql(
    'CREATE INDEX IF NOT EXISTS score_records_time ON score_records (scored_at)',
  );
  // English has a 35-point language dimension, so its dimension values are
  // stored as JSON instead of being forced into the Chinese fixed columns.
  await database.executeSql(`CREATE TABLE IF NOT EXISTS writing_score_records (
    id TEXT PRIMARY KEY NOT NULL, essay_id TEXT NOT NULL, writing_type TEXT NOT NULL,
    run_id TEXT, model TEXT, roundtable_size INTEGER, rubric_version TEXT,
    scored_at TEXT NOT NULL, time_source TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1,
    total_score INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 100), band_id TEXT NOT NULL,
    dimension_scores_json TEXT NOT NULL, score_json TEXT NOT NULL
  )`);
  await database.executeSql(
    'CREATE INDEX IF NOT EXISTS writing_score_records_essay_time ON writing_score_records (essay_id, scored_at)',
  );
  // One insert atomically saves all numeric scores and the completed essay.
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS score_records_publish AFTER INSERT ON score_records BEGIN
    UPDATE score_records SET is_current = 0 WHERE essay_id = NEW.essay_id AND id != NEW.id;
    UPDATE essays SET score_json = NEW.score_json, status = 'completed', error = '', updated_at = NEW.scored_at WHERE id = NEW.essay_id;
  END`);
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS score_records_invalidate AFTER UPDATE OF score_json ON essays
    WHEN NEW.score_json = '' BEGIN UPDATE score_records SET is_current = 0 WHERE essay_id = NEW.id; END`);
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS writing_score_records_publish AFTER INSERT ON writing_score_records BEGIN
    UPDATE writing_score_records SET is_current = 0 WHERE essay_id = NEW.essay_id AND id != NEW.id;
    UPDATE essays SET score_json = NEW.score_json, status = 'completed', error = '', updated_at = NEW.scored_at WHERE id = NEW.essay_id;
  END`);
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS writing_score_records_invalidate AFTER UPDATE OF score_json ON essays
    WHEN NEW.score_json = '' BEGIN UPDATE writing_score_records SET is_current = 0 WHERE essay_id = NEW.id; END`);
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS essay_statistics_delete AFTER DELETE ON essays BEGIN
    DELETE FROM model_calls WHERE essay_id = OLD.id;
    DELETE FROM score_records WHERE essay_id = OLD.id;
    DELETE FROM score_attempts WHERE essay_id = OLD.id;
    DELETE FROM pipeline_steps WHERE essay_id = OLD.id;
    DELETE FROM app_logs WHERE essay_id = OLD.id;
  END`);
  await database.executeSql(`CREATE TRIGGER IF NOT EXISTS essay_statistics_delete_writing AFTER DELETE ON essays BEGIN
    DELETE FROM writing_score_records WHERE essay_id = OLD.id;
  END`);
  const totals = `COUNT(*) AS call_count,
    SUM(CASE WHEN status IN ('failed', 'incomplete', 'interrupted') THEN 1 ELSE 0 END) AS failed_count,
    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
    SUM(CASE WHEN operation = 'count' THEN 1 ELSE 0 END) AS count_call_count,
    ${columns
      .map(
        column =>
          `SUM(${column}) AS ${column}, SUM(CASE WHEN operation != 'count' AND ${column} IS NULL THEN 1 ELSE 0 END) AS ${column}_missing`,
      )
      .join(', ')}`;
  await database.executeSql(`CREATE VIEW IF NOT EXISTS model_usage_by_stage AS
    SELECT essay_id, stage, ${totals} FROM model_calls GROUP BY essay_id, stage`);
  await database.executeSql(`CREATE VIEW IF NOT EXISTS model_usage_by_essay AS
    SELECT essay_id, ${totals} FROM model_calls GROUP BY essay_id`);
  if (backfill) {
    const [rows] = await database.executeSql(
      "SELECT id, score_json, updated_at FROM essays WHERE score_json != '' AND status = 'completed'",
    );
    for (let i = 0; i < rows.rows.length; i++) {
      const row = rows.rows.item(i);
      let score: ScoreResult;
      try {
        score = JSON.parse(row.score_json);
      } catch {
        continue;
      }
      if (!validNumbers(score)) {
        continue;
      }
      // The original model and exact scoring time were not stored in old apps.
      // Preserve that uncertainty rather than assigning today's time/model.
      await insertScore(
        database,
        row.id,
        `legacy_${row.id}`,
        score,
        row.updated_at,
        'legacy_updated_at',
        null,
        null,
        null,
        null,
      );
    }
  }
  await database.executeSql(
    "UPDATE model_calls SET status = 'interrupted' WHERE status = 'running'",
  );
}

function validNumbers(
  score: ScoreResult,
  writingType: WritingType = 'chinese',
) {
  const rules = getWritingProfile(writingType).rules;
  return (
    score &&
    Number.isInteger(score.score) &&
    typeof score.bandId === 'string' &&
    rules.dimensions.every(
      item =>
        Number.isInteger(score.dimensionScores?.[item.id]) &&
        score.dimensionScores[item.id] >= 0 &&
        score.dimensionScores[item.id] <= item.max,
    ) &&
    rules.dimensions.reduce(
      (sum, item) => sum + score.dimensionScores[item.id],
      0,
    ) === score.score
  );
}

async function insertScore(
  database: SQLiteDatabase,
  essayId: string,
  id: string,
  score: ScoreResult,
  scoredAt: string,
  timeSource: string,
  runId: string | null,
  model: string | null,
  roundtableSize: number | null,
  rubricVersion: string | null,
  writingType: WritingType = 'chinese',
) {
  const type = normalizeWritingType(writingType);
  if (!validNumbers(score, type)) {
    throw new Error('评分数值无效，不能保存统计记录');
  }
  if (type !== 'chinese') {
    await database.executeSql(
      `INSERT OR IGNORE INTO writing_score_records
      (id, essay_id, writing_type, run_id, model, roundtable_size, rubric_version, scored_at, time_source,
       total_score, band_id, dimension_scores_json, score_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM essays WHERE id = ?)`,
      [
        id,
        essayId,
        type,
        runId,
        model,
        roundtableSize,
        rubricVersion,
        scoredAt,
        timeSource,
        score.score,
        score.bandId,
        JSON.stringify(score.dimensionScores),
        JSON.stringify(score),
        essayId,
      ],
    );
    return;
  }
  await database.executeSql(
    `INSERT OR IGNORE INTO score_records
    (id, essay_id, run_id, model, roundtable_size, rubric_version, scored_at, time_source,
     total_score, band_id, thesis_score, content_score, structure_score, language_score, format_score, score_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM essays WHERE id = ?)`,
    [
      id,
      essayId,
      runId,
      model,
      roundtableSize,
      rubricVersion,
      scoredAt,
      timeSource,
      score.score,
      score.bandId,
      ...dimensions.map(key => score.dimensionScores[key]),
      JSON.stringify(score),
      essayId,
    ],
  );
}

export async function storeScore(
  database: SQLiteDatabase,
  essayId: string,
  runId: string,
  score: ScoreResult,
  settings: AppSettings,
  rubricVersion: string,
  writingType: WritingType = 'chinese',
) {
  await insertScore(
    database,
    essayId,
    `score_${runId}`,
    score,
    new Date().toISOString(),
    'scored_at',
    runId,
    settings.modelName,
    settings.roundtableSize,
    rubricVersion,
    writingType,
  );
}

export async function storeModelCall(
  database: SQLiteDatabase,
  essayId: string,
  runId: string,
  stage: StepId,
  call: ModelCall,
) {
  const values = [
    call.id,
    essayId,
    runId,
    stage,
    call.operation,
    call.model,
    call.status,
    call.startedAt,
    call.finishedAt,
    call.durationMs,
    call.responseId,
    call.httpStatus,
    ...Object.keys(TOKEN_FIELDS).map(key => call[key as keyof TokenUsage]),
    call.measuredInputTokens,
    call.rawUsageJson,
  ];
  // A late response after deletion must never recreate a child's orphaned row.
  await database.executeSql(
    `INSERT OR REPLACE INTO model_calls
    (id, essay_id, run_id, stage, operation, model, status, started_at, finished_at, duration_ms, response_id, http_status,
     ${columns.join(', ')}, measured_input_tokens, raw_usage_json)
    SELECT ${values
      .map(() => '?')
      .join(', ')} WHERE EXISTS (SELECT 1 FROM essays WHERE id = ?)`,
    [...values, essayId],
  );
}

export function emptyUsage(): UsageSummary {
  return {
    callCount: 0,
    failedCount: 0,
    runningCount: 0,
    countCallCount: 0,
    ...Object.fromEntries(Object.keys(TOKEN_FIELDS).map(key => [key, 0])),
    missing: Object.fromEntries(Object.keys(TOKEN_FIELDS).map(key => [key, 0])),
  } as UsageSummary;
}
function summary(row: Record<string, number | null>): UsageSummary {
  const result = emptyUsage();
  result.callCount = row.call_count || 0;
  result.failedCount = row.failed_count || 0;
  result.runningCount = row.running_count || 0;
  result.countCallCount = row.count_call_count || 0;
  for (const [key, column] of Object.entries(TOKEN_FIELDS)) {
    result[key as keyof TokenUsage] = row[column];
    result.missing[key as keyof TokenUsage] = row[`${column}_missing`] || 0;
  }
  return result;
}
export async function readEssayUsage(
  database: SQLiteDatabase,
  essayId: string,
): Promise<EssayUsage> {
  const [stages] = await database.executeSql(
    'SELECT * FROM model_usage_by_stage WHERE essay_id = ?',
    [essayId],
  );
  const [total] = await database.executeSql(
    'SELECT * FROM model_usage_by_essay WHERE essay_id = ?',
    [essayId],
  );
  const result: EssayUsage = {
    total: total.rows.length ? summary(total.rows.item(0)) : emptyUsage(),
    stages: {},
    calls: [],
  };
  for (let i = 0; i < stages.rows.length; i++) {
    const row = stages.rows.item(i);
    result.stages[row.stage as StepId] = summary(row);
  }
  const [calls] = await database.executeSql(
    'SELECT * FROM model_calls WHERE essay_id = ? ORDER BY started_at, rowid',
    [essayId],
  );
  for (let i = 0; i < calls.rows.length; i++) {
    const row = calls.rows.item(i);
    result.calls.push({
      id: row.id,
      runId: row.run_id,
      stage: row.stage,
      operation: row.operation,
      model: row.model,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      responseId: row.response_id,
      httpStatus: row.http_status,
      measuredInputTokens: row.measured_input_tokens,
      rawUsageJson: row.raw_usage_json,
      ...Object.fromEntries(
        Object.entries(TOKEN_FIELDS).map(([key, column]) => [key, row[column]]),
      ),
    } as EssayUsage['calls'][number]);
  }
  return result;
}
