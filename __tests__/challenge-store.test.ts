import {spawnSync} from 'child_process';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {Buffer as mockBuffer} from 'buffer';
import type {ModelCall} from '../src/types';
import {CHALLENGE_POLICY_VERSION} from '../src/challenge/rules';
import type {
  ChallengePaper,
  ChallengeSource,
  ChallengePdfProgress,
  ExamAnalysis,
} from '../src/challenge/types';
import {candidateCheckpoint} from '../src/challenge/checkpoints';
import {
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  getChallengeReviewRoles,
} from '../src/challenge/review';

let mockDatabaseFile = '';
let mockFiles = new Map<string, mockBuffer>();
let mockDirectories = new Set<string>();
const mockPath = (uri: string) => uri.replace(/^file:\/\//, '');
const mockExecute = jest.fn(async (sql: string, params: unknown[] = []) => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
q=json.load(sys.stdin)
try:
 cursor=c.execute(q['sql'],q['params'])
 rows=[dict(r) for r in cursor.fetchall()]
 c.commit();print(json.dumps(rows))
finally:
 c.close()
`,
      mockDatabaseFile,
    ],
    {input: JSON.stringify({sql, params}), encoding: 'utf8'},
  );
  if (result.status) {
    throw new Error(result.stderr);
  }
  const values = JSON.parse(result.stdout);
  return [
    {
      rows: {length: values.length, item: (index: number) => values[index]},
      rowsAffected: 1,
    },
  ];
});

jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(async () => ({executeSql: mockExecute})),
}));
jest.mock('@react-native-community/image-editor', () => ({
  cropImage: jest.fn(),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn(async (path: string) => {
    mockDirectories.add(mockPath(path));
  }),
  exists: jest.fn(
    async (path: string) =>
      mockFiles.has(mockPath(path)) || mockDirectories.has(mockPath(path)),
  ),
  stat: jest.fn(async (path: string) => {
    const value = mockFiles.get(mockPath(path));
    if (!value) {
      throw new Error('ENOENT');
    }
    return {size: value.length, isFile: () => true, isDirectory: () => false};
  }),
  copyFile: jest.fn(async (source: string, target: string) => {
    const value = mockFiles.get(mockPath(source));
    if (!value) {
      throw new Error(`ENOENT: ${source}`);
    }
    mockFiles.set(mockPath(target), mockBuffer.from(value));
  }),
  copyAssetsFileIOS: jest.fn(async (source: string, target: string) => {
    const value = mockFiles.get(mockPath(source));
    if (!value) {
      throw new Error(`ENOENT: ${source}`);
    }
    mockFiles.set(mockPath(target), mockBuffer.from(value));
    return target;
  }),
  writeFile: jest.fn(async (path: string, value: string, encoding = 'utf8') => {
    mockFiles.set(
      mockPath(path),
      mockBuffer.from(value, encoding === 'base64' ? 'base64' : 'utf8'),
    );
  }),
  readFile: jest.fn(async (path: string, encoding = 'utf8') => {
    const value = mockFiles.get(mockPath(path));
    if (!value) {
      throw new Error(`ENOENT: ${path}`);
    }
    return value.toString(encoding === 'base64' ? 'base64' : 'utf8');
  }),
  moveFile: jest.fn(async (source: string, target: string) => {
    const value = mockFiles.get(mockPath(source));
    if (!value) {
      throw new Error(`ENOENT: ${source}`);
    }
    mockFiles.set(mockPath(target), value);
    mockFiles.delete(mockPath(source));
  }),
  unlink: jest.fn(async (path: string) => {
    const target = mockPath(path);
    for (const key of [...mockFiles.keys()]) {
      if (key === target || key.startsWith(`${target}/`)) {
        mockFiles.delete(key);
      }
    }
    for (const key of [...mockDirectories]) {
      if (key === target || key.startsWith(`${target}/`)) {
        mockDirectories.delete(key);
      }
    }
  }),
}));

let directory: string;
let store: typeof import('../src/challenge/store');
let fs: typeof import('react-native-fs');
const source: ChallengeSource = {
  kind: 'image',
  name: '原试卷.png',
  uri: 'file:///camera/paper.png',
  pageUris: ['file:///camera/paper.png'],
};
const pdfs = {
  paperBase64: mockBuffer.from('%PDF-1.4\nquestion').toString('base64'),
  answersBase64: mockBuffer.from('%PDF-1.4\nanswers').toString('base64'),
};
const call = (
  id: string,
  status: ModelCall['status'] = 'completed',
): ModelCall => ({
  id,
  operation: 'response',
  model: 'test-model',
  status,
  startedAt: '2026-11-10T00:00:00.000Z',
  finishedAt: status === 'running' ? null : '2026-11-10T00:00:01.000Z',
  durationMs: status === 'running' ? null : 1000,
  responseId: null,
  httpStatus: 200,
  measuredInputTokens: null,
  rawUsageJson: null,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheMissTokens: null,
  reasoningTokens: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}
async function readyRecord() {
  const value = await store.createChallenge([source]);
  const candidate: ChallengePaper = {
    title: '挑战卷',
    subject: 'math',
    level: 1,
    sections: [{id: 's1', title: '计算', instructions: '写出过程'}],
    materials: [],
    figures: [],
    questions: [
      {
        id: 'q1',
        number: '1',
        sectionId: 's1',
        type: '计算题',
        stem: '计算2+3+4。',
        options: [],
        materialIds: [],
        figureIds: [],
        knowledgePoints: ['加法'],
        score: 5,
        isListening: false,
        answerLines: 3,
        upgrade: {
          level: 1,
          metrics: {
            changedConditions: 1,
            pitfallDistinctions: 1,
            reasoningStepsAdded: 1,
            representationChanges: 1,
          },
          changes: ['调整数值关系'],
          pitfalls: ['避免遗漏加数'],
          scopeExplanation: '只使用加法',
        },
      },
    ],
    answers: [
      {
        questionId: 'q1',
        status: 'verified',
        answer: '9',
        explanation: '2+3+4=9',
        scoringPoints: ['计算过程', '结果'],
      },
    ],
    totalScore: 5,
    timeLimitMinutes: 5,
  };
  const staged = await store.updateChallenge(value.id, {
    runId: 'run_current',
    policyVersion: CHALLENGE_POLICY_VERSION,
    status: 'exporting',
    candidate,
  });
  return store.updateChallenge(value.id, {
    reviewRounds: [
      {
        round: 1,
        candidateRevision: staged.candidateRevision!,
        reviews: [
          {
            role: 'answers',
            verdict: 'approve',
            checkedQuestionIds: ['q1'],
            summary: '题型、知识范围、难度、答案和呈现综合校核通过',
            issues: [],
          },
        ],
      },
    ],
  });
}

async function configuredRecord(size: 0 | 3 | 5) {
  const value = await readyRecord();
  return store.updateChallenge(value.id, {
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    reviewRoundtableSize: size,
    reviewRounds: [
      {
        round: 1,
        roundtableSize: size,
        candidateRevision: value.candidateRevision!,
        reviews: getChallengeReviewRoles(size).map(role => ({
          role,
          verdict: 'approve',
          checkedQuestionIds: ['q1'],
          summary: `${role}已依据本科规则独立核对全部题目`,
          issues: [],
        })),
      },
    ],
  });
}

async function stagedRecord() {
  let value = await configuredRecord(0);
  const candidate = value.candidate!;
  const analysis: ExamAnalysis = {
    isExam: true,
    title: '数学原卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    knowledgePoints: ['加法'],
    difficultySummary: '原卷难度',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    sections: candidate.sections,
    materials: [],
    figures: [],
    questions: candidate.questions.map(question => ({
      ...question,
      sourceRefs: [{pageIndex: 0, quote: '原条件'}],
      difficulty: {rating: 1, reasoningSteps: 1, explanation: '直接计算'},
    })),
    totalScore: 5,
    timeLimitMinutes: 5,
    warnings: [],
    unresolvedIssues: [],
  };
  const identity: ChallengePdfProgress = {
    ...candidateCheckpoint(
      analysis,
      candidate,
      value.pageUris,
      value.candidateRevision!,
      0,
    ),
    version: 'pdf-documents-v1',
    round: 1,
  };
  value = await store.updateChallenge(value.id, {
    analysis,
    pdfProgress: identity,
  });
  return {value, identity};
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'challenge-store-'));
  mockDatabaseFile = join(directory, 'challenge.db');
  mockFiles = new Map([
    ['/camera/paper.png', mockBuffer.from('original image')],
  ]);
  mockDirectories = new Set(['/documents', '/cache', '/camera']);
  fs = require('react-native-fs');
  store = require('../src/challenge/store');
});
afterEach(() => rmSync(directory, {recursive: true, force: true}));

test('每份PDF独立持久化为私有断点，重载可续做且公开下载须等待双文件发布', async () => {
  const {value, identity} = await stagedRecord();
  const saved = await store.saveChallengePdfDocument(
    value.id,
    'run_current',
    'paper',
    pdfs.paperBase64,
    identity,
  );
  expect(saved.paperPdfUri).toBeUndefined();
  expect(saved.answersPdfUri).toBeUndefined();
  expect(saved.pdfProgress?.paperUri).toContain('staged-paper-run_current.pdf');
  const restored = (await store.getChallenge(value.id))!;
  expect(await store.loadChallengePdfDocuments(restored, identity)).toEqual({
    paperBase64: pdfs.paperBase64,
  });
  await store.saveChallengePdfDocument(
    value.id,
    'run_current',
    'answers',
    pdfs.answersBase64,
    identity,
  );
  const completed = await store.publishChallengePdfs(
    value.id,
    'run_current',
    pdfs,
  );
  expect(completed.status).toBe('completed');
  expect(completed.pdfProgress).toBeUndefined();
  expect(mockFiles.has(mockPath(saved.pdfProgress!.paperUri!))).toBe(false);
  expect(mockFiles.has(mockPath(completed.paperPdfUri!))).toBe(true);
});

test('PDF断点来源或候选修订改变时不可复用；文件缺失或损坏时只重建缺失文档', async () => {
  const {value, identity} = await stagedRecord();
  await store.saveChallengePdfDocument(
    value.id,
    'run_current',
    'paper',
    pdfs.paperBase64,
    identity,
  );
  const both = await store.saveChallengePdfDocument(
    value.id,
    'run_current',
    'answers',
    pdfs.answersBase64,
    identity,
  );
  expect(
    await store.loadChallengePdfDocuments(both, {
      ...identity,
      candidateRevision: identity.candidateRevision + 1,
    }),
  ).toEqual({});
  expect(
    await store.loadChallengePdfDocuments(both, {
      ...identity,
      sourceSignature: 'different-source',
    }),
  ).toEqual({});
  expect(
    await store.loadChallengePdfDocuments(
      {...both, pdfProgress: {...identity, version: 'old' as any}},
      identity,
    ),
  ).toEqual({});
  await store.updateChallenge(value.id, {
    pdfProgress: {...both.pdfProgress!, version: 'old' as any},
  });
  await expect(
    store.saveChallengePdfDocument(
      value.id,
      'run_current',
      'answers',
      pdfs.answersBase64,
      identity,
    ),
  ).rejects.toThrow('已改变');
  await store.updateChallenge(value.id, {pdfProgress: both.pdfProgress});
  mockFiles.delete(mockPath(both.pdfProgress!.answersUri!));
  expect(await store.loadChallengePdfDocuments(both, identity)).toEqual({
    paperBase64: pdfs.paperBase64,
  });
  mockFiles.set(
    mockPath(both.pdfProgress!.answersUri!),
    mockBuffer.from('broken-pdf'),
  );
  expect(await store.loadChallengePdfDocuments(both, identity)).toEqual({
    paperBase64: pdfs.paperBase64,
  });
  await store.updateChallenge(value.id, {
    candidate: {...value.candidate!, title: '新修订试卷'},
  });
  await expect(
    store.saveChallengePdfDocument(
      value.id,
      'run_current',
      'answers',
      pdfs.answersBase64,
      identity,
    ),
  ).rejects.toThrow('已改变');
});

test('中止或写盘失败不会保存虚假PDF完成断点', async () => {
  const {value, identity} = await stagedRecord();
  const controller = new AbortController();
  controller.abort();
  await expect(
    store.saveChallengePdfDocument(
      value.id,
      'run_current',
      'paper',
      pdfs.paperBase64,
      identity,
      controller.signal,
    ),
  ).rejects.toThrow('停止');
  (fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
  await expect(
    store.saveChallengePdfDocument(
      value.id,
      'run_current',
      'paper',
      pdfs.paperBase64,
      identity,
    ),
  ).rejects.toThrow('disk full');
  const restored = (await store.getChallenge(value.id))!;
  expect(restored.pdfProgress?.paperUri).toBeUndefined();
  expect(await store.loadChallengePdfDocuments(restored, identity)).toEqual({});
});

test('PDF断点只读取本记录规范私有文件路径，不读取原图或目录外文件', async () => {
  const {value, identity} = await stagedRecord();
  const readFile = fs.readFile as jest.Mock;
  readFile.mockClear();
  for (const uri of [
    value.pageUris[0],
    'file:///other.pdf',
    `file:///documents/challenges/${value.id}/../staged-paper-run_current.pdf`,
  ]) {
    expect(
      await store.loadChallengePdfDocuments(
        {...value, pdfProgress: {...identity, paperUri: uri}},
        identity,
      ),
    ).toEqual({});
  }
  expect(readFile).not.toHaveBeenCalled();
});

test('导入复制到持久目录，记录与重载独立于原相机临时文件', async () => {
  const created = await store.createChallenge([source]);
  expect(created.pageUris).toHaveLength(1);
  expect(created.pageUris[0]).not.toBe(source.uri);
  expect(created.pageUris[0]).toContain('/documents/');
  expect(created.sources[0].pageUris).toEqual(created.pageUris);
  mockFiles.delete('/camera/paper.png');
  expect(mockFiles.has(mockPath(created.pageUris[0]))).toBe(true);
  expect((await store.getChallenge(created.id))?.pageUris).toEqual(
    created.pageUris,
  );
  expect((await store.listChallenges()).map(record => record.id)).toContain(
    created.id,
  );
});

test('复制中途失败时不发布半份试卷，也不留下新持久副本', async () => {
  const before = new Set(mockFiles.keys());
  (fs.copyFile as jest.Mock).mockRejectedValueOnce(new Error('磁盘写入失败'));
  await expect(store.createChallenge([source])).rejects.toThrow('磁盘写入失败');
  expect(await store.listChallenges()).toHaveLength(0);
  expect([...mockFiles.keys()].filter(path => !before.has(path))).toEqual([]);
});

test('多个并行进度的functional patch保留全部更新，不被迟到写入覆盖', async () => {
  const created = await store.createChallenge([source]);
  await Promise.all(
    [0, 1, 2, 3, 4].map(index =>
      store.updateChallenge(created.id, current => ({
        progress: `${current.progress}|role-${index}`,
      })),
    ),
  );
  const saved = await store.getChallenge(created.id);
  for (const index of [0, 1, 2, 3, 4]) {
    expect(
      saved?.progress.match(new RegExp(`role-${index}`, 'g')),
    ).toHaveLength(1);
  }
});

test('同一次模型调用running和completed按ID更新，并行不同调用全部保留', async () => {
  const created = await store.createChallenge([source]);
  await store.appendChallengeCall(
    created.id,
    'review',
    call('first', 'running'),
  );
  await Promise.all([
    store.appendChallengeCall(created.id, 'review', call('first')),
    ...['second', 'third', 'fourth', 'fifth'].map(id =>
      store.appendChallengeCall(created.id, 'review', call(id)),
    ),
  ]);
  const saved = await store.getChallenge(created.id);
  expect(saved?.calls).toHaveLength(5);
  expect(saved?.calls.find(item => item.call.id === 'first')?.call.status).toBe(
    'completed',
  );
});

test('两个PDF均写入成功后才发布完成状态，并且文件内容分开', async () => {
  const created = await readyRecord();
  const result = await store.publishChallengePdfs(
    created.id,
    'run_current',
    pdfs,
  );
  expect(result.status).toBe('completed');
  expect(result.paperPdfUri).toBeTruthy();
  expect(result.answersPdfUri).toBeTruthy();
  expect(result.paperPdfUri).not.toBe(result.answersPdfUri);
  expect(mockFiles.get(mockPath(result.paperPdfUri!))?.toString()).toContain(
    'question',
  );
  expect(mockFiles.get(mockPath(result.answersPdfUri!))?.toString()).toContain(
    'answers',
  );
  expect((await store.getChallenge(created.id))?.paperPdfUri).toBe(
    result.paperPdfUri,
  );
});

test.each([0, 3, 5] as const)(
  '配置%s个圆桌角色时必须按保存人数完成整轮才发布PDF',
  async size => {
    const value = await configuredRecord(size);
    const completed = await store.publishChallengePdfs(
      value.id,
      'run_current',
      pdfs,
    );
    expect(completed.status).toBe('completed');
    expect(completed.reviewRoundtableSize).toBe(size);
    expect(
      completed.reviewRounds[0].reviews.map(report => report.role),
    ).toEqual(getChallengeReviewRoles(size));
  },
);

test('多人圆桌缺席、重复席位、反对或漏题时不得发布两份PDF', async () => {
  const value = await configuredRecord(3);
  const original = value.reviewRounds[0];
  const variants = [
    original.reviews.slice(0, 2),
    [original.reviews[0], original.reviews[0], original.reviews[2]],
    original.reviews.map((report, index) =>
      index === 1
        ? {
            ...report,
            verdict: 'revise' as const,
            issues: [
              {
                questionId: 'q1',
                code: 'answer',
                comment: '答案不成立',
                fix: '重新独立求解',
              },
            ],
          }
        : report,
    ),
    original.reviews.map((report, index) =>
      index === 1 ? {...report, checkedQuestionIds: []} : report,
    ),
  ];
  for (const reviews of variants) {
    await store.updateChallenge(value.id, {
      reviewRounds: [{...original, reviews}],
    });
    await expect(
      store.publishChallengePdfs(value.id, 'run_current', pdfs),
    ).rejects.toThrow('校核');
    expect((await store.getChallenge(value.id))?.paperPdfUri).toBeFalsy();
  }
});

test('圆桌人数、协议或轮次快照不一致不能用旧票发布', async () => {
  const value = await configuredRecord(5);
  const original = value.reviewRounds[0];
  await store.updateChallenge(value.id, {
    reviewRounds: [{...original, roundtableSize: 3}],
  });
  await expect(
    store.publishChallengePdfs(value.id, 'run_current', pdfs),
  ).rejects.toThrow('校核');
  await store.updateChallenge(value.id, {
    reviewRounds: [{...original, roundtableSize: undefined}],
  });
  await expect(
    store.publishChallengePdfs(value.id, 'run_current', pdfs),
  ).rejects.toThrow('校核');
  await store.updateChallenge(value.id, {
    reviewRounds: [original],
    reviewProtocolVersion: 'unknown-protocol',
  });
  await expect(
    store.publishChallengePdfs(value.id, 'run_current', pdfs),
  ).rejects.toThrow('校核');
  await store.updateChallenge(value.id, {
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    reviewRoundtableSize: 3,
  });
  await expect(
    store.publishChallengePdfs(value.id, 'run_current', pdfs),
  ).rejects.toThrow('校核');
});

test('第二份PDF写入失败时不得发布成功，也不保留本次半成品PDF', async () => {
  const created = await readyRecord();
  const before = new Set(mockFiles.keys());
  const write = fs.writeFile as jest.Mock;
  const originalWrite = write.getMockImplementation()!;
  let writes = 0;
  write.mockImplementation(async (...args: unknown[]) => {
    writes += 1;
    if (writes === 2) {
      throw new Error('答案写入失败');
    }
    return originalWrite(...args);
  });
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow('答案写入失败');
  const saved = await store.getChallenge(created.id);
  expect(saved?.status).not.toBe('completed');
  expect(saved?.paperPdfUri).toBeFalsy();
  expect(saved?.answersPdfUri).toBeFalsy();
  expect([...mockFiles.keys()].filter(path => !before.has(path))).toEqual([]);
});

test('文件写完但数据库发布失败时，两份PDF一起清理且保留未完成状态', async () => {
  const created = await readyRecord();
  const before = new Set(mockFiles.keys());
  await mockExecute(`CREATE TRIGGER fail_challenge_publication BEFORE UPDATE ON challenges
    WHEN NEW.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'publication failed'); END`);
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow('publication failed');
  expect((await store.getChallenge(created.id))?.status).not.toBe('completed');
  expect((await store.getChallenge(created.id))?.paperPdfUri).toBeFalsy();
  expect([...mockFiles.keys()].filter(path => !before.has(path))).toEqual([]);
});

test('重启恢复处理中记录为可重试失败，并保留原试卷及已完成调用', async () => {
  const created = await store.createChallenge([source]);
  await store.updateChallenge(created.id, {status: 'reviewing'});
  await store.appendChallengeCall(
    created.id,
    'review',
    call('interrupted', 'running'),
  );
  await store.appendChallengeCall(created.id, 'analysis', call('finished'));
  jest.resetModules();
  store = require('../src/challenge/store');
  const recovered = await store.getChallenge(created.id);
  expect(recovered?.status).toBe('failed');
  expect(recovered?.error).toContain('中断');
  expect(recovered?.pageUris).toEqual(created.pageUris);
  expect(
    recovered?.calls.find(item => item.call.id === 'interrupted')?.call.status,
  ).toBe('interrupted');
  expect(
    recovered?.calls.find(item => item.call.id === 'finished')?.call.status,
  ).toBe('completed');
});

test('旧runId迟到导出不能覆盖新一次升档', async () => {
  const created = await readyRecord();
  await store.updateChallenge(created.id, {runId: 'run_next'});
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
  expect((await store.getChallenge(created.id))?.runId).toBe('run_next');
  expect((await store.getChallenge(created.id))?.paperPdfUri).toBeFalsy();
});

test('候选卷修改后旧一轮综合校核失效，必须对新revision重新评审', async () => {
  const created = await readyRecord();
  const modified = await store.updateChallenge(created.id, {
    candidate: {...created.candidate!, title: '已经修改的挑战卷'},
  });
  expect(modified.candidateRevision).toBe(created.candidateRevision! + 1);
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
  expect((await store.getChallenge(created.id))?.paperPdfUri).toBeFalsy();
});

test('functional patch原地改题也必须作废旧校核，不能绕过candidate revision', async () => {
  const created = await readyRecord();
  const modified = await store.updateChallenge(created.id, current => {
    current.candidate!.questions[0].stem = '计算2+3+5。';
    return {progress: '题干刚被修改'};
  });
  expect(modified.candidateRevision).toBe(created.candidateRevision! + 1);
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
});

test('综合质量校核缺失、未通过或重复记录时都不能发布PDF', async () => {
  const created = await readyRecord();
  const lastRound = created.reviewRounds[0];
  await store.updateChallenge(created.id, {
    reviewRounds: [{...lastRound, reviews: []}],
  });
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
  await store.updateChallenge(created.id, {
    reviewRounds: [
      {
        ...lastRound,
        reviews: [
          {
            ...lastRound.reviews[0],
            verdict: 'revise',
            issues: [
              {
                questionId: 'q1',
                code: 'answer',
                comment: '计算有误',
                fix: '重新核算',
              },
            ],
          },
        ],
      },
    ],
  });
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
  await store.updateChallenge(created.id, {
    reviewRounds: [
      {...lastRound, reviews: [lastRound.reviews[0], lastRound.reviews[0]]},
    ],
  });
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
});

test('规则版本已变化时旧一次综合校核不得作为当前规则的发布依据', async () => {
  const created = await readyRecord();
  await store.updateChallenge(created.id, {
    policyVersion: 'challenge-rules:older',
  });
  await expect(
    store.publishChallengePdfs(created.id, 'run_current', pdfs),
  ).rejects.toThrow();
  expect((await store.getChallenge(created.id))?.paperPdfUri).toBeFalsy();
});

test('第二份PDF写完时取消，两个新文件都清理且不发布完成', async () => {
  const created = await readyRecord();
  const before = new Set(mockFiles.keys());
  const controller = new AbortController();
  const write = fs.writeFile as jest.Mock;
  const originalWrite = write.getMockImplementation()!;
  let writes = 0;
  write.mockImplementation(async (...args: unknown[]) => {
    await originalWrite(...args);
    writes += 1;
    if (writes === 2) {
      controller.abort();
    }
  });
  await expect(
    store.publishChallengePdfs(
      created.id,
      'run_current',
      pdfs,
      controller.signal,
    ),
  ).rejects.toThrow('停止');
  expect((await store.getChallenge(created.id))?.status).not.toBe('completed');
  expect([...mockFiles.keys()].filter(path => !before.has(path))).toEqual([]);
});

test('删除仅清理挑战自己的副本，原相册文件保留且迟到更新不能复活', async () => {
  const created = await store.createChallenge([source]);
  await store.deleteChallenge(created.id);
  expect(await store.getChallenge(created.id)).toBeUndefined();
  expect(mockFiles.has('/camera/paper.png')).toBe(true);
  expect(mockFiles.has(mockPath(created.pageUris[0]))).toBe(false);
  await expect(
    store.updateChallenge(created.id, {status: 'completed'}),
  ).rejects.toThrow();
  await expect(
    store.appendChallengeCall(created.id, 'review', call('late')),
  ).rejects.toThrow();
  expect(await store.getChallenge(created.id)).toBeUndefined();
});

test('导出写文件时删除记录，迟到导出不能留下孤儿PDF或恢复记录', async () => {
  const created = await readyRecord();
  const entered = deferred<void>();
  const release = deferred<void>();
  const write = fs.writeFile as jest.Mock;
  const originalWrite = write.getMockImplementation()!;
  let first = true;
  write.mockImplementation(async (...args: unknown[]) => {
    if (first) {
      first = false;
      entered.resolve();
      await release.promise;
    }
    return originalWrite(...args);
  });
  const publishing = store.publishChallengePdfs(
    created.id,
    'run_current',
    pdfs,
  );
  await entered.promise;
  const deleting = store.deleteChallenge(created.id);
  release.resolve();
  await Promise.allSettled([publishing, deleting]);
  expect(await store.getChallenge(created.id)).toBeUndefined();
  expect(
    [...mockFiles.keys()].filter(path => path.startsWith('/documents/')),
  ).toEqual([]);
  expect(mockFiles.has('/camera/paper.png')).toBe(true);
});

test('每份试卷最多一个PDF，重复PDF在复制文件或建记录前拒绝', async () => {
  const pdf = {...source, kind: 'pdf' as const, name: '原卷.pdf'};
  const directoriesBefore = new Set(mockDirectories);
  await expect(
    store.createChallenge([pdf, {...pdf, name: '第二份.pdf'}]),
  ).rejects.toThrow('只允许上传一个');
  expect(mockDirectories).toEqual(directoriesBefore);
  expect(mockExecute).not.toHaveBeenCalled();
});
