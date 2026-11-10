import SQLite, {SQLiteDatabase} from 'react-native-sqlite-storage';
import RNFS from 'react-native-fs';
import {Image, Platform} from 'react-native';
import ImageEditor from '@react-native-community/image-editor';
import {ModelCall} from '../types';
import {newRecordId} from '../services/usage';
import {ChallengeRecord, ChallengeSource, ChallengeStage} from './types';
import {CHALLENGE_POLICY_VERSION, challengeStandardApproved} from './rules';
import {hasPassedChallengeReview} from './review';

let databasePromise: Promise<SQLiteDatabase> | undefined;
const operations = new Map<string, Promise<unknown>>();
const deleted = new Set<string>();
const root = () => `${RNFS.DocumentDirectoryPath}/challenges`;
const processing = new Set([
  'analyzing',
  'generating',
  'reviewing',
  'repairing',
  'exporting',
]);

export class ChallengeDeletedError extends Error {
  constructor() {
    super('挑战记录已删除，不再保存迟到的结果');
  }
}
function path(uri: string) {
  if (!uri || /^(?:https?:|data:|javascript:)/i.test(uri)) {
    throw new Error('只能导入本机试卷文件');
  }
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}
function folder(id: string) {
  if (!/^challenge_[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('挑战记录编号无效');
  }
  return `${root()}/${id}`;
}
function parseRecord(value: unknown): ChallengeRecord {
  const record = JSON.parse(String(value)) as ChallengeRecord;
  if (
    !record ||
    typeof record.id !== 'string' ||
    !Array.isArray(record.sources) ||
    !Array.isArray(record.pageUris) ||
    !Array.isArray(record.calls) ||
    !Array.isArray(record.reviewRounds)
  ) {
    throw new Error('挑战记录损坏，无法读取');
  }
  folder(record.id);
  return record;
}
async function db() {
  if (!databasePromise) {
    databasePromise = (async () => {
      SQLite.enablePromise(true);
      const database = await SQLite.openDatabase({
        name: 'essay_challenges.db',
        location: 'default',
      });
      await database.executeSql(`CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`);
      const [rows] = await database.executeSql(
        'SELECT record_json FROM challenges',
      );
      for (let index = 0; index < rows.rows.length; index += 1) {
        const record = parseRecord(rows.rows.item(index).record_json);
        if (processing.has(record.status)) {
          record.status = 'failed';
          record.error = '上次处理已中断，可从已保存的解析结果重试';
          record.progress = record.error;
          record.updatedAt = new Date().toISOString();
          record.calls = record.calls.map(item =>
            item.call.status === 'running'
              ? {
                  ...item,
                  call: {
                    ...item.call,
                    status: 'interrupted',
                    finishedAt: null,
                    durationMs: null,
                  },
                }
              : item,
          );
          await write(database, record);
        }
      }
      return database;
    })().catch(error => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}
async function write(database: SQLiteDatabase, record: ChallengeRecord) {
  if (deleted.has(record.id)) {
    throw new ChallengeDeletedError();
  }
  await database.executeSql(
    'UPDATE challenges SET status = ?, record_json = ?, updated_at = ? WHERE id = ?',
    [record.status, JSON.stringify(record), record.updatedAt, record.id],
  );
}
function serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  operations.set(id, next);
  const settled = () => {
    if (operations.get(id) === next) {
      operations.delete(id);
    }
  };
  next.then(settled, settled);
  return next;
}
async function read(database: SQLiteDatabase, id: string) {
  if (deleted.has(id)) {
    return undefined;
  }
  const [rows] = await database.executeSql(
    'SELECT record_json FROM challenges WHERE id = ?',
    [id],
  );
  return rows.rows.length
    ? parseRecord(rows.rows.item(0).record_json)
    : undefined;
}
export async function getChallenge(
  id: string,
): Promise<ChallengeRecord | undefined> {
  folder(id);
  return read(await db(), id);
}
export async function listChallenges(): Promise<ChallengeRecord[]> {
  const [rows] = await (
    await db()
  ).executeSql(
    'SELECT record_json FROM challenges ORDER BY updated_at DESC, rowid DESC',
  );
  const records: ChallengeRecord[] = [];
  for (let index = 0; index < rows.rows.length; index += 1) {
    const record = parseRecord(rows.rows.item(index).record_json);
    if (!deleted.has(record.id)) {
      records.push(record);
    }
  }
  return records;
}
async function copyImage(uri: string, target: string) {
  const source = path(uri);
  if (Platform.OS === 'ios' && uri.startsWith('ph://')) {
    await RNFS.copyAssetsFileIOS(uri, target, 2400, 3200, 1, 1, 'contain');
    return;
  }
  if (/\.(?:heic|heif|tiff?)(?:\?|$)/i.test(uri)) {
    const size = await new Promise<{width: number; height: number}>(
      (resolve, reject) =>
        Image.getSize(uri, (width, height) => resolve({width, height}), reject),
    );
    const scale = Math.min(1, 3200 / Math.max(size.width, size.height));
    const cropped = await ImageEditor.cropImage(uri, {
      offset: {x: 0, y: 0},
      size,
      displaySize: {
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      },
      format: 'jpeg',
      quality: 1,
    });
    const converted = typeof cropped === 'string' ? cropped : cropped.uri;
    if (!converted) {
      throw new Error('图片转换没有返回文件');
    }
    try {
      await RNFS.copyFile(path(converted), target);
    } finally {
      await RNFS.unlink(path(converted)).catch(() => undefined);
    }
    return;
  }
  await RNFS.copyFile(source, target);
}
export async function createChallenge(
  sources: ChallengeSource[],
): Promise<ChallengeRecord> {
  if (!sources.length || sources.some(source => !source.pageUris.length)) {
    throw new Error('请先拍摄或上传完整试卷');
  }
  const pageCount = sources.reduce(
    (sum, source) => sum + source.pageUris.length,
    0,
  );
  if (pageCount > 50) {
    throw new Error('一份挑战最多导入50页，请按完整试卷分批导入');
  }
  const id = newRecordId('challenge');
  const directory = folder(id);
  await RNFS.mkdir(directory);
  try {
    const copied: ChallengeSource[] = [];
    const pageUris: string[] = [];
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      if (!['image', 'pdf'].includes(source.kind)) {
        throw new Error('仅支持试卷图片或PDF');
      }
      let uri = '';
      if (source.kind === 'pdf') {
        const file = `${directory}/source-${sourceIndex + 1}.pdf`;
        await RNFS.copyFile(path(source.uri), file);
        uri = `file://${file}`;
      }
      const pages: string[] = [];
      for (const page of source.pageUris) {
        const ext =
          /\.(png|webp)(?:\?|$)/i.exec(page)?.[1].toLowerCase() || 'jpg';
        const file = `${directory}/page-${pageUris.length + 1}.${ext}`;
        await copyImage(page, file);
        const saved = `file://${file}`;
        pages.push(saved);
        pageUris.push(saved);
      }
      copied.push({
        kind: source.kind,
        name: source.name,
        uri: uri || pages[0],
        pageUris: pages,
      });
    }
    const now = new Date().toISOString();
    const record: ChallengeRecord = {
      id,
      title: sources[0].name || '试卷挑战',
      status: 'imported',
      sources: copied,
      pageUris,
      level: 1,
      pages: [],
      reviewRounds: [],
      calls: [],
      progress: '试卷已导入，等待解析',
      error: '',
      createdAt: now,
      updatedAt: now,
    };
    await (
      await db()
    ).executeSql(
      'INSERT INTO challenges (id, status, record_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, record.status, JSON.stringify(record), now, now],
    );
    return record;
  } catch (error) {
    await RNFS.unlink(directory).catch(() => undefined);
    throw error;
  }
}
export function updateChallenge(
  id: string,
  patch:
    | Partial<ChallengeRecord>
    | ((record: ChallengeRecord) => Partial<ChallengeRecord>),
): Promise<ChallengeRecord> {
  folder(id);
  return serial(id, async () => {
    const database = await db();
    const current = await read(database, id);
    if (!current || deleted.has(id)) {
      throw new ChallengeDeletedError();
    }
    const previousCandidate = JSON.stringify(current.candidate);
    const previousRevision = current.candidateRevision;
    const originalSources = JSON.parse(
      JSON.stringify(current.sources),
    ) as ChallengeSource[];
    const originalPages = [...current.pageUris];
    const originalCreatedAt = current.createdAt;
    const changes = typeof patch === 'function' ? patch(current) : patch;
    const merged = {...current, ...changes};
    const revision =
      JSON.stringify(merged.candidate) !== previousCandidate
        ? (previousRevision || 0) + 1
        : previousRevision;
    const record = {
      ...merged,
      id,
      sources: originalSources,
      pageUris: originalPages,
      candidateRevision: revision,
      createdAt: originalCreatedAt,
      updatedAt: new Date().toISOString(),
    };
    await write(database, record);
    return record;
  });
}
export function appendChallengeCall(
  id: string,
  stage: ChallengeStage,
  call: ModelCall,
) {
  const snapshot = JSON.parse(JSON.stringify(call)) as ModelCall;
  return updateChallenge(id, current => ({
    calls: current.calls.some(item => item.call.id === snapshot.id)
      ? current.calls.map(item =>
          item.call.id === snapshot.id ? {stage, call: snapshot} : item,
        )
      : [...current.calls, {stage, call: snapshot}],
  }));
}
export async function publishChallengePdfs(
  id: string,
  runId: string,
  pdfs: {paperBase64: string; answersBase64: string},
  signal?: AbortSignal,
): Promise<ChallengeRecord> {
  folder(id);
  if (!/^run_[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error('本轮生成编号无效');
  }
  if (
    !pdfs.paperBase64.startsWith('JVBER') ||
    !pdfs.answersBase64.startsWith('JVBER')
  ) {
    throw new Error('试卷或答案PDF未正确生成');
  }
  return serial(id, async () => {
    const database = await db();
    const record = await read(database, id);
    if (!record || deleted.has(id)) {
      throw new ChallengeDeletedError();
    }
    const lastRound = record.reviewRounds[record.reviewRounds.length - 1];
    if (signal?.aborted) {
      throw new Error('已停止生成PDF');
    }
    if (
      record.runId !== runId ||
      record.status !== 'exporting' ||
      !record.candidate ||
      !challengeStandardApproved() ||
      record.policyVersion !== CHALLENGE_POLICY_VERSION ||
      !hasPassedChallengeReview(record, lastRound)
    ) {
      throw new Error('当前试卷尚未通过本轮标准一致性校核，不能发布PDF');
    }
    const paper = `${folder(id)}/paper-${runId}.pdf`;
    const answers = `${folder(id)}/answers-${runId}.pdf`;
    try {
      await RNFS.writeFile(paper, pdfs.paperBase64, 'base64');
      await RNFS.writeFile(answers, pdfs.answersBase64, 'base64');
      if (signal?.aborted) {
        throw new Error('已停止生成PDF');
      }
      if (deleted.has(id)) {
        throw new ChallengeDeletedError();
      }
      const completed: ChallengeRecord = {
        ...record,
        status: 'completed',
        paperPdfUri: `file://${paper}`,
        answersPdfUri: `file://${answers}`,
        progress: '按升档标准校核完成，试卷与答案PDF已生成',
        error: '',
        updatedAt: new Date().toISOString(),
      };
      await write(database, completed);
      return completed;
    } catch (error) {
      await Promise.allSettled([RNFS.unlink(paper), RNFS.unlink(answers)]);
      throw error;
    }
  });
}
export async function deleteChallenge(id: string): Promise<void> {
  folder(id);
  deleted.add(id);
  try {
    await serial(id, async () => {
      await (
        await db()
      ).executeSql('DELETE FROM challenges WHERE id = ?', [id]);
      await RNFS.unlink(folder(id)).catch(() => undefined);
    });
  } catch (error) {
    deleted.delete(id);
    throw error;
  }
}
