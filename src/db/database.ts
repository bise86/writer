import SQLite, {SQLiteDatabase, ResultSet} from 'react-native-sqlite-storage';
import RNFS from 'react-native-fs';
import {
  AppSettings,
  Essay,
  PipelineStep,
  ScoreAttempt,
  StepId,
  StepStatus,
  ModelCall,
  ScoreResult,
  WritingType,
} from '../types';
import {
  initializeStatistics,
  readEssayUsage,
  storeModelCall,
  storeScore,
} from './statistics';
import {readScoreReport} from './reports';
import {ReportRange} from '../services/reports';
import {recognizedTitle} from '../services/essay-text';
import {
  DEFAULT_SETTINGS,
  legacyDefaultChanges,
  normalizeReasoningEffort,
  ROUNDTABLE_OPTIONS,
  validateSettings,
} from '../settings';
import {getWritingProfile, normalizeWritingType} from '../services/writing';

SQLite.enablePromise(true);

let dbPromise: Promise<SQLiteDatabase> | undefined;

async function db() {
  if (!dbPromise) {
    dbPromise = initializeDatabase().catch(error => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}

async function initializeDatabase() {
  const database = await SQLite.openDatabase({
    name: 'essay_lens.db',
    location: 'default',
  });
  await database.executeSql(`
      CREATE TABLE IF NOT EXISTS essays (
        id TEXT PRIMARY KEY NOT NULL,
        writing_type TEXT NOT NULL DEFAULT 'chinese',
        title TEXT NOT NULL DEFAULT '',
        image_uri TEXT NOT NULL,
        image_uris TEXT NOT NULL DEFAULT '[]',
        local_ocr TEXT NOT NULL DEFAULT '',
        vision_ocr TEXT NOT NULL DEFAULT '',
        canonical_text TEXT NOT NULL DEFAULT '',
        corrections TEXT NOT NULL DEFAULT '',
        score_json TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
  await database.executeSql(`
      CREATE TABLE IF NOT EXISTS pipeline_steps (
        essay_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        retry_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (essay_id, step)
      )`);
  await database.executeSql(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`);
  await database.executeSql(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        essay_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
  const [version] = await database.executeSql('PRAGMA user_version');
  if (version.rows.item(0).user_version < 1) {
    const [result] = await database.executeSql(
      'SELECT key, value FROM settings',
    );
    const stored: Record<string, string> = {};
    for (let i = 0; i < result.rows.length; i += 1) {
      const item = result.rows.item(i);
      stored[item.key] = item.value;
    }
    for (const [key, value] of Object.entries(legacyDefaultChanges(stored))) {
      await database.executeSql('UPDATE settings SET value = ? WHERE key = ?', [
        value,
        key,
      ]);
    }
    await database.executeSql('PRAGMA user_version = 1');
  }
  if (version.rows.item(0).user_version < 2) {
    await database.executeSql('DELETE FROM settings WHERE key = ?', [
      'visionModelName',
    ]);
    await database.executeSql('PRAGMA user_version = 2');
  }
  if (version.rows.item(0).user_version < 3) {
    const [columns] = await database.executeSql('PRAGMA table_info(essays)');
    let hasImageUris = false;
    for (let i = 0; i < columns.rows.length; i += 1) {
      hasImageUris ||= columns.rows.item(i).name === 'image_uris';
    }
    // Fresh installs already have this column. An interrupted upgrade may also
    // have added it before user_version was written. Inspect instead of raising
    // and attempting to recognize a platform-dependent native error object.
    if (!hasImageUris) {
      await database.executeSql(
        "ALTER TABLE essays ADD COLUMN image_uris TEXT NOT NULL DEFAULT '[]'",
      );
    }
    const [essays] = await database.executeSql(
      "SELECT id, image_uri FROM essays WHERE image_uris = '[]' OR image_uris IS NULL",
    );
    for (let i = 0; i < essays.rows.length; i += 1) {
      const item = essays.rows.item(i);
      await database.executeSql(
        'UPDATE essays SET image_uris = ? WHERE id = ?',
        [JSON.stringify([item.image_uri]), item.id],
      );
    }
    await database.executeSql('PRAGMA user_version = 3');
  }
  if (version.rows.item(0).user_version < 4) {
    // 5K was the previous application default. Move only that untouched value
    // to the new 32K default; user-selected output budgets remain unchanged.
    await database.executeSql(
      'UPDATE settings SET value = ? WHERE key = ? AND value = ?',
      [String(DEFAULT_SETTINGS.maxOutputTokens), 'maxOutputTokens', '5000'],
    );
    await database.executeSql('PRAGMA user_version = 4');
  }
  await database.executeSql(`CREATE TABLE IF NOT EXISTS score_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    essay_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    output TEXT NOT NULL,
    feedback TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  // Per-role orchestration is replaced by one model-led grading request.
  // Only the obsolete intermediate cache is removed; essays and scores stay intact.
  await database.executeSql('DROP TABLE IF EXISTS roundtable_sessions');
  if (version.rows.item(0).user_version < 5) {
    // Migrate the previous application default. Any user-selected budget remains
    // intact; missing values are seeded from DEFAULT_SETTINGS below.
    await database.executeSql(
      'UPDATE settings SET value = ? WHERE key = ? AND value = ?',
      [String(DEFAULT_SETTINGS.maxOutputTokens), 'maxOutputTokens', '5000'],
    );
    await database.executeSql('PRAGMA user_version = 5');
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await database.executeSql(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      [key, String(value)],
    );
  }
  await initializeStatistics(database, version.rows.item(0).user_version < 6);
  if (version.rows.item(0).user_version < 6) {
    await database.executeSql('PRAGMA user_version = 6');
  }
  // The writing type column is migrated by inspecting the live table instead
  // of bumping the historical schema version, so older clients that expect
  // version 6 remain compatible while the operation stays idempotent.
  {
    const [columns] = await database.executeSql('PRAGMA table_info(essays)');
    let hasWritingType = false;
    for (let i = 0; i < columns.rows.length; i += 1) {
      hasWritingType ||= columns.rows.item(i).name === 'writing_type';
    }
    if (!hasWritingType) {
      await database.executeSql(
        "ALTER TABLE essays ADD COLUMN writing_type TEXT NOT NULL DEFAULT 'chinese'",
      );
    }
    await database.executeSql(
      "UPDATE essays SET writing_type = 'chinese' WHERE writing_type IS NULL OR writing_type = ''",
    );
  }
  // Initialization runs once before the app starts any pipeline. Native process
  // termination leaves stored progress behind, but no request is still running.
  // Preserve OCR and model outputs so the normal retry path can resume them.
  const interrupted =
    "('queued', 'local_ocr', 'vision_ocr', 'reconcile', 'scoring')";
  const message = '上次处理已中断，点击重试可从已保存的进度继续。';
  const now = new Date().toISOString();
  await database.executeSql(
    `UPDATE pipeline_steps SET status = 'failed', detail = detail || ?, updated_at = ?
     WHERE status = 'running' AND essay_id IN (SELECT id FROM essays WHERE status IN ${interrupted})`,
    [`\n${message}`, now],
  );
  await database.executeSql(
    `UPDATE essays SET status = 'failed', error = ?, updated_at = ? WHERE status IN ${interrupted}`,
    [message, now],
  );
  return database;
}

function parseImageUris(value: unknown, fallback: string): string[] {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (Array.isArray(parsed)) {
      const values = parsed.filter(uri => typeof uri === 'string' && uri);
      if (values.length) {
        return values;
      }
    }
  } catch (_) {
    // Older rows only have image_uri.
  }
  return fallback ? [fallback] : [];
}

function row<T>(result: ResultSet, index = 0): T | undefined {
  return result.rows.length > index
    ? (result.rows.item(index) as T)
    : undefined;
}

export async function createEssay(
  imageInput: string | string[],
  writingType: WritingType = 'chinese',
): Promise<Essay> {
  const database = await db();
  const imageUris = (
    Array.isArray(imageInput) ? imageInput : [imageInput]
  ).filter(uri => typeof uri === 'string' && uri.trim());
  if (!imageUris.length) {
    throw new Error('至少需要一张作文图片');
  }
  const imageUri = imageUris[0];
  const now = new Date().toISOString();
  const id = `essay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await database.executeSql(
    'INSERT INTO essays (id, writing_type, image_uri, image_uris, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      normalizeWritingType(writingType),
      imageUri,
      JSON.stringify(imageUris),
      'queued',
      now,
      now,
    ],
  );
  for (const step of ['vision_ocr', 'reconcile', 'scoring'] as StepId[]) {
    await database.executeSql(
      'INSERT INTO pipeline_steps (essay_id, step, status, updated_at) VALUES (?, ?, ?, ?)',
      [id, step, 'pending', now],
    );
  }
  return (await getEssay(id))!;
}

export async function getEssay(id: string): Promise<Essay | undefined> {
  const database = await db();
  const [result] = await database.executeSql(
    'SELECT * FROM essays WHERE id = ?',
    [id],
  );
  const value = row<any>(result);
  if (!value) {
    return undefined;
  }
  return {
    id: value.id,
    writingType: normalizeWritingType(value.writing_type),
    title:
      value.canonical_text || value.vision_ocr
        ? recognizedTitle(value.canonical_text || value.vision_ocr)
        : value.title || '',
    imageUri: value.image_uri,
    imageUris: parseImageUris(value.image_uris, value.image_uri),
    localOcr: value.local_ocr,
    visionOcr: value.vision_ocr,
    canonicalText: value.canonical_text,
    corrections: value.corrections,
    scoreJson: value.score_json,
    status: value.status,
    error: value.error,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

export async function listEssays(): Promise<Essay[]> {
  const database = await db();
  const [result] = await database.executeSql(
    'SELECT * FROM essays ORDER BY created_at DESC',
  );
  const values: Essay[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const value = result.rows.item(i);
    values.push({
      id: value.id,
      writingType: normalizeWritingType(value.writing_type),
      title:
        value.canonical_text || value.vision_ocr
          ? recognizedTitle(value.canonical_text || value.vision_ocr)
          : value.title || '',
      imageUri: value.image_uri,
      imageUris: parseImageUris(value.image_uris, value.image_uri),
      localOcr: value.local_ocr,
      visionOcr: value.vision_ocr,
      canonicalText: value.canonical_text,
      corrections: value.corrections,
      scoreJson: value.score_json,
      status: value.status,
      error: value.error,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    });
  }
  return values;
}

export async function updateEssay(
  id: string,
  patch: Partial<Record<string, string>>,
) {
  const database = await db();
  const columns: Record<string, string> = {
    title: 'title',
    imageUri: 'image_uri',
    localOcr: 'local_ocr',
    visionOcr: 'vision_ocr',
    canonicalText: 'canonical_text',
    corrections: 'corrections',
    scoreJson: 'score_json',
    status: 'status',
    error: 'error',
    updatedAt: 'updated_at',
  };
  const entries = Object.entries(patch).filter(([key]) => columns[key]);
  if (!entries.length) {
    return;
  }
  const sql = `UPDATE essays SET ${entries
    .map(([key]) => `${columns[key]} = ?`)
    .join(', ')} WHERE id = ?`;
  await database.executeSql(sql, [
    ...entries.map(([, value]) => value ?? ''),
    id,
  ]);
}

export async function getSteps(essayId: string): Promise<PipelineStep[]> {
  const database = await db();
  const [result] = await database.executeSql(
    'SELECT * FROM pipeline_steps WHERE essay_id = ? ORDER BY rowid',
    [essayId],
  );
  const values: PipelineStep[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const value = result.rows.item(i);
    values.push({
      essayId,
      step: value.step,
      status: value.status,
      detail: value.detail,
      retryCount: value.retry_count,
      updatedAt: value.updated_at,
    });
  }
  return values;
}

export async function updateStep(
  essayId: string,
  step: StepId,
  status: StepStatus,
  detail: string,
  retryCount?: number,
) {
  const database = await db();
  const now = new Date().toISOString();
  if (retryCount === undefined) {
    await database.executeSql(
      'UPDATE pipeline_steps SET status = ?, detail = ?, updated_at = ? WHERE essay_id = ? AND step = ?',
      [status, detail, now, essayId, step],
    );
  } else {
    await database.executeSql(
      'UPDATE pipeline_steps SET status = ?, detail = ?, retry_count = ?, updated_at = ? WHERE essay_id = ? AND step = ?',
      [status, detail, retryCount, now, essayId, step],
    );
  }
  await database.executeSql(
    'INSERT INTO app_logs (essay_id, level, message, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM essays WHERE id = ?)',
    [
      essayId,
      status === 'failed' ? 'error' : 'info',
      `${step}: ${detail}`,
      now,
      essayId,
    ],
  );
}

async function removeEssayImages(rows: ResultSet) {
  for (let i = 0; i < rows.rows.length; i += 1) {
    const item = rows.rows.item(i);
    const uris = parseImageUris(item.image_uris, String(item.image_uri || ''));
    for (const raw of uris) {
      if (
        !raw ||
        raw.startsWith('data:') ||
        raw.startsWith('content://') ||
        raw.startsWith('http://') ||
        raw.startsWith('https://')
      ) {
        continue;
      }
      const uri = raw.startsWith('file://') ? raw.slice(7) : raw;
      try {
        if (await RNFS.exists(uri)) {
          await RNFS.unlink(uri);
        }
      } catch (_) {
        // Picker provider files may already have expired; database cleanup continues.
      }
    }
  }
}

async function removeEssayPdfCache(ids: string[]) {
  const prefixes = ids.map(
    id => `essay-correction-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-`,
  );
  try {
    for (const file of await RNFS.readDir(RNFS.CachesDirectoryPath)) {
      if (
        file.isFile() &&
        prefixes.some(prefix => file.name.startsWith(prefix))
      ) {
        await RNFS.unlink(file.path);
      }
    }
  } catch (_) {
    // An absent cache directory or an OS-evicted cache is harmless.
  }
}

export async function deleteEssay(essayId: string) {
  const database = await db();
  const [images] = await database.executeSql(
    'SELECT image_uri, image_uris FROM essays WHERE id = ?',
    [essayId],
  );
  await removeEssayImages(images);
  await database.executeSql('DELETE FROM score_attempts WHERE essay_id = ?', [
    essayId,
  ]);
  await database.executeSql('DELETE FROM pipeline_steps WHERE essay_id = ?', [
    essayId,
  ]);
  await database.executeSql('DELETE FROM app_logs WHERE essay_id = ?', [
    essayId,
  ]);
  await database.executeSql('DELETE FROM essays WHERE id = ?', [essayId]);
  await removeEssayPdfCache([essayId]);
}

export async function clearEssaysBefore(
  before: Date,
  writingType?: WritingType,
) {
  const database = await db();
  const cutoff = before.toISOString();
  const typeClause = writingType ? ' AND writing_type = ?' : '';
  const typeParams = writingType ? [normalizeWritingType(writingType)] : [];
  const [images] = await database.executeSql(
    `SELECT id, image_uri, image_uris FROM essays WHERE created_at < ?${typeClause}`,
    [cutoff, ...typeParams],
  );
  await removeEssayImages(images);
  await database.executeSql(
    `DELETE FROM score_attempts WHERE essay_id IN (SELECT id FROM essays WHERE created_at < ?${typeClause})`,
    [cutoff, ...typeParams],
  );
  await database.executeSql(
    `DELETE FROM pipeline_steps WHERE essay_id IN (SELECT id FROM essays WHERE created_at < ?${typeClause})`,
    [cutoff, ...typeParams],
  );
  await database.executeSql(
    `DELETE FROM app_logs WHERE essay_id IN (SELECT id FROM essays WHERE created_at < ?${typeClause})`,
    [cutoff, ...typeParams],
  );
  await database.executeSql(
    `DELETE FROM essays WHERE created_at < ?${typeClause}`,
    [cutoff, ...typeParams],
  );
  const ids: string[] = [];
  for (let i = 0; i < images.rows.length; i += 1) {
    ids.push(images.rows.item(i).id);
  }
  await removeEssayPdfCache(ids);
}

/** Remove application logs and temporary cache files. Essay records and images
 * are managed from the separate essay-management screen. */
export async function clearLogsAndCache() {
  const database = await db();
  await database.executeSql('DELETE FROM app_logs');
  // Remove files created by the app in the cache directory while leaving the
  // directory itself available to native modules.
  for (const directory of [
    RNFS.CachesDirectoryPath,
    RNFS.TemporaryDirectoryPath,
  ]) {
    if (!directory) {
      continue;
    }
    try {
      const children = await RNFS.readDir(directory);
      for (const child of children) {
        if (child.isFile()) {
          await RNFS.unlink(child.path).catch(() => undefined);
        }
      }
    } catch (_) {
      // Cache cleanup is best effort and must not prevent database cleanup.
    }
  }
}

export async function getSettings(): Promise<AppSettings> {
  const database = await db();
  const [result] = await database.executeSql('SELECT key, value FROM settings');
  const values: Record<string, string> = {};
  for (let i = 0; i < result.rows.length; i += 1) {
    values[result.rows.item(i).key] = result.rows.item(i).value;
  }
  return {
    modelName: values.modelName || DEFAULT_SETTINGS.modelName,
    reasoningEffort: normalizeReasoningEffort(values.reasoningEffort),
    contextWindow:
      Number(values.contextWindow) || DEFAULT_SETTINGS.contextWindow,
    compactionThreshold:
      Number(values.compactionThreshold) ||
      DEFAULT_SETTINGS.compactionThreshold,
    maxOutputTokens:
      Number(values.maxOutputTokens) || DEFAULT_SETTINGS.maxOutputTokens,
    retryCount: Number.isFinite(Number(values.retryCount))
      ? Math.max(0, Number(values.retryCount))
      : DEFAULT_SETTINGS.retryCount,
    roundtableSize:
      ROUNDTABLE_OPTIONS.find(size => size === Number(values.roundtableSize)) ??
      0,
    apiBaseUrl: values.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
    apiKey: values.apiKey || '',
  };
}

export async function saveSettings(settings: AppSettings) {
  const validated = validateSettings(settings);
  const database = await db();
  for (const [key, value] of Object.entries(validated)) {
    await database.executeSql(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [
        key,
        String(
          key === 'reasoningEffort' ? normalizeReasoningEffort(value) : value,
        ),
      ],
    );
  }
}

export async function initDatabase() {
  await db();
}

export async function saveModelCall(
  essayId: string,
  runId: string,
  stage: StepId,
  call: ModelCall,
) {
  await storeModelCall(await db(), essayId, runId, stage, call);
}

export async function getEssayUsage(essayId: string) {
  return readEssayUsage(await db(), essayId);
}

export async function getScoreReport(
  range: ReportRange,
  writingType?: WritingType,
) {
  return readScoreReport(await db(), range, writingType);
}

export async function saveEssayScore(
  essayId: string,
  runId: string,
  score: ScoreResult,
  settings: AppSettings,
  writingType: WritingType = 'chinese',
) {
  await storeScore(
    await db(),
    essayId,
    runId,
    score,
    settings,
    `${getWritingProfile(writingType).rules.id}:${
      getWritingProfile(writingType).rules.version
    }`,
    normalizeWritingType(writingType),
  );
}

export async function getScoreAttempts(
  essayId: string,
): Promise<ScoreAttempt[]> {
  const database = await db();
  const [result] = await database.executeSql(
    'SELECT * FROM score_attempts WHERE essay_id = ? ORDER BY id',
    [essayId],
  );
  const attempts: ScoreAttempt[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const item = result.rows.item(i);
    attempts.push({
      id: item.id,
      essayId,
      sourceText: item.source_text,
      output: item.output,
      feedback: item.feedback,
      createdAt: item.created_at,
    });
  }
  return attempts;
}

export async function saveScoreAttempt(
  essayId: string,
  sourceText: string,
  output: string,
  feedback: string,
) {
  const database = await db();
  await database.executeSql(
    'INSERT INTO score_attempts (essay_id, source_text, output, feedback, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM essays WHERE id = ?)',
    [essayId, sourceText, output, feedback, new Date().toISOString(), essayId],
  );
}
