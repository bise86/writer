import {DEFAULT_SETTINGS} from '../src/settings';
import {analyzeChallenge, upgradeChallenge} from '../src/challenge/pipeline';
import {imageAsDataUri, runResponse} from '../src/services/openai';
import {buildChallengePdfs} from '../src/challenge/pdf';
import {publishChallengePdfs} from '../src/challenge/store';
import {applicableChallengeMetrics} from '../src/challenge/rules';
import {buildProgressiveSubjectVerification} from '../src/challenge/subjectSampling';
import {CHALLENGE_REVIEW_PROTOCOL_VERSION} from '../src/challenge/review';
import type {ModelInput} from '../src/services/context';
import type {
  ChallengeLevel,
  ChallengeLearningGuide,
  ChallengePage,
  ChallengePaper,
  ChallengeRecord,
  ChallengeReview,
  ChallengeReviewRole,
  ExamAnalysis,
  PaperQuestion,
  SubjectIdentification,
  SubjectVerification,
} from '../src/challenge/types';

const mockClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let mockRecord: ChallengeRecord | undefined;
let mockStandardApproved = true;

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  unlink: jest.fn(async () => undefined),
}));
jest.mock('../src/services/openai', () => ({
  imageAsDataUri: jest.fn(
    async (uri: string) => `data:image/png;base64,${uri}`,
  ),
  parseJson: (value: string) => JSON.parse(value),
  runResponse: jest.fn(),
}));
jest.mock('../src/challenge/pdf', () => ({buildChallengePdfs: jest.fn()}));
jest.mock('../src/challenge/subjectSampling', () => {
  const actual = jest.requireActual('../src/challenge/subjectSampling');
  return {
    ...actual,
    buildSubjectVerification: jest.fn(actual.buildSubjectVerification),
    buildProgressiveSubjectVerification: jest.fn(
      actual.buildProgressiveSubjectVerification,
    ),
  };
});
jest.mock('../src/challenge/rules', () => {
  const actual = jest.requireActual('../src/challenge/rules');
  return {...actual, challengeStandardApproved: () => mockStandardApproved};
});
jest.mock('../src/challenge/store', () => ({
  ChallengeDeletedError: class extends Error {
    constructor() {
      super('挑战记录已删除');
    }
  },
  getChallenge: jest.fn(async () =>
    mockRecord ? mockClone(mockRecord) : undefined,
  ),
  updateChallenge: jest.fn(
    async (
      _id: string,
      patch:
        | Partial<ChallengeRecord>
        | ((record: ChallengeRecord) => Partial<ChallengeRecord>),
    ) => {
      if (!mockRecord) {
        throw new Error('挑战记录已删除');
      }
      const current = mockClone(mockRecord);
      const before = JSON.stringify(current.candidate);
      const changes = typeof patch === 'function' ? patch(current) : patch;
      const next = {...current, ...changes};
      next.candidateRevision =
        JSON.stringify(next.candidate) === before
          ? current.candidateRevision
          : (current.candidateRevision || 0) + 1;
      mockRecord = mockClone(next);
      return mockClone(mockRecord);
    },
  ),
  appendChallengeCall: jest.fn(
    async (_id: string, stage: string, call: object) => {
      if (!mockRecord) {
        throw new Error('挑战记录已删除');
      }
      mockRecord.calls.push({stage, call} as any);
      return mockClone(mockRecord);
    },
  ),
  publishChallengePdfs: jest.fn(
    async (
      _id: string,
      runId: string,
      _pdfs: unknown,
      signal?: AbortSignal,
    ) => {
      if (!mockRecord || mockRecord.runId !== runId) {
        throw new Error('挑战记录已删除或过期');
      }
      if (signal?.aborted) {
        throw new Error('已停止');
      }
      mockRecord = {
        ...mockRecord,
        status: 'completed',
        paperPdfUri: 'file:///documents/paper.pdf',
        answersPdfUri: 'file:///documents/answers.pdf',
      };
      return mockClone(mockRecord);
    },
  ),
}));

const settings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'unit-test-key',
  roundtableSize: 0 as const,
};
const page: ChallengePage = {
  pageIndex: 0,
  documentType: 'exam',
  text: '数学试卷\n一、解答\n1. 将1、2、3、4分成两组，每组两个数且两组和相等，给出一种分法并说明理由。',
  hasStudentAnswers: true,
  unreadableParts: [],
  figures: [],
};
const identification: SubjectIdentification = {
  status: 'confirmed',
  subject: 'math',
  courseName: '数学',
  integrated: false,
  reason: '印刷标题为数学试卷，原题考查整数运算与等和分组。',
  evidence: [
    {pageIndex: 0, quote: '数学试卷'},
    {
      pageIndex: 0,
      quote:
        '1. 将1、2、3、4分成两组，每组两个数且两组和相等，给出一种分法并说明理由。',
    },
  ],
};
const analysis: ExamAnalysis = {
  isExam: true,
  title: '等和分组练习',
  subject: 'math',
  subjectLabel: '数学',
  educationLevel: 'middle',
  knowledgePoints: ['整数四则运算与等量关系'],
  difficultySummary: '原题只需构造一种等和分组并验证，难度为估计。',
  difficultyBasis: 'estimated',
  answerState: 'answered',
  sections: [{id: 's1', title: '一、解答', instructions: '写出过程'}],
  materials: [],
  figures: [],
  questions: [
    {
      id: 'q1',
      number: '1',
      sectionId: 's1',
      type: '解答题',
      majorQuestionId: 'major1',
      dependsOnQuestionIds: [],
      stem: '将1、2、3、4分成两组，每组两个数且两组和相等，给出一种分法并说明理由。',
      options: [],
      materialIds: [],
      figureIds: [],
      knowledgePoints: ['整数四则运算与等量关系'],
      score: 5,
      isListening: false,
      answerLines: 3,
      sourceRefs: [
        {
          pageIndex: 0,
          quote:
            '1. 将1、2、3、4分成两组，每组两个数且两组和相等，给出一种分法并说明理由。',
        },
      ],
      difficulty: {
        rating: 1,
        reasoningSteps: 1,
        explanation: '给出一组可行分组并以整数运算验证相等。',
      },
    },
  ],
  totalScore: 5,
  timeLimitMinutes: 5,
  warnings: [],
  unresolvedIssues: [],
  subjectIdentification: mockClone(identification),
  titleEvidence: [{pageIndex: 0, quote: '数学试卷'}],
  majorQuestions: [
    {
      id: 'major1',
      title: '一、解答',
      sourceRefs: [{pageIndex: 0, quote: '一、解答'}],
    },
  ],
};
const partitionSolution =
  '六数总和为21，故每组和必须为7。最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件；最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。交换组内次序或三组排列仍是同一分组，不能重复计数。仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次，因此等和本身不充分；本构造覆盖且不重用六数。';
const partitionDirections = [
  {
    directionId: 'math_reverse_goal',
    originalDemand: '原题给出一种分法并验证即可。',
    newDemand: '由三组等和的目标反推每组必须达到的共同和。',
    problemQuote: '每组和相等',
    solutionQuote: '六数总和为21，故每组和必须为7。',
    necessity:
      '本解法以共同和为7约束全部分组，为后续配对锁定目标，避免无组织试配。',
  },
  {
    directionId: 'math_symmetry_pairing',
    originalDemand: '原题不要求组织所有数的对应关系来排除遗漏。',
    newDemand: '利用和为7建立最小未用数与其唯一搭档的对应。',
    problemQuote: '每组两个数',
    solutionQuote: '最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。',
    necessity:
      '在目标和约束下逐次锁定唯一搭档，才能用结构化对应排除无效分支，而非把同一计算拆成多步。',
  },
  {
    directionId: 'math_construction',
    originalDemand: '原题只需给一个例子。',
    newDemand: '把被锁定的对应构造成实际可行分组并核查覆盖与无遗漏。',
    problemQuote: '每个数恰用一次',
    solutionQuote:
      '构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件；最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
    necessity:
      '单有目标和是必要条件还不能保证分法存在；构造及唯一搭档证明把前两方向转为完整答案。',
  },
];
function partitionDepth(level: ChallengeLevel) {
  const directionEvidence = mockClone(partitionDirections.slice(0, level));
  const directionConnections = [
    {
      from: 'math_reverse_goal',
      to: 'math_symmetry_pairing',
      solutionQuote: '故每组和必须为7。最小数1只能与6配成7',
      explanation: '共同和这一中间结论是锁定最小数搭档的直接输入。',
    },
    {
      from: 'math_symmetry_pairing',
      to: 'math_construction',
      solutionQuote: '剩下3与4配成7。构造得到{1,6}、{2,5}、{3,4}',
      explanation: '被锁定的数对成为可行构造和无遗漏核查的直接输入。',
    },
  ].slice(0, Math.max(0, level - 1));
  return {
    depthRoute: 'combined' as const,
    directionEvidence,
    directionConnections,
    depthChecks: [],
  };
}
function partitionGuide(level: ChallengeLevel): ChallengeLearningGuide[] {
  return [
    {
      knowledgePoint: analysis.questions[0].knowledgePoints[0],
      coreInsight: '整体总和与组数确定共同和，等量约束再锁定每个数的搭档。',
      conditionBoundary:
        '每组两个数、每数恰用一次与组和相等必须同时成立，排列不产生新分组。',
      reasoning:
        '先由总和反推7，再按最小未用数确定搭档，核查构造存在且没有遗漏。',
      problemQuote: '每组和相等',
      solutionQuote: '六数总和为21，故每组和必须为7。',
      misconceptions: [
        {
          challengeId: 'math_case_completeness',
          wrongApproach: '给出一个可行分组就声称已求得全部不同分法。',
          whyWrong: '存在一个例子不足以排除其它可能，缺少完整性依据。',
          correction: '逐次说明最小未用数的合法搭档唯一，排除其余候选。',
          solutionQuote:
            '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
        },
        {
          challengeId: 'math_case_deduplication',
          wrongApproach: '交换组内或三组的排列顺序后当成新的分组。',
          whyWrong: '原任务按成员划分识别分组，顺序不同不改变成员关系。',
          correction: '先统一分组表示，再按原题同一性口径去重。',
          solutionQuote: '交换组内次序或三组排列仍是同一分组，不能重复计数。',
        },
        {
          challengeId: 'math_object_constraints',
          wrongApproach: '重复使用{1,6}三次，只根据各组和为7就判为合法。',
          whyWrong: '1与6重复，2、3、4、5遗漏，只满足局部等和。',
          correction: '把每数恰用一次与等和要求联合检查，排除重复用数。',
          solutionQuote:
            '仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次，因此等和本身不充分；本构造覆盖且不重用六数。',
        },
      ].slice(0, level),
      transferLinks: [
        {
          kind: 'source_to_variant',
          originalCondition: '原题四数分两组，只需给出一种等和分法。',
          changedCondition: '新题六数分三组，要求找全且每个数恰好用一次。',
          invariant: '整数四则运算与等量关系仍是核心，不使用新的计数定理。',
          adaptation: '从验证一个构造改为共同和约束下的唯一搭档与完整性推理。',
          sourceQuote: analysis.questions[0].stem,
          problemQuote: '求全部不同分法并说明没有遗漏',
          solutionQuote:
            '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
        },
        ...(level === 3
          ? [
              {
                kind: 'condition_contrast' as const,
                originalCondition: '合法分组须同时满足对象覆盖与等和约束。',
                changedCondition: '忽略覆盖而只验证等和，会允许重复同一数对。',
                invariant: '局部等和不能替代每个对象恰好使用一次。',
                adaptation:
                  '以重复{1,6}为原知识内反例，定位局部必要条件的边界。',
                sourceQuote: analysis.questions[0].stem,
                problemQuote: '每个数恰用一次',
                solutionQuote:
                  '仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次',
              },
            ]
          : []),
      ],
      selfChecks: [
        {
          kind: 'conditions' as const,
          method: '逐数标记出现次数并核对各组人数，检查重复和遗漏。',
          expected: '六个数各出现一次，每组恰好两个数。',
          solutionQuote:
            '构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件',
        },
        {
          kind: 'reasoning' as const,
          method: '检查最小未用数能否换成另一个合法搭档。',
          expected: '共同和固定后每次搭档唯一，无法漏掉另一分组。',
          solutionQuote:
            '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
        },
        {
          kind: 'result' as const,
          method: '独立计算三组的和，再按顺序等价口径核最终分组数。',
          expected: '三组和都为7，组内组间排列去重后只有一种。',
          solutionQuote:
            '最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。',
        },
      ].slice(0, level),
    },
  ];
}
function paper(level: ChallengeLevel = 1): ChallengePaper {
  const question = Object.fromEntries(
    Object.entries(analysis.questions[0]).filter(
      ([key]) => key !== 'sourceRefs' && key !== 'difficulty',
    ),
  ) as unknown as PaperQuestion;
  const metrics = Object.fromEntries(
    applicableChallengeMetrics('math', level, question).map(metric => [
      metric.key,
      metric.min,
    ]),
  );
  return {
    title: '等和分组挑战',
    masteryStatus: 'training_only',
    subject: 'math',
    level,
    sections: mockClone(analysis.sections),
    materials: [],
    figures: [],
    questions: [
      {
        ...question,
        stem: '把1、2、3、4、5、6分成三组，每组两个数且每组和相等；每个数恰用一次，组内顺序和三组顺序不计。求全部不同分法并说明没有遗漏。',
        upgrade: {
          level,
          metrics,
          ...partitionDepth(level),
          changes: ['原题给出一种分法→新题要求所有分法并说明无遗漏'],
          pitfalls: [
            '不能只试配一个例子就声称已经找到全部',
            '组内顺序与组间顺序不重复计数',
            '不能只给必要的目标和而不构造并证明无遗漏',
          ].slice(0, level),
          scopeExplanation:
            '只组合原题整数四则运算与等量关系，允许新的解法组织，不引入排列组合公式或新定理。',
        },
      },
    ],
    answers: [
      {
        questionId: 'q1',
        status: 'verified',
        answer: '1种：{1,6}、{2,5}、{3,4}。',
        explanation: partitionSolution,
        learningGuide: partitionGuide(level),
        scoringPoints: [
          '由总和21反推每组和为7',
          '以唯一搭档构造分组并说明无遗漏',
        ],
      },
    ],
    totalScore: 5,
    timeLimitMinutes: 5,
  };
}
function review(verdict: 'approve' | 'revise' = 'approve'): ChallengeReview {
  return {
    role: 'answers',
    verdict,
    checkedQuestionIds: ['q1'],
    summary:
      verdict === 'approve'
        ? '独立求解后，题型、知识范围、难度和答案均满足标准。'
        : '计算结果与条件不一致，需修订。',
    issues:
      verdict === 'approve'
        ? []
        : [
            {
              questionId: 'q1',
              code: 'answer',
              comment: '唯一搭档推理说明只有1种分组，不能写2种。',
              fix: '按原式重新计算并修正答案和解析。',
            },
          ],
  };
}
function requestPayload(input: ModelInput) {
  let text = '';
  if (typeof input === 'string') {
    text = input;
  } else {
    const messages = input as unknown as {content?: unknown}[];
    const content = messages[0]?.content;
    if (Array.isArray(content)) {
      const parts = content as {type: string; text?: string}[];
      text = parts.find(item => item.type === 'input_text')?.text || '';
    }
  }
  if (text.startsWith('挑战逐页解析')) {
    return {task: 'page'};
  }
  return JSON.parse(text);
}
function task(input: ModelInput) {
  return requestPayload(input).task as string;
}
function roleReview(
  input: ModelInput,
  verdict: 'approve' | 'revise' = 'approve',
): ChallengeReview {
  const role = requestPayload(input).role as ChallengeReviewRole;
  return {...review(verdict), role, summary: `独立完成${role}职责的逐题评审。`};
}
function response(value: unknown) {
  return {text: JSON.stringify(value)};
}
function identificationFor(input: ModelInput, identified = identification) {
  const payload = JSON.parse(input as string) as {
    verification: SubjectVerification;
    phase?: string;
    samples?: {
      question: {id: string; sourceRefs: {pageIndex: number; quote: string}[]};
    }[];
    pages?: ChallengePage[];
  };
  if (payload.phase === 'progressive_vote') {
    return {
      votes: payload.samples!.map(sample => ({
        questionId: sample.question.id,
        subject: identified.subject,
        courseName: identified.courseName,
        integrated: identified.integrated,
        reason: identified.reason,
        evidence: sample.question.sourceRefs,
      })),
    };
  }
  return {
    ...mockClone(identified),
    evidence:
      payload.verification.mode === 'title_sample'
        ? [
            ...payload.verification.titleEvidence,
            ...payload.verification.samples.flatMap(item => item.sourceRefs),
          ]
        : payload.pages!.map(item => ({
            pageIndex: item.pageIndex,
            quote: item.text,
          })),
  };
}
const request = runResponse as jest.Mock;
const sampler = buildProgressiveSubjectVerification as jest.Mock;
const actualSampling: typeof import('../src/challenge/subjectSampling') =
  jest.requireActual('../src/challenge/subjectSampling');
const builder = buildChallengePdfs as jest.Mock;
const publisher = publishChallengePdfs as jest.Mock;
const route = async (input: ModelInput) => {
  switch (task(input)) {
    case 'page':
      return response(page);
    case '挑战科目识别':
      return response(identificationFor(input));
    case '挑战整卷分析':
      return response(analysis);
    case '挑战试卷生成':
    case '挑战试卷修订':
      return response(paper());
    case '挑战标准一致性校核':
      return response(review());
    default:
      throw new Error('未知测试任务');
  }
};
function record(ready = true): ChallengeRecord {
  return {
    id: 'challenge_test',
    title: '原试卷',
    status: ready ? 'analyzed' : 'imported',
    sources: [
      {
        kind: 'image',
        name: '原试卷.png',
        uri: 'file:///documents/challenges/challenge_test/page-1.png',
        pageUris: ['file:///documents/challenges/challenge_test/page-1.png'],
      },
    ],
    pageUris: ['file:///documents/challenges/challenge_test/page-1.png'],
    level: 1,
    pages: ready ? [mockClone(page)] : [],
    ...(ready ? {analysis: mockClone(analysis)} : {}),
    ...(ready ? {subjectIdentification: mockClone(identification)} : {}),
    reviewRounds: [],
    calls: [],
    progress: '',
    error: '',
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRecord = record();
  mockStandardApproved = true;
  sampler
    .mockReset()
    .mockImplementation(actualSampling.buildProgressiveSubjectVerification);
  request.mockReset().mockImplementation(route);
  builder
    .mockReset()
    .mockResolvedValue({paperBase64: 'JVBERi0=', answersBase64: 'JVBERi1h'});
  publisher.mockClear();
});

test('已作答试卷先逐页解析，再评估原难度与范围，分析阶段不命题或导出', async () => {
  mockRecord = record(false);
  const result = await analyzeChallenge('challenge_test', {settings});
  expect(result.status).toBe('analyzed');
  expect(result.analysis).toMatchObject({
    answerState: 'answered',
    difficultyBasis: 'estimated',
    knowledgePoints: ['整数四则运算与等量关系'],
  });
  expect(result.subjectIdentification).toMatchObject({
    subject: identification.subject,
    courseName: identification.courseName,
    status: 'confirmed',
  });
  expect(result.analysis?.subjectIdentification).toEqual(
    result.subjectIdentification,
  );
  expect(result.subjectVerification?.mode).toBe('progressive');
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    'page',
    '挑战整卷分析',
    '挑战科目识别',
  ]);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
  expect(request.mock.calls[0][1]).toContain('学生答案');
  const recognitionInput = JSON.parse(request.mock.calls[2][0] as string);
  expect(
    recognitionInput.subjects.every(
      (item: object) =>
        !('tiers' in item) &&
        !('masteryChallenges' in item) &&
        !('subjectBlueprint' in item),
    ),
  ).toBe(true);
  expect(recognitionInput).not.toHaveProperty('pages');
  expect(recognitionInput.samples).toHaveLength(1);
  expect(request.mock.calls[2][1]).toContain('英语文章谈数学');
});

test.each(['cannotIdentifySubject', 'mixed', 'uncertain'] as const)(
  '初判%s无法确认时停止，不为标题自动全核或加载科规则',
  async resultKind => {
    mockRecord = record(false);
    request.mockImplementation(async (input: ModelInput) =>
      task(input) === '挑战科目识别'
        ? response(
            resultKind === 'cannotIdentifySubject'
              ? {
                  cannotIdentifySubject: true,
                  reason: '原页包含不相关数学与英语题组，请按科拆分。',
                }
              : {
                  status: resultKind,
                  reason: '实际科目仍有冲突，请补课程页或按科拆分。',
                },
          )
        : route(input),
    );
    await expect(
      analyzeChallenge('challenge_test', {settings}),
    ).rejects.toThrow('按科拆分');
    expect(request.mock.calls.map(call => task(call[0]))).toEqual([
      'page',
      '挑战整卷分析',
      '挑战科目识别',
    ]);
    expect(mockRecord?.analysis).toBeUndefined();
    expect(mockRecord?.subjectIdentification).toBeUndefined();
    expect(mockRecord?.loadedSubjectRules).toBeUndefined();
    expect(mockRecord?.status).toBe('failed');
    expect(builder).not.toHaveBeenCalled();
  },
);

test('通用草稿不载科规则，标题抽样确认后加载本科再一致定稿', async () => {
  mockRecord = record(false);
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战整卷分析') {
      expect(mockRecord?.loadedSubjectRules).toBeUndefined();
      const data = JSON.parse(input as string);
      expect(data.phase).toBe('draft');
      expect(data).not.toHaveProperty('subjectAnalysisGuide');
      expect(mockRecord?.analysis).toBeUndefined();
    }
    if (task(input) === '挑战科目识别') {
      expect(mockRecord?.loadedSubjectRules).toBeUndefined();
    }
    return route(input);
  });
  const result = await analyzeChallenge('challenge_test', {settings});
  expect(result.loadedSubjectRules?.subject).toBe('math');
  expect(result.analysis?.subjectIdentification).toEqual(
    result.subjectIdentification,
  );
  expect(result.subjectIdentification).toMatchObject({
    subject: identification.subject,
    courseName: identification.courseName,
    status: 'confirmed',
  });
});

test('英语阅读讨论数学科技，材料主题不会覆盖独立识科结果或加载数学导航', async () => {
  mockRecord = record(false);
  const passage =
    'A school maths club designed a clean-energy project. Its members explained their ideas in English so visitors could discuss them.';
  const question = 'Why did the club members explain their ideas in English?';
  const sourcePage: ChallengePage = {
    ...page,
    hasStudentAnswers: false,
    text: `英语试卷\n阅读理解\nPassage\n${passage}\n1. ${question}\nA. To let visitors discuss the ideas.\nB. To teach a new maths rule.`,
  };
  const identified: SubjectIdentification = {
    status: 'confirmed',
    subject: 'english',
    courseName: '英语',
    integrated: false,
    reason:
      '标题为英语，原题要求根据英语文章推断交际目的；数学科技只是文章主题。',
    evidence: [
      {pageIndex: 0, quote: '英语试卷'},
      {pageIndex: 0, quote: `1. ${question}`},
    ],
  };
  const original: ExamAnalysis = {
    ...mockClone(analysis),
    title: '英语试卷',
    subject: 'english',
    subjectLabel: '英语',
    answerState: 'blank',
    subjectIdentification: identified,
    titleEvidence: [{pageIndex: 0, quote: '英语试卷'}],
    majorQuestions: [
      {
        id: 'major1',
        title: '阅读理解',
        sourceRefs: [{pageIndex: 0, quote: '阅读理解'}],
      },
    ],
    knowledgePoints: ['阅读理解中的目的推断'],
    difficultySummary: '利用文章线索推断交际目的，原难度为估计。',
    sections: [{id: 's1', title: '阅读理解', instructions: ''}],
    materials: [
      {
        id: 'm1',
        title: 'Passage',
        text: passage,
        isListening: false,
        figureIds: [],
      },
    ],
    questions: [
      {
        ...mockClone(analysis.questions[0]),
        type: '阅读单项选择题',
        stem: question,
        materialIds: ['m1'],
        knowledgePoints: ['阅读理解中的目的推断'],
        answerLines: 1,
        options: [
          {label: 'A', text: 'To let visitors discuss the ideas.'},
          {label: 'B', text: 'To teach a new maths rule.'},
        ],
        sourceRefs: [{pageIndex: 0, quote: `1. ${question}`}],
        difficulty: {
          rating: 2,
          reasoningSteps: 1,
          explanation: '从原文目的关系推断，不考数学科技知识。',
        },
      },
    ],
  };
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === 'page') {
      return response(sourcePage);
    }
    if (task(input) === '挑战科目识别') {
      return response(identificationFor(input, identified));
    }
    if (task(input) === '挑战整卷分析') {
      return response(original);
    }
    return route(input);
  });
  const result = await analyzeChallenge('challenge_test', {settings});
  expect(result.analysis?.subject).toBe('english');
  expect(result.loadedSubjectRules?.subject).toBe('english');
  const input = JSON.parse(
    request.mock.calls.find(
      call => task(call[0]) === '挑战科目识别',
    )![0] as string,
  );
  expect(input.verification.titleEvidence).toEqual([
    {pageIndex: 0, quote: '英语试卷'},
  ]);
  expect(input.samples[0].materials[0].text).toBe(passage);
  expect(input.samples[0].question).not.toHaveProperty('knowledgePoints');
  expect(input).not.toHaveProperty('pages');
  expect(JSON.stringify(input.samples)).not.toContain('math_case_completeness');
  expect(builder).not.toHaveBeenCalled();
});

test.each(['record', 'analysis', 'mismatch', 'forged'] as const)(
  '旧解析缺失或无效%s识科票据时，升档要求重新解析而非默认套科',
  async kind => {
    if (kind === 'record') {
      delete mockRecord!.subjectIdentification;
    } else if (kind === 'analysis') {
      delete mockRecord!.analysis!.subjectIdentification;
    } else if (kind === 'mismatch') {
      mockRecord!.subjectIdentification = {
        ...identification,
        subject: 'english',
      };
    } else {
      mockRecord!.subjectIdentification!.evidence[0].quote =
        '原页不存在的科目证明';
    }
    await expect(
      upgradeChallenge('challenge_test', 1, {settings}),
    ).rejects.toThrow(/重新解析|科目|原页/);
    expect(request).not.toHaveBeenCalled();
    expect(builder).not.toHaveBeenCalled();
  },
);

test('命题与综合校核仅携带已确认数学的规则目录与来源', async () => {
  await upgradeChallenge('challenge_test', 1, {settings});
  for (const call of request.mock.calls) {
    const context = `${call[1]}\n${JSON.stringify(call[0])}`;
    expect(context).toContain('math_case_completeness');
    for (const foreignId of [
      'en_pragmatic_register',
      'zh_writing_relations',
      'physics_momentum_system_direction',
      'chemistry_redox_electron_basis',
      'biology_information_direction_template',
      'hist_source_claim',
      'sh_gaokao_en_2025',
      'sh_grade_biology_2025',
    ]) {
      expect(context).not.toContain(foreignId);
    }
  }
});

test('识科JSON纠正重试沿用同一随机记录，不重新抽题且常规仍只一次草稿分析', async () => {
  mockRecord = record(false);
  let attempts = 0;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战科目识别') {
      attempts += 1;
      return attempts === 1
        ? {text: '{broken json'}
        : response(identificationFor(input));
    }
    return route(input);
  });
  const result = await analyzeChallenge('challenge_test', {settings});
  const checks = request.mock.calls.filter(
    call => task(call[0]) === '挑战科目识别',
  );
  expect(checks).toHaveLength(2);
  expect(checks[0][0]).toBe(checks[1][0]);
  expect(sampler).toHaveBeenCalledTimes(1);
  expect(result.subjectVerification).toEqual(
    result.subjectIdentification?.verification,
  );
  expect(
    request.mock.calls.filter(call => task(call[0]) === '挑战整卷分析'),
  ).toHaveLength(1);
});

test('初始题池少于3题时核验全部，不自动送整卷再次识科', async () => {
  mockRecord = record(false);
  const result = await analyzeChallenge('challenge_test', {settings});
  const checks = request.mock.calls
    .filter(call => task(call[0]) === '挑战科目识别')
    .map(call => JSON.parse(call[0] as string));
  expect(checks).toHaveLength(1);
  expect(checks[0].samples).toHaveLength(analysis.questions.length);
  expect(checks[0]).not.toHaveProperty('pages');
  expect(result.subjectVerification?.mode).toBe('progressive');
});

test.each(['no_title', 'no_hierarchy'] as const)(
  '%s仍只核验初始样题，不自动扩大整卷',
  async reason => {
    mockRecord = record(false);
    const draft = mockClone(analysis);
    const originalPage = mockClone(page);
    if (reason === 'no_title') {
      originalPage.text = originalPage.text.replace('数学试卷\n', '');
      draft.title = '未标标题试卷';
      draft.titleEvidence = [];
    } else {
      draft.majorQuestions = [];
      delete draft.questions[0].majorQuestionId;
    }
    request.mockImplementation(async (input: ModelInput) => {
      if (task(input) === 'page') {
        return response(originalPage);
      }
      if (task(input) === '挑战整卷分析') {
        return response(draft);
      }
      if (task(input) === '挑战科目识别') {
        return response(identificationFor(input));
      }
      return route(input);
    });
    const result = await analyzeChallenge('challenge_test', {settings});
    const checks = request.mock.calls.filter(
      call => task(call[0]) === '挑战科目识别',
    );
    expect(checks).toHaveLength(1);
    expect(JSON.parse(checks[0][0] as string)).toMatchObject({
      verification: {mode: 'progressive'},
    });
    expect(JSON.parse(checks[0][0] as string)).not.toHaveProperty('pages');
    expect(result.status).toBe('analyzed');
  },
);

test('通用标题只作参考，由实际样题投票确认课程', async () => {
  mockRecord = record(false);
  const originalPage = {
    ...page,
    text: page.text.replace('数学试卷', '期末试卷'),
  };
  const draft = {
    ...mockClone(analysis),
    title: '期末试卷',
    titleEvidence: [{pageIndex: 0, quote: '期末试卷'}],
  };
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === 'page'
      ? response(originalPage)
      : task(input) === '挑战整卷分析'
      ? response(draft)
      : task(input) === '挑战科目识别'
      ? response(identificationFor(input))
      : route(input),
  );
  const result = await analyzeChallenge('challenge_test', {settings});
  expect(
    request.mock.calls
      .filter(call => task(call[0]) === '挑战科目识别')
      .map(call => JSON.parse(call[0] as string).verification.mode),
  ).toEqual(['progressive']);
  expect(result.subjectVerification?.mode).toBe('progressive');
  expect(sampler).toHaveBeenCalledTimes(1);
});

test('草稿初判unknown不当other，确认后异常复核原卷并只保存一致最终分析', async () => {
  mockRecord = record(false);
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战整卷分析') {
      return response(
        JSON.parse(input as string).phase === 'draft'
          ? {
              ...mockClone(analysis),
              subject: 'unknown',
              subjectLabel: '尚待确认',
            }
          : analysis,
      );
    }
    if (task(input) === '挑战科目识别') {
      return response(identificationFor(input));
    }
    return route(input);
  });
  const result = await analyzeChallenge('challenge_test', {settings});
  const drafts = request.mock.calls
    .filter(call => task(call[0]) === '挑战整卷分析')
    .map(call => JSON.parse(call[0] as string));
  expect(drafts.map(item => item.phase)).toEqual([
    'draft',
    'confirmed_reanalysis',
  ]);
  expect(drafts[0]).not.toHaveProperty('subjectAnalysisGuide');
  expect(drafts[1].subjectAnalysisGuide.subject).toBe('math');
  expect(result.analysis?.subject).toBe('math');
  expect(result.loadedSubjectRules?.subject).toBe('math');
  expect(sampler).toHaveBeenCalledTimes(1);
});

test('科目冲突复核仍不一致时废除票据和已载绑定，不能保存可生成分析', async () => {
  mockRecord = record(false);
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战整卷分析') {
      return response({
        ...mockClone(analysis),
        subject: 'english',
        subjectLabel: '英语',
      });
    }
    if (task(input) === '挑战科目识别') {
      return response(identificationFor(input));
    }
    return route(input);
  });
  await expect(analyzeChallenge('challenge_test', {settings})).rejects.toThrow(
    '与独立识科结果一致',
  );
  expect(mockRecord?.subjectIdentification).toBeUndefined();
  expect(mockRecord?.loadedSubjectRules).toBeUndefined();
  expect(mockRecord?.analysis).toBeUndefined();
  expect(builder).not.toHaveBeenCalled();
});

test.each(['candidates', 'major'] as const)(
  '标题模式升级重验完整%s绑定，持久票据缩水即使自洽也拒绝',
  async kind => {
    const original = mockRecord!.analysis!;
    const second = {
      ...mockClone(original.questions[0]),
      id: 'q2',
      number: '2',
      sourceRefs: [{pageIndex: 0, quote: '2. ' + original.questions[0].stem}],
    };
    if (kind === 'major') {
      original.sections.push({id: 's2', title: '二、解答', instructions: ''});
      original.majorQuestions!.push({
        id: 'major2',
        title: '二、解答',
        sourceRefs: [{pageIndex: 0, quote: '二、解答'}],
      });
      second.sectionId = 's2';
      second.majorQuestionId = 'major2';
      mockRecord!.pages[0].text += '\n二、解答';
    }
    original.questions.push(second);
    original.totalScore = 10;
    mockRecord!.pages[0].text += '\n' + second.sourceRefs[0].quote;
    const verification = actualSampling.buildSubjectVerification(
      original,
      () => 0,
    );
    const identified = {
      ...mockClone(identification),
      evidence: [
        ...verification.titleEvidence,
        ...verification.samples.flatMap(item => item.sourceRefs),
      ],
      verification,
    };
    if (kind === 'candidates') {
      verification.samples[0].candidateQuestionIds = ['q1'];
    } else {
      verification.samples.pop();
    }
    mockRecord!.subjectVerification = mockClone(verification);
    mockRecord!.subjectIdentification = mockClone(identified);
    original.subjectIdentification = mockClone(identified);
    await expect(
      upgradeChallenge('challenge_test', 1, {settings}),
    ).rejects.toThrow(/抽样|层级/);
    expect(request).not.toHaveBeenCalled();
    expect(builder).not.toHaveBeenCalled();
  },
);

test('expanded旧样本仅保审计，真实全页票据不被修正前候选绑定阻止升级', async () => {
  const verification = actualSampling.buildSubjectVerification(
    mockRecord!.analysis!,
    () => 0,
  );
  verification.mode = 'expanded';
  verification.expansionReason =
    '全卷复核后已修正原草稿层级，保留先前抽样审计。';
  verification.samples[0].candidateQuestionIds.push('old_draft_leaf');
  const identified = {...mockClone(identification), verification};
  mockRecord!.subjectVerification = mockClone(verification);
  mockRecord!.subjectIdentification = mockClone(identified);
  mockRecord!.analysis!.subjectIdentification = mockClone(identified);
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.status).toBe('completed');
  expect(result.subjectVerification?.samples[0].candidateQuestionIds).toContain(
    'old_draft_leaf',
  );
});

test.each(['material', 'stem'] as const)(
  '原页未提供录音转写时，分析不能凭空在%s中制造听力原文',
  async location => {
    mockRecord = record(false);
    const originalPage: ChallengePage = {
      ...page,
      text: '英语听力\n1. Listen and choose.\nA. Tom\nB. Jack',
    };
    const invented =
      'Yesterday Tom told Jack that the party would start at eight.';
    const counterfeit = mockClone(analysis);
    counterfeit.subject = 'english';
    counterfeit.subjectLabel = '英语';
    counterfeit.titleEvidence = [{pageIndex: 0, quote: '英语听力'}];
    counterfeit.majorQuestions = [
      {
        id: 'major1',
        title: '听力',
        sourceRefs: [{pageIndex: 0, quote: '英语听力'}],
      },
    ];
    counterfeit.subjectIdentification = {
      status: 'confirmed',
      subject: 'english',
      courseName: '英语',
      integrated: false,
      reason: '原印刷标题为英语听力，且为英语听力选项任务。',
      evidence: [{pageIndex: 0, quote: '英语听力'}],
    };
    counterfeit.knowledgePoints = ['听力细节'];
    counterfeit.questions[0] = {
      ...counterfeit.questions[0],
      type: '单项选择题',
      isListening: true,
      stem:
        location === 'stem'
          ? `Listen and choose.\n听力原文：${invented}`
          : 'Listen and choose.',
      options: [
        {label: 'A', text: 'Tom'},
        {label: 'B', text: 'Jack'},
      ],
      knowledgePoints: ['听力细节'],
      materialIds: location === 'material' ? ['m1'] : [],
      sourceRefs: [{pageIndex: 0, quote: '1. Listen and choose.'}],
    };
    counterfeit.materials =
      location === 'material'
        ? [
            {
              id: 'm1',
              title: '听力原文',
              text: invented,
              isListening: true,
              figureIds: [],
            },
          ]
        : [];
    request.mockImplementation(async (input: ModelInput) =>
      response(
        task(input) === 'page'
          ? originalPage
          : task(input) === '挑战科目识别'
          ? counterfeit.subjectIdentification
          : counterfeit,
      ),
    );
    await expect(
      analyzeChallenge('challenge_test', {settings}),
    ).rejects.toThrow(/原文|转写|证据|原页/);
    expect(mockRecord?.status).toBe('failed');
    expect(builder).not.toHaveBeenCalled();
  },
);

test('非试卷图片不能命题，失败保留输入以便更换后重试', async () => {
  mockRecord = record(false);
  request.mockResolvedValue(
    response({...page, documentType: 'not_exam', text: '普通笔记'}),
  );
  await expect(analyzeChallenge('challenge_test', {settings})).rejects.toThrow(
    '不是试卷',
  );
  expect(mockRecord?.status).toBe('failed');
  expect(mockRecord?.sources).toHaveLength(1);
  expect(builder).not.toHaveBeenCalled();
});

test('未解析或存在被遮挡题干时不能直接升档', async () => {
  mockRecord = record(false);
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('解析');
  mockRecord = record();
  mockRecord.analysis!.unresolvedIssues = ['第1题印刷条件被学生笔迹遮挡'];
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('辨认');
  expect(request).not.toHaveBeenCalled();
  expect(builder).not.toHaveBeenCalled();
});

test('三档标准尚未经五角色评审定稿时，不能据此生成新卷', async () => {
  mockStandardApproved = false;
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('标准尚未完成五角色评审');
  expect(request).not.toHaveBeenCalled();
  expect(builder).not.toHaveBeenCalled();
});

test('圆桌设0仍保留一次基础综合校核，通过后才生成独立双PDF', async () => {
  const events: ChallengeRecord[] = [];
  const result = await upgradeChallenge('challenge_test', 1, {
    settings,
    onUpdate: value => events.push(mockClone(value)),
  });
  expect(result.status).toBe('completed');
  expect(result.paperPdfUri).not.toBe(result.answersPdfUri);
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战试卷生成',
    '挑战标准一致性校核',
  ]);
  expect(result.reviewRounds).toHaveLength(1);
  expect(result.reviewRounds[0].reviews).toHaveLength(1);
  expect(result.reviewRounds[0].reviews[0].role).toBe('answers');
  expect(builder).toHaveBeenCalledTimes(1);
  expect(
    events.findIndex(value => value.status === 'exporting'),
  ).toBeGreaterThan(events.findIndex(value => value.reviewRounds.length === 1));
  expect(request.mock.calls[1][1]).toContain('独立求解');
  expect(requestPayload(request.mock.calls[1][0]).role).toBe('answers');
});

const roundtableCases: {size: 3 | 5; roles: ChallengeReviewRole[]}[] = [
  {size: 3, roles: ['subject', 'difficulty', 'answers']},
  {
    size: 5,
    roles: ['subject', 'scope', 'difficulty', 'answers', 'presentation'],
  },
];

test.each(roundtableCases)(
  '圆桌设$size时真实独立调用所有指定角色，共同审固定候选且全票后导出',
  async ({size, roles}) => {
    request.mockImplementation(async (input: ModelInput) =>
      task(input) === '挑战标准一致性校核'
        ? response({
            ...roleReview(input),
            summary: `INDEPENDENT_${requestPayload(input).role}_SUMMARY`,
          })
        : route(input),
    );
    const result = await upgradeChallenge('challenge_test', 1, {
      settings: {...settings, roundtableSize: size},
    });
    const calls = request.mock.calls.filter(
      call => task(call[0]) === '挑战标准一致性校核',
    );
    expect(calls).toHaveLength(size);
    expect(calls.map(call => requestPayload(call[0]).role).sort()).toEqual(
      [...roles].sort(),
    );
    expect(result.reviewRoundtableSize).toBe(size);
    expect(result.reviewProtocolVersion).toBe(
      CHALLENGE_REVIEW_PROTOCOL_VERSION,
    );
    expect(result.reviewRounds).toHaveLength(1);
    expect(result.reviewRounds[0].roundtableSize).toBe(size);
    expect(
      result.reviewRounds[0].reviews.map(item => item.role).sort(),
    ).toEqual([...roles].sort());
    for (const call of calls) {
      const input = requestPayload(call[0]);
      expect(input).toMatchObject({
        roundtableSize: size,
        round: 1,
        candidateRevision: result.candidateRevision,
      });
      expect(input.candidate).toEqual(paper());
      expect(input.policy.subject).toBe('math');
      expect(call[4].history).toEqual([]);
      for (const role of roles) {
        expect(`${call[1]}${JSON.stringify(call[0])}`).not.toContain(
          `INDEPENDENT_${role}_SUMMARY`,
        );
      }
    }
    expect(new Set(calls.map(call => call[4].history)).size).toBe(size);
    expect(result.status).toBe('completed');
    expect(builder).toHaveBeenCalledTimes(1);
    expect(publisher).toHaveBeenCalledTimes(1);
  },
);

test('两角色异议汇总后修复，原3角色全部重审新revision，旧通过票不复用', async () => {
  const wrong = paper();
  wrong.answers[0].answer = '2种分组。';
  wrong.questions[0].upgrade.scopeExplanation =
    '只给知识标签，未解释对象覆盖条件来源。';
  const seen: Partial<Record<ChallengeReviewRole, number>> = {};
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      return response(wrong);
    }
    if (task(input) === '挑战标准一致性校核') {
      const role = requestPayload(input).role as ChallengeReviewRole;
      const first = !seen[role];
      seen[role] = (seen[role] || 0) + 1;
      if (first && (role === 'subject' || role === 'answers')) {
        return response({
          ...roleReview(input, 'revise'),
          issues: [
            {
              questionId: 'q1',
              code: role,
              comment:
                role === 'subject'
                  ? 'SUBJECT_SCOPE_ISSUE：需说明对象约束与原题知识的对应。'
                  : 'ANSWERS_COUNT_ISSUE：唯一搭档推理得1种，答案却写2种。',
              fix: '修正范围解释及最终答案，再由相同角色人数完整重审。',
            },
          ],
        });
      }
      return response(roleReview(input));
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {
    settings: {...settings, roundtableSize: 3},
  });
  const roles = ['subject', 'difficulty', 'answers'];
  expect(seen).toEqual({subject: 2, difficulty: 2, answers: 2});
  expect(result.reviewRounds).toHaveLength(2);
  for (const round of result.reviewRounds) {
    expect(round.roundtableSize).toBe(3);
    expect(round.reviews.map(item => item.role).sort()).toEqual(
      [...roles].sort(),
    );
  }
  expect(
    result.reviewRounds[0].reviews.filter(item => item.verdict === 'revise'),
  ).toHaveLength(2);
  expect(
    result.reviewRounds[1].reviews.every(item => item.verdict === 'approve'),
  ).toBe(true);
  expect(result.reviewRounds[1].candidateRevision).toBeGreaterThan(
    result.reviewRounds[0].candidateRevision,
  );
  const correction = request.mock.calls.find(
    call => task(call[0]) === '挑战试卷修订',
  )!;
  expect(JSON.stringify(correction[0])).toContain('SUBJECT_SCOPE_ISSUE');
  expect(JSON.stringify(correction[0])).toContain('ANSWERS_COUNT_ISSUE');
  expect(result.candidate?.answers[0].answer).toBe(
    '1种：{1,6}、{2,5}、{3,4}。',
  );
  expect(builder).toHaveBeenCalledTimes(1);
});

test.each(['wrong_role', 'missing_question'] as const)(
  '3角色中的%s不能凑齐通过票，纠正仍失败时不导出',
  async fault => {
    request.mockImplementation(async (input: ModelInput) => {
      if (task(input) === '挑战标准一致性校核') {
        const report = roleReview(input);
        if (report.role === 'difficulty') {
          if (fault === 'wrong_role') {
            report.role = 'subject';
          } else {
            report.checkedQuestionIds = [];
          }
        }
        return response(report);
      }
      return route(input);
    });
    await expect(
      upgradeChallenge('challenge_test', 1, {
        settings: {...settings, roundtableSize: 3},
      }),
    ).rejects.toThrow(/指定|checkedQuestionIds/);
    expect(mockRecord?.status).toBe('failed');
    expect(builder).not.toHaveBeenCalled();
    expect(publisher).not.toHaveBeenCalled();
  },
);

test('5角色未齐时不能用已有通过票发布，失败角色不捏造结果', async () => {
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战标准一致性校核') {
      if (requestPayload(input).role === 'presentation') {
        throw new Error('图文角色网络中断');
      }
      return response(roleReview(input));
    }
    return route(input);
  });
  await expect(
    upgradeChallenge('challenge_test', 1, {
      settings: {...settings, roundtableSize: 5},
    }),
  ).rejects.toThrow('图文角色网络中断');
  expect(mockRecord?.reviewRounds[0].reviews).toHaveLength(4);
  expect(
    mockRecord?.reviewRounds[0].reviews.some(
      item => item.role === 'presentation',
    ),
  ).toBe(false);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('5角色中仅一人连续有问题也须全员修复重审，不能四票多数发布', async () => {
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战标准一致性校核'
      ? response(
          roleReview(
            input,
            requestPayload(input).role === 'presentation'
              ? 'revise'
              : 'approve',
          ),
        )
      : route(input),
  );
  await expect(
    upgradeChallenge('challenge_test', 1, {
      settings: {...settings, roundtableSize: 5},
    }),
  ).rejects.toThrow('连续3轮');
  expect(
    request.mock.calls.filter(call => task(call[0]) === '挑战标准一致性校核'),
  ).toHaveLength(15);
  expect(mockRecord?.reviewRounds).toHaveLength(3);
  expect(
    mockRecord?.reviewRounds.every(round => round.reviews.length === 5),
  ).toBe(true);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('独立角色评审期间候选revision被改动，整轮旧票不得导出', async () => {
  let changed = false;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战标准一致性校核') {
      if (!changed && requestPayload(input).role === 'difficulty') {
        changed = true;
        mockRecord!.candidateRevision =
          (mockRecord!.candidateRevision || 0) + 1;
        mockRecord!.candidate!.answers[0].answer = '评审期间的外部修改';
      }
      return response(roleReview(input));
    }
    return route(input);
  });
  await expect(
    upgradeChallenge('challenge_test', 1, {
      settings: {...settings, roundtableSize: 3},
    }),
  ).rejects.toThrow(/候选|revision|改变/);
  expect(changed).toBe(true);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('带图新卷按3个角色分别附原页独立核查，最终合并成3份角色报告', async () => {
  const figure = {
    id: 'f1',
    kind: 'source' as const,
    pageIndex: 0,
    box: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
    caption: '原等和分组图',
    containsStudentMarks: false,
  };
  mockRecord!.analysis!.figures = [figure];
  mockRecord!.analysis!.questions[0].figureIds = ['f1'];
  mockRecord!.pages[0].figures = [figure];
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      const value = paper();
      value.figures = [figure];
      value.questions[0].figureIds = ['f1'];
      return response(value);
    }
    if (task(input) === '挑战标准一致性校核') {
      return response(roleReview(input));
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {
    settings: {...settings, roundtableSize: 3},
  });
  const calls = request.mock.calls.filter(
    call => task(call[0]) === '挑战标准一致性校核',
  );
  expect(calls).toHaveLength(3);
  for (const call of calls) {
    expect(
      call[0][0].content.filter((item: any) => item.type === 'input_image'),
    ).toHaveLength(1);
  }
  expect(result.reviewRounds[0].reviews.map(item => item.role).sort()).toEqual([
    'answers',
    'difficulty',
    'subject',
  ]);
  expect(result.status).toBe('completed');
});

test('校核发现答案错误时直接修订再重校，旧通过状态不能用于新revision', async () => {
  const wrong = paper();
  wrong.answers[0].answer = '2种分组。';
  let checks = 0;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      return response(wrong);
    }
    if (task(input) === '挑战标准一致性校核') {
      checks += 1;
      return response(review(checks === 1 ? 'revise' : 'approve'));
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.reviewRounds).toHaveLength(2);
  expect(result.reviewRounds[0].reviews[0].verdict).toBe('revise');
  expect(result.reviewRounds[1].reviews[0].verdict).toBe('approve');
  expect(result.reviewRounds[1].candidateRevision).toBeGreaterThan(
    result.reviewRounds[0].candidateRevision,
  );
  expect(result.candidate?.answers[0].answer).toBe(
    '1种：{1,6}、{2,5}、{3,4}。',
  );
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战试卷生成',
    '挑战标准一致性校核',
    '挑战试卷修订',
    '挑战标准一致性校核',
  ]);
  expect(builder).toHaveBeenCalledTimes(1);
});

test('连续三轮校核仍有问题时不得导出或假装通过', async () => {
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战标准一致性校核'
      ? response(review('revise'))
      : route(input),
  );
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('连续3轮');
  expect(mockRecord?.status).toBe('failed');
  expect(mockRecord?.reviewRounds).toHaveLength(3);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('校核漏审题目必须纠正结构，不能把空checkedQuestionIds视为通过', async () => {
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战标准一致性校核'
      ? response({...review(), checkedQuestionIds: []})
      : route(input),
  );
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('checkedQuestionIds');
  expect(
    request.mock.calls.filter(call => task(call[0]) === '挑战标准一致性校核'),
  ).toHaveLength(3);
  expect(builder).not.toHaveBeenCalled();
});

test('生成JSON有错时保留上一轮输出与反馈纠正，而不跳过数据校验', async () => {
  request.mockResolvedValueOnce({text: '{"level":1}'});
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.status).toBe('completed');
  expect(request.mock.calls[1][4].history).toEqual(
    expect.arrayContaining([
      {role: 'assistant', content: '{"level":1}'},
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('校验未通过'),
      }),
    ]),
  );
  expect(builder).toHaveBeenCalledTimes(1);
});

test.each([2, 3] as const)(
  '升%s档携带真实策略与五维学习说明，经综合校核按v3发布',
  async level => {
    request.mockImplementation(async (input: ModelInput) =>
      task(input) === '挑战试卷生成' ? response(paper(level)) : route(input),
    );
    const result = await upgradeChallenge('challenge_test', level, {settings});
    expect(result.status).toBe('completed');
    expect(result.policyVersion).toContain('within-scope-v3:3');
    expect(result.candidate?.masteryStatus).toBe('training_only');
    expect(result.candidate?.answers[0].learningGuide).toHaveLength(1);
    expect(
      result.candidate?.answers[0].learningGuide![0].misconceptions,
    ).toHaveLength(level);
    expect(
      result.candidate?.answers[0].learningGuide![0].selfChecks,
    ).toHaveLength(level);
    expect(
      result.candidate?.questions[0].upgrade.directionEvidence,
    ).toHaveLength(level);
    expect(
      result.candidate?.questions[0].upgrade.directionConnections,
    ).toHaveLength(level - 1);
    const generationInstructions = request.mock.calls[0][1] as string;
    expect(generationInstructions).toContain('directionEvidence');
    expect(generationInstructions).toContain('整体连通');
    expect(generationInstructions).toContain('focused');
    expect(generationInstructions).toContain('learningGuide');
    const checkInstructions = request.mock.calls[1][1] as string;
    expect(checkInstructions).toContain('更短巧解');
    expect(checkInstructions).toContain('不能同一步换名');
    expect(checkInstructions).toContain('没有学生后续新作答');
    expect(result.reviewRounds).toHaveLength(1);
    expect(builder).toHaveBeenCalledTimes(1);
  },
);

test('缺策略证据的旧版高计数输出先纠正，不能直接送校核或输出PDF', async () => {
  const legacy = paper(3);
  Reflect.deleteProperty(legacy.questions[0].upgrade, 'directionEvidence');
  let attempts = 0;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      attempts += 1;
      return response(attempts === 1 ? legacy : paper(3));
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 3, {settings});
  expect(result.status).toBe('completed');
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战试卷生成',
    '挑战试卷生成',
    '挑战标准一致性校核',
  ]);
  expect(request.mock.calls[1][4].history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('directionEvidence'),
      }),
    ]),
  );
  expect(builder).toHaveBeenCalledTimes(1);
});

test('反复伪造策略引文会在生成校验停止，即使校核模型准备同意也不能导出', async () => {
  const counterfeit = paper(3);
  counterfeit.questions[0].upgrade.directionEvidence![0].solutionQuote =
    '没有在答案解析出现的奥数方法';
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战试卷生成' ? response(counterfeit) : route(input),
  );
  await expect(
    upgradeChallenge('challenge_test', 3, {settings}),
  ).rejects.toThrow('必须逐字引用本题');
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战试卷生成',
    '挑战试卷生成',
    '挑战试卷生成',
  ]);
  expect(mockRecord?.status).toBe('failed');
  expect(mockRecord?.candidate).toBeUndefined();
  expect(mockRecord?.reviewRounds).toEqual([]);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('原知识与同题型约束无法满足所选档位时诚实停止，不虚报指标', async () => {
  request.mockResolvedValue(
    response({
      cannotUpgrade: true,
      reason: '本题原范围无法支持3档，请降低档位',
    }),
  );
  await expect(
    upgradeChallenge('challenge_test', 3, {settings}),
  ).rejects.toThrow('降低档位');
  expect(request).toHaveBeenCalledTimes(1);
  expect(mockRecord?.analysis?.knowledgePoints).toEqual([
    '整数四则运算与等量关系',
  ]);
  expect(builder).not.toHaveBeenCalled();
});

test('策略已达标但缺学习说明的旧输出仍须先纠正，不能直接导出', async () => {
  const incomplete = paper(3);
  Reflect.deleteProperty(incomplete.answers[0], 'learningGuide');
  let attempts = 0;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      attempts += 1;
      return response(attempts === 1 ? incomplete : paper(3));
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 3, {settings});
  expect(result.status).toBe('completed');
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战试卷生成',
    '挑战试卷生成',
    '挑战标准一致性校核',
  ]);
  expect(request.mock.calls[1][4].history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('learningGuide'),
      }),
    ]),
  );
  expect(
    result.candidate?.answers[0].learningGuide![0].transferLinks,
  ).toHaveLength(2);
  expect(builder).toHaveBeenCalledTimes(1);
});

test('学习说明借自身文字伪造解答依据，反复不修时在导出前停止', async () => {
  const counterfeit = paper();
  const guide = counterfeit.answers[0].learningGuide![0];
  guide.solutionQuote = guide.coreInsight;
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战试卷生成' ? response(counterfeit) : route(input),
  );
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('不能以学习说明自身');
  expect(request).toHaveBeenCalledTimes(3);
  expect(mockRecord?.candidate).toBeUndefined();
  expect(mockRecord?.reviewRounds).toEqual([]);
  expect(builder).not.toHaveBeenCalled();
  expect(publisher).not.toHaveBeenCalled();
});

test('综合校核发现无依据的学生掌握结论后修复学习说明，再重新校核导出', async () => {
  const overclaim = paper();
  overclaim.answers[0].learningGuide![0].coreInsight =
    '由生成成功可知你已经完全掌握本知识点，个人正确率100%。';
  let checks = 0;
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      return response(overclaim);
    }
    if (task(input) === '挑战标准一致性校核') {
      checks += 1;
      if (checks === 1) {
        return response({
          ...review('revise'),
          issues: [
            {
              questionId: 'q1',
              code: 'unsupported_mastery',
              comment: '没有学生新作答，生成成功不能证明个人掌握或正确率。',
              fix: '把能力结论改为本知识点的训练原理，保留具体错因与自检方法。',
            },
          ],
        });
      }
      return response(review());
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.status).toBe('completed');
  expect(
    result.candidate?.answers[0].learningGuide![0].coreInsight,
  ).not.toContain('完全掌握');
  expect(result.candidate?.masteryStatus).toBe('training_only');
  expect(result.reviewRounds.map(round => round.reviews[0].verdict)).toEqual([
    'revise',
    'approve',
  ]);
  expect(result.reviewRounds[1].candidateRevision).toBeGreaterThan(
    result.reviewRounds[0].candidateRevision,
  );
  expect(builder).toHaveBeenCalledTimes(1);
});

test('同一操作重复点击复用Promise，另一档或解析不能并发覆盖', async () => {
  const entered = deferred<void>();
  const release = deferred<{text: string}>();
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      entered.resolve();
      return release.promise;
    }
    return route(input);
  });
  const first = upgradeChallenge('challenge_test', 1, {settings});
  const repeated = upgradeChallenge('challenge_test', 1, {settings});
  expect(repeated).toBe(first);
  await entered.promise;
  await expect(
    upgradeChallenge('challenge_test', 2, {settings}),
  ).rejects.toThrow('正在处理');
  await expect(analyzeChallenge('challenge_test', {settings})).rejects.toThrow(
    '正在处理',
  );
  release.resolve(response(paper()));
  await first;
  expect(
    request.mock.calls.filter(call => task(call[0]) === '挑战试卷生成'),
  ).toHaveLength(1);
});

test('取消后迟到模型输出不能继续校核或生成PDF，原分析保留', async () => {
  const entered = deferred<void>();
  const release = deferred<{text: string}>();
  const controller = new AbortController();
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      entered.resolve();
      return release.promise;
    }
    return route(input);
  });
  const work = upgradeChallenge('challenge_test', 1, {
    settings,
    signal: controller.signal,
  });
  await entered.promise;
  controller.abort();
  release.resolve(response(paper()));
  await expect(work).rejects.toThrow('停止');
  expect(mockRecord?.status).toBe('cancelled');
  expect(mockRecord?.analysis).toBeTruthy();
  expect(builder).not.toHaveBeenCalled();
});

test('记录已删除时迟到模型回复不能恢复记录或生成孤儿PDF', async () => {
  const entered = deferred<void>();
  const release = deferred<{text: string}>();
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      entered.resolve();
      return release.promise;
    }
    return route(input);
  });
  const work = upgradeChallenge('challenge_test', 1, {settings});
  await entered.promise;
  mockRecord = undefined;
  release.resolve(response(paper()));
  await expect(work).rejects.toThrow('已删除');
  expect(mockRecord).toBeUndefined();
  expect(builder).not.toHaveBeenCalled();
});

test('PDF生成或持久化失败时保留校核结果，但不能显示完成或下载链接', async () => {
  builder.mockRejectedValueOnce(new Error('PDF字体暂时不可用'));
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('PDF字体');
  expect(mockRecord?.status).toBe('failed');
  expect(mockRecord?.reviewRounds[0].reviews[0].verdict).toBe('approve');
  expect(mockRecord?.paperPdfUri).toBeFalsy();
  expect(publisher).not.toHaveBeenCalled();
});

test('重新升档开始时清除旧PDF与旧校核，不把上一版成果当本次成功', async () => {
  mockRecord!.paperPdfUri =
    'file:///documents/challenges/challenge_test/old-paper.pdf';
  mockRecord!.answersPdfUri =
    'file:///documents/challenges/challenge_test/old-answers.pdf';
  mockRecord!.status = 'completed';
  request.mockRejectedValueOnce(new Error('网络中断'));
  await expect(
    upgradeChallenge('challenge_test', 1, {settings}),
  ).rejects.toThrow('网络中断');
  expect(mockRecord?.paperPdfUri).toBeFalsy();
  expect(mockRecord?.answersPdfUri).toBeFalsy();
  expect(mockRecord?.status).toBe('failed');
});

test('实际引用图的原页逐页附图综合校核，最后合并一份报告而非发五票', async () => {
  const firstFigure = {
    id: 'f1',
    kind: 'source' as const,
    pageIndex: 0,
    box: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
    caption: '整数分组图',
    containsStudentMarks: false,
  };
  const secondFigure = {...firstFigure, id: 'f2', pageIndex: 1};
  mockRecord!.pageUris.push(
    'file:///documents/challenges/challenge_test/page-2.png',
  );
  mockRecord!.analysis!.figures = [firstFigure, secondFigure];
  mockRecord!.analysis!.questions[0].figureIds = ['f1', 'f2'];
  mockRecord!.pages[0].figures = [firstFigure];
  mockRecord!.pages.push({
    ...mockClone(page),
    pageIndex: 1,
    text: '数学试卷续页\n图f2为第一题续图。',
    figures: [secondFigure],
  });
  mockRecord!.subjectIdentification!.evidence.push({
    pageIndex: 1,
    quote: '数学试卷续页',
  });
  mockRecord!.analysis!.subjectIdentification = mockClone(
    mockRecord!.subjectIdentification!,
  );
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      const value = paper();
      value.figures = [firstFigure, secondFigure];
      value.questions[0].figureIds = ['f1', 'f2'];
      return response(value);
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  const checks = request.mock.calls.filter(
    call => task(call[0]) === '挑战标准一致性校核',
  );
  expect(checks).toHaveLength(2);
  for (const check of checks) {
    expect(
      check[0][0].content.filter((part: any) => part.type === 'input_image'),
    ).toHaveLength(1);
  }
  expect(imageAsDataUri).toHaveBeenCalledTimes(2);
  expect(result.reviewRounds[0].reviews).toHaveLength(1);
  expect(result.status).toBe('completed');
});

test.each([
  {votes: ['math', 'math', 'math'], sizes: [3]},
  {votes: ['math', 'math', 'english', 'math'], sizes: [3, 1]},
  {votes: ['math', 'math', 'english', 'english', 'math'], sizes: [3, 1, 1]},
])(
  '递进识科只发送新增样题：$sizes，形成共识后不再多取题',
  async ({votes, sizes}) => {
    mockRecord = record(false);
    const draft = mockClone(analysis);
    draft.questions = Array.from({length: 5}, (_, index) => ({
      ...mockClone(analysis.questions[0]),
      id: `q${index + 1}`,
      number: String(index + 1),
      sourceRefs: [
        {pageIndex: 0, quote: `${index + 1}. ${analysis.questions[0].stem}`},
      ],
    }));
    draft.totalScore = draft.questions.reduce(
      (sum, question) => sum + (question.score || 0),
      0,
    );
    const originalPage = {
      ...page,
      text: `${page.text}\n${draft.questions
        .map(question => question.sourceRefs[0].quote)
        .join('\n')}`,
    };
    let index = 0;
    request.mockImplementation(async (input: ModelInput) => {
      if (task(input) === 'page') {
        return response(originalPage);
      }
      if (task(input) === '挑战整卷分析') {
        return response(draft);
      }
      if (task(input) === '挑战科目识别') {
        expect(mockRecord?.loadedSubjectRules).toBeUndefined();
        const payload = JSON.parse(input as string);
        return response({
          votes: payload.samples.map((sample: any) => {
            const subject = votes[index++];
            return {
              questionId: sample.question.id,
              subject,
              courseName: subject === 'math' ? '数学' : '英语',
              integrated: false,
              reason: '依据本题原印刷任务判定课程。',
              evidence: sample.question.sourceRefs,
            };
          }),
        });
      }
      return route(input);
    });
    const result = await analyzeChallenge('challenge_test', {settings});
    const calls = request.mock.calls
      .filter(call => task(call[0]) === '挑战科目识别')
      .map(call => JSON.parse(call[0] as string));
    expect(calls.map(call => call.samples.length)).toEqual(sizes);
    expect(calls.every(call => !call.pages)).toBe(true);
    expect(result.subjectVerification?.samples).toHaveLength(votes.length);
    expect(result.subjectVerification?.votes).toHaveLength(votes.length);
    expect(result.analysis?.subject).toBe('math');
    expect(result.loadedSubjectRules?.subject).toBe('math');
  },
);

test('非听力混合升档卷可完成评审和PDF发布，保留题不被误算或强制改写', async () => {
  const original = mockClone(analysis);
  original.questions = Array.from({length: 5}, (_, index) => ({
    ...mockClone(analysis.questions[0]),
    id: `q${index + 1}`,
    number: String(index + 1),
  }));
  original.totalScore = original.questions.reduce(
    (sum, question) => sum + (question.score || 0),
    0,
  );
  original.questions[0].analysisIssues = [
    '原印刷完整，难度基线尚需核实，保留本题。',
  ];
  mockRecord!.analysis = original;
  const generated = paper();
  generated.totalScore = original.totalScore;
  const variant = mockClone(generated.questions[0]);
  const answer = mockClone(generated.answers[0]);
  generated.questions = original.questions.map((question, index) =>
    index === 1
      ? {
          ...mockClone(variant),
          id: question.id,
          number: question.number,
          upgrade: {...variant.upgrade, mode: 'upgraded'},
        }
      : {
          ...mockClone(question),
          upgrade: {
            mode: 'retained',
            level: 1,
            retentionReason: '原题当前不宜变式，保持原条件。',
            metrics: {},
            changes: [],
            pitfalls: [],
            scopeExplanation: '原题原样保留，不计升档。',
          },
        },
  );
  generated.answers = original.questions.map((question, index) =>
    index === 1
      ? {...mockClone(answer), questionId: question.id}
      : {
          questionId: question.id,
          status: 'verified',
          answer: '3',
          explanation: '按原题等量关系核验并求出原数为3。',
          scoringPoints: ['满足原题条件'],
        },
  );
  request.mockImplementation(async (input: ModelInput) => {
    if (task(input) === '挑战试卷生成') {
      return response(generated);
    }
    if (task(input) === '挑战标准一致性校核') {
      return response({
        ...review(),
        checkedQuestionIds: original.questions.map(question => question.id),
      });
    }
    return route(input);
  });
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.status).toBe('completed');
  expect(
    result.candidate?.questions.filter(
      question => question.upgrade.mode === 'upgraded',
    ),
  ).toHaveLength(1);
  expect(
    result.candidate?.questions.filter(
      question => question.upgrade.mode === 'retained',
    ),
  ).toHaveLength(4);
  expect(result.selectionPolicyVersion).toBe('challenge-selection-v1');
  expect(builder).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({questions: generated.questions}),
    expect.anything(),
  );
  expect(publisher).toHaveBeenCalledTimes(1);
});

test('识科返回整体不确定时仍记录本轮未知票，不自动发送整卷或伪造多数', async () => {
  mockRecord = record(false);
  request.mockImplementation(async (input: ModelInput) =>
    task(input) === '挑战科目识别'
      ? response({
          cannotIdentifySubject: true,
          reason: '本题上下文仍不足以可靠判科。',
        })
      : route(input),
  );
  await expect(analyzeChallenge('challenge_test', {settings})).rejects.toThrow(
    '未形成明确课程多数',
  );
  expect(mockRecord?.subjectVerification?.votes).toEqual([
    expect.objectContaining({
      subject: 'unknown',
      questionId: analysis.questions[0].id,
    }),
  ]);
  const calls = request.mock.calls.filter(
    call => task(call[0]) === '挑战科目识别',
  );
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][0] as string)).not.toHaveProperty('pages');
});

test('标题先初判科目，再以样题核验；确认前不加载科规则', async () => {
  mockRecord = record(false);
  const result = await analyzeChallenge('challenge_test', {settings});
  const call = request.mock.calls.find(
    item => task(item[0]) === '挑战科目识别',
  )!;
  const payload = JSON.parse(call[0] as string);
  expect(payload.purpose).toBe('verify_title');
  expect(payload.titleIdentification).toMatchObject({
    subject: 'math',
    courseName: '数学',
  });
  expect(result.subjectVerification?.titleVerification).toBe('verified');
  expect(result.subjectIdentification?.reason).toContain('标题初判数学');
});

test.each(['resume', 'restart'] as const)(
  '成功解析后选择%s，是否复用逐页识别由模式决定',
  async analysisMode => {
    mockRecord = record();
    const result = await analyzeChallenge('challenge_test', {
      settings,
      analysisMode,
    });
    expect(result.status).toBe('analyzed');
    const pages = request.mock.calls.filter(call => task(call[0]) === 'page');
    expect(pages).toHaveLength(analysisMode === 'resume' ? 0 : 1);
    expect(
      request.mock.calls.filter(call => task(call[0]) === '挑战科目识别'),
    ).toHaveLength(1);
  },
);

test('失败后继续解析保留已完成页面，只重做后续结构与科目核验', async () => {
  mockRecord = record(false);
  mockRecord.status = 'failed';
  mockRecord.pages = [mockClone(page)];
  await analyzeChallenge('challenge_test', {settings, analysisMode: 'resume'});
  expect(request.mock.calls.map(call => task(call[0]))).toEqual([
    '挑战整卷分析',
    '挑战科目识别',
  ]);
});

test('同学科有效识科票据的课程别名和说明差异不再误挡升档', async () => {
  mockRecord = record();
  mockRecord.analysis!.subjectIdentification = {
    ...mockClone(identification),
    courseName: 'Mathematics',
    reason: '同一课程的另一份有效核验说明。',
  };
  const result = await upgradeChallenge('challenge_test', 1, {settings});
  expect(result.status).toBe('completed');
  expect(result.analysis?.subjectIdentification).toEqual(
    result.subjectIdentification,
  );
  expect(
    request.mock.calls.filter(call => task(call[0]) === '挑战科目识别'),
  ).toHaveLength(0);
});
