import React from 'react';
import {Alert, PermissionsAndroid, Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import Pdf from 'react-native-pdf';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import ChallengeScreen from '../src/components/ChallengeScreen';
import {DEFAULT_SETTINGS} from '../src/settings';
import {getChallengePolicy} from '../src/challenge/rules';
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
} from '../src/challenge/store';
import {analyzeChallenge, upgradeChallenge} from '../src/challenge/pipeline';
import {getChallengeTask} from '../src/challenge/tasks';
import {parseUsage} from '../src/services/usage';
import {ModelCall} from '../src/types';
import {
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  getChallengeReviewRoles,
} from '../src/challenge/review';
import {
  discardChallengePdf,
  pickChallengePdf,
  saveChallengePdf,
} from '../src/challenge/documents';
import {
  ChallengePaper,
  ChallengeRecord,
  ChallengeRoundtableSize,
  ChallengeSource,
  ExamAnalysis,
  SubjectIdentification,
  SubjectVerification,
} from '../src/challenge/types';

jest.mock('react-native-pdf', () => 'ChallengePdf');
jest.mock('../src/components/ImageViewer', () => 'ChallengeImageViewer');
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('../src/challenge/store', () => ({
  createChallenge: jest.fn(),
  deleteChallenge: jest.fn(),
  getChallenge: jest.fn(),
  listChallenges: jest.fn(),
}));
jest.mock('../src/challenge/pipeline', () => ({
  analyzeChallenge: jest.fn(),
  upgradeChallenge: jest.fn(),
}));
jest.mock('../src/challenge/documents', () => ({
  pickChallengePdf: jest.fn(),
  saveChallengePdf: jest.fn(),
  discardChallengePdf: jest.fn(async () => undefined),
}));

const source: ChallengeSource = {
  kind: 'image',
  name: '原卷照片',
  uri: 'file:///page.jpg',
  pageUris: ['file:///page.jpg'],
};
const pdfSource: ChallengeSource = {
  kind: 'pdf',
  name: '原卷.pdf',
  uri: 'file:///import/source.pdf',
  pageUris: ['file:///import/1.jpg', 'file:///import/2.jpg'],
};
const mathIdentification: SubjectIdentification = {
  status: 'confirmed',
  subject: 'math',
  courseName: '数学',
  integrated: false,
  reason: '题目为数学计算题。',
  evidence: [{pageIndex: 0, quote: '计算2+3。'}],
};
const analysis: ExamAnalysis = {
  isExam: true,
  title: '数学练习卷',
  subject: 'math',
  subjectLabel: '数学',
  educationLevel: 'middle',
  knowledgePoints: ['整数运算'],
  difficultySummary: '基础运算为主，需识别条件。',
  difficultyBasis: 'estimated',
  answerState: 'answered',
  sections: [{id: 's1', title: '计算题', instructions: '计算。'}],
  materials: [],
  figures: [],
  questions: [
    {
      id: 'q1',
      number: '1',
      sectionId: 's1',
      type: '计算题',
      stem: '计算2+3。',
      options: [],
      materialIds: [],
      figureIds: [],
      knowledgePoints: ['整数运算'],
      score: 5,
      isListening: false,
      answerLines: 3,
      sourceRefs: [{pageIndex: 0, quote: '计算2+3。'}],
      difficulty: {rating: 2, reasoningSteps: 1, explanation: '一次加法运算。'},
    },
  ],
  totalScore: 5,
  timeLimitMinutes: null,
  warnings: [],
  unresolvedIssues: [],
  subjectIdentification: mathIdentification,
};
const candidate: ChallengePaper = {
  title: '数学挑战卷',
  subject: 'math',
  level: 1,
  sections: analysis.sections,
  materials: [],
  figures: [],
  questions: [
    {
      ...analysis.questions[0],
      stem: '计算2+3+4。',
      upgrade: {
        level: 1,
        metrics: {
          changedConditions: 1,
          pitfallDistinctions: 1,
          reasoningStepsAdded: 1,
          representationChanges: 1,
        },
        changes: ['增加一项加数'],
        pitfalls: ['遗漏加数'],
        scopeExplanation: '仍是整数加法。',
      },
    },
  ],
  answers: [
    {
      questionId: 'q1',
      status: 'verified',
      answer: '9',
      explanation: '依次相加。',
      scoringPoints: ['正确计算'],
    },
  ],
  totalScore: 5,
  timeLimitMinutes: null,
};
const base: ChallengeRecord = {
  id: 'challenge_test',
  title: '原卷照片',
  status: 'imported',
  sources: [source],
  pageUris: source.pageUris,
  level: 1,
  pages: [],
  reviewRounds: [],
  calls: [],
  progress: '等待解析',
  error: '',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};
const analyzed: ChallengeRecord = {
  ...base,
  title: analysis.title,
  status: 'analyzed',
  analysis,
  subjectIdentification: mathIdentification,
};
const completed: ChallengeRecord = {
  ...analyzed,
  status: 'completed',
  candidate,
  candidateRevision: 1,
  paperPdfUri: 'file:///paper.pdf',
  answersPdfUri: 'file:///answers.pdf',
  reviewRounds: [
    {
      round: 1,
      candidateRevision: 1,
      reviews: [
        {
          role: 'answers',
          verdict: 'approve',
          checkedQuestionIds: ['q1'],
          summary: '已按定稿标准核对原题范围、变种与答案。',
          issues: [],
        },
      ],
    },
  ],
};
const settings = {...DEFAULT_SETTINGS, apiKey: 'test-key'};

function roundtableRecord(size: ChallengeRoundtableSize): ChallengeRecord {
  return {
    ...completed,
    reviewRoundtableSize: size,
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    reviewRounds: [
      {
        ...completed.reviewRounds[0],
        roundtableSize: size,
        reviews: getChallengeReviewRoles(size).map(role => ({
          ...completed.reviewRounds[0].reviews[0],
          role,
          issues: [],
        })),
      },
    ],
  };
}
const back = jest.fn();
const modelSettings = jest.fn();
const selection = jest.fn();
let view: ReactTestRenderer | undefined;

const text = () => screenText();
const screenText = () =>
  view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join('\n');
const button = (label: string) =>
  view!.root
    .findAllByType(Pressable)
    .find(node =>
      node.findAllByType(Text).some(child => child.props.children === label),
    )!;
const press = (label: string) =>
  act(async () => {
    await button(label).props.onPress();
  });
const settle = () => act(async () => {});
const selectRecord = (title: string) =>
  act(() => {
    view!.root
      .findAllByType(Pressable)
      .find(node => node.props.accessibilityLabel === `选择${title}`)!
      .props.onPress();
  });
async function render(
  initialChallengeId?: string,
  roundtableSize: ChallengeRoundtableSize = settings.roundtableSize,
) {
  await act(async () => {
    view = create(
      <ChallengeScreen
        settings={{...settings, roundtableSize}}
        onBack={back}
        onSettings={modelSettings}
        initialChallengeId={initialChallengeId}
        onSelectionChange={selection}
      />,
    );
  });
}
async function uploadPhoto() {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [{uri: source.uri, fileName: source.name}],
  });
  await press('上传照片');
}
async function openSaved(
  value = analyzed,
  roundtableSize: ChallengeRoundtableSize = settings.roundtableSize,
) {
  (listChallenges as jest.Mock).mockResolvedValueOnce([value]);
  (getChallenge as jest.Mock).mockResolvedValueOnce(value);
  await render(undefined, roundtableSize);
  await press(`打开${value.title}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}

function modelCall(patch: Partial<ModelCall> = {}): ModelCall {
  return {
    id: 'call_analysis',
    operation: 'response',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-11-11T01:00:00.000Z',
    finishedAt: null,
    durationMs: null,
    responseId: null,
    httpStatus: null,
    measuredInputTokens: null,
    rawUsageJson: null,
    ...parseUsage(undefined),
    ...patch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (listChallenges as jest.Mock).mockResolvedValue([]);
  (getChallenge as jest.Mock).mockResolvedValue(undefined);
  (createChallenge as jest.Mock).mockResolvedValue(base);
  (analyzeChallenge as jest.Mock).mockResolvedValue(analyzed);
  (upgradeChallenge as jest.Mock).mockResolvedValue(completed);
  (pickChallengePdf as jest.Mock).mockResolvedValue(null);
  (saveChallengePdf as jest.Mock).mockResolvedValue(true);
  (deleteChallenge as jest.Mock).mockResolvedValue(undefined);
  (discardChallengePdf as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  jest.restoreAllMocks();
});

test('原卷、分析、方案和两份PDF各有页卡，首次请求前隐藏消耗页卡', async () => {
  await render();
  const tabs = view!.root
    .findAllByType(Pressable)
    .filter(node => node.props.accessibilityRole === 'tab');
  expect(tabs.map(node => node.findByType(Text).props.children)).toEqual([
    '原卷',
    '试卷分析',
    '升档方案',
    '试卷预览',
    '答案预览',
  ]);
  expect(button('消耗详情')).toBeUndefined();
  expect(text()).toContain('上传一份试卷');
  await press('试卷分析');
  expect(text()).toContain('完成原卷解析后');
  expect(text()).not.toContain('上传一份试卷');
  await press('升档方案');
  expect(button('升档').props.disabled).toBe(true);
  await press('试卷预览');
  expect(text()).toContain('通过校核并生成两份 PDF');
});

test('取消照片或PDF导入不创建挑战，未选原卷时解析禁用', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({didCancel: true});
  await render();
  expect(button('解析试卷').props.disabled).toBe(true);
  await press('上传照片');
  await press('上传 PDF');
  expect(createChallenge).not.toHaveBeenCalled();
  expect(analyzeChallenge).not.toHaveBeenCalled();
});

test('照片和PDF可混合导入并排序、移除，点击解析才创建持久挑战', async () => {
  (pickChallengePdf as jest.Mock).mockResolvedValueOnce(pdfSource);
  await render();
  await uploadPhoto();
  await press('上传 PDF');
  expect(createChallenge).not.toHaveBeenCalled();
  expect(text()).toContain('共 3 页');
  await press('第2项上移');
  await press('移除第2项');
  await press('解析试卷');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith([pdfSource]);
  expect(analyzeChallenge).toHaveBeenCalledTimes(1);
  expect(text()).toContain('原卷解析');
  expect(text()).toContain('逐题分析');
});

test('拍照取消不入库，选择器错误明确展示并允许重试', async () => {
  (launchCamera as jest.Mock).mockResolvedValueOnce({didCancel: true});
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    errorCode: 'permission',
    errorMessage: '相册权限未授权',
  });
  await render();
  await press('拍照');
  await press('上传照片');
  expect(text()).toContain('相册权限未授权');
  await uploadPhoto();
  expect(button('解析试卷').props.disabled).toBe(false);
  expect(createChallenge).not.toHaveBeenCalled();
});

test('原卷缩略图点击可全屏看多页，切换页卡不丢失已选输入', async () => {
  await render();
  await uploadPhoto();
  await act(async () =>
    view!.root
      .findAllByType(Pressable)
      .find(node => node.props.accessibilityLabel === '查看原卷第1页')!
      .props.onPress(),
  );
  expect(
    view!.root.findByType('ChallengeImageViewer' as any).props.uris,
  ).toEqual([source.uri]);
  act(() =>
    view!.root.findByType('ChallengeImageViewer' as any).props.onClose(),
  );
  await press('升档方案');
  await press('原卷');
  expect(text()).toContain(source.name);
  expect(button('解析试卷').props.disabled).toBe(false);
});

test('逐题分析、难度分布、知识范围只在分析页卡展示，不混入方案或原卷', async () => {
  await openSaved();
  expect(text()).toContain('难度分布');
  expect(text()).toContain('基础（1～3）：1 题');
  expect(text()).toContain('知识范围');
  expect(text()).toContain(analysis.questions[0].stem);
  await press('升档方案');
  expect(text()).not.toContain('难度分布');
  expect(text()).not.toContain(analysis.questions[0].stem);
  await press('原卷');
  expect(text()).not.toContain('知识范围');
  expect(text()).toContain('最近挑战');
});

test.each([1, 2, 3] as const)(
  '选择升%d档只显示当前档次的概括思路与对应覆盖率',
  async level => {
    await openSaved();
    await press('升档方案');
    await press(`升 ${level} 档`);
    expect(text()).toContain(
      `非听力题至少 ${{1: 20, 2: 40, 3: 65}[level]}% 升档`,
    );
    expect(text()).toContain(getChallengePolicy('math', level).summary);
    expect(text()).not.toContain('deepDirections');
    expect(text()).not.toContain('25组分项');
    expect(button('升档').props.disabled).toBe(false);
  },
);

test('不足最低覆盖比例时说明题数并禁用升档，可降低档次', async () => {
  const questions = Array.from({length: 5}, (_, index) => ({
    ...analysis.questions[0],
    id: `q${index + 1}`,
    number: String(index + 1),
    ...(index
      ? {
          analysisIssues: ['分析尚待核实'],
          upgradeEligibility: 'retain' as const,
          retentionReason: '分析不够可靠',
        }
      : {}),
  }));
  await openSaved({...analyzed, analysis: {...analysis, questions}});
  expect(text()).toContain('分析待核：4 题');
  await press('升档方案');
  expect(text()).toContain('至少升档 1 题');
  expect(button('升档').props.disabled).toBe(false);
  await press('升 2 档');
  expect(text()).toContain('至少升档 2 题');
  expect(button('升档').props.disabled).toBe(true);
  expect(text()).toContain('可升档题数不足');
});

test('听力不计入比例分母，单题分析待核可保留但印刷缺失仍阻断', async () => {
  const questions = [
    analysis.questions[0],
    {...analysis.questions[0], id: 'audio', number: '2', isListening: true},
  ];
  await openSaved({
    ...analyzed,
    analysis: {...analysis, questions, unresolvedIssues: ['第1题印刷条件缺失']},
  });
  expect(text()).toContain('第1题印刷条件缺失');
  await press('升档方案');
  expect(text()).toContain('本卷 1 道非听力小题');
  expect(button('升档').props.disabled).toBe(true);
});

test('识科核验展示初抽与追加票数，完整题池和依赖内容不混入用户页卡', async () => {
  const verification: SubjectVerification = {
    mode: 'progressive',
    candidateOrder: ['q1', 'q2', 'q3', 'q4'],
    titleEvidence: [],
    samples: ['q1', 'q2', 'q3', 'q4'].map((id, index) => ({
      majorQuestionId: 'm1',
      majorQuestionTitle: '选择题',
      candidateQuestionIds: ['q1', 'q2', 'q3', 'q4'],
      selectedQuestionId: id,
      selectedQuestionNumber: String(index + 1),
      sourceRefs: [{pageIndex: 0, quote: '原题'}],
    })),
    votes: ['math', 'math', 'english', 'math'].map((subject, index) => ({
      questionId: `q${index + 1}`,
      subject: subject as 'math' | 'english',
      courseName: subject === 'math' ? '数学' : '英语',
      integrated: false,
      reason: '依据原题实际任务',
      evidence: [{pageIndex: 0, quote: '原题'}],
    })),
  };
  await openSaved({...analyzed, subjectVerification: verification});
  expect(text()).toContain('先抽3题');
  expect(text()).toContain('已抽 4 题');
  expect(text()).toContain('数学 3票');
  expect(text()).toContain('英语 1票');
  expect(text()).not.toContain('candidateOrder');
});

test('生成完成后在方案页列出升档题号、调整思路与保留原因，切换档次不改写历史结果', async () => {
  const questions = Array.from({length: 5}, (_, index) => ({
    ...analysis.questions[0],
    id: `q${index + 1}`,
    number: String(index + 1),
  }));
  const paper = {
    ...candidate,
    level: 2 as const,
    questions: questions.map((question, index) => ({
      ...question,
      upgrade: {
        ...candidate.questions[0].upgrade,
        level: 2 as const,
        mode: index < 2 ? ('upgraded' as const) : ('retained' as const),
        changes: index < 2 ? ['由直接计算改为反推条件'] : [],
        retentionReason: index < 2 ? undefined : '原题范围窄，维持原题',
      },
    })),
  };
  const value = {
    ...completed,
    level: 2 as const,
    analysis: {...analysis, questions},
    candidate: paper,
    reviewRounds: completed.reviewRounds.map(round => ({
      ...round,
      reviews: round.reviews.map(review => ({
        ...review,
        checkedQuestionIds: questions.map(question => question.id),
      })),
    })),
  };
  await openSaved(value);
  await press('升档方案');
  expect(text()).toContain('已升档 2 / 5 道非听力题（40.0%）');
  expect(text()).toContain('第 1 题 · 已升档');
  expect(text()).toContain('第 3 题 · 保留原题');
  expect(text()).toContain('由直接计算改为反推条件');
  expect(text()).toContain('原题范围窄，维持原题');
  await press('升 3 档');
  expect(text()).toContain('至少升档 4 题');
  expect(text()).toContain('本次生成结果 · 升 2 档');
});

test.each([0, 3, 5] as const)(
  '生成后沿保存的%d角色校核设置显示进度，修订意见不泄露答案',
  async size => {
    const value = roundtableRecord(size);
    value.reviewRounds[0].reviews[0].summary = '答案内容不得出现在方案页';
    await openSaved(value, 5);
    await press('升档方案');
    expect(text()).toContain('生成校核');
    expect(text()).toContain(size ? `${size} 角色圆桌评审` : '基础综合校核');
    expect(text()).not.toContain('答案内容不得出现在方案页');
  },
);

test('试卷、答案PDF各在自己的页卡预览下载，预览故障可以重试', async () => {
  await openSaved(completed);
  await press('试卷预览');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe('file:///paper.pdf');
  act(() => view!.root.findByType(Pdf).props.onError('PDF暂不可读'));
  expect(text()).toContain('PDF暂不可读');
  await press('重新打开 PDF');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
  await press('下载试卷');
  expect(saveChallengePdf).toHaveBeenLastCalledWith(
    'file:///paper.pdf',
    expect.stringContaining('试卷.pdf'),
  );
  await press('答案预览');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    'file:///answers.pdf',
  );
  await press('下载答案');
  expect(saveChallengePdf).toHaveBeenLastCalledWith(
    'file:///answers.pdf',
    expect.stringContaining('答案.pdf'),
  );
});

test('PDF保存取消不报成功，失败后仍可预览且可以重试', async () => {
  await openSaved(completed);
  await press('答案预览');
  (saveChallengePdf as jest.Mock).mockResolvedValueOnce(false);
  await press('下载答案');
  expect(text()).not.toContain('PDF 已保存');
  (saveChallengePdf as jest.Mock).mockRejectedValueOnce(
    new Error('目标目录不可写'),
  );
  await press('下载答案');
  expect(text()).toContain('目标目录不可写');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
  await press('下载答案');
  expect(text()).toContain('答案 PDF 已保存');
});

test('切换到答案页后忽略旧试卷预览的迟到错误，未通过的候选不显示PDF', async () => {
  await openSaved(completed);
  await press('试卷预览');
  const oldError = view!.root.findByType(Pdf).props.onError;
  await press('答案预览');
  act(() => oldError('旧预览错误'));
  expect(text()).not.toContain('旧预览错误');
  act(() => view!.unmount());
  view = undefined;
  await openSaved({...completed, candidateRevision: 2});
  await press('试卷预览');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
});

test('消耗详情是单独页卡，首次模型请求后出现，运行中持续更新', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  await press('解析试卷');
  await settle();
  expect(button('消耗详情')).toBeUndefined();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  const first = modelCall();
  act(() =>
    options.onUpdate({
      ...base,
      status: 'analyzing',
      calls: [{stage: 'analysis', call: first}],
    }),
  );
  await press('消耗详情');
  expect(text()).toContain('总体消耗');
  expect(text()).toContain('进行中 1 次');
  expect(text()).not.toContain('难度分布');
  await press('展开逐次调用');
  expect(text()).toContain('test-model');
  const calls: ChallengeRecord['calls'] = [
    {
      stage: 'analysis',
      call: {
        ...first,
        status: 'completed',
        ...parseUsage({input_tokens: 100, output_tokens: 20}),
      },
    },
    {stage: 'analysis', call: modelCall({id: 'retry', status: 'failed'})},
  ];
  act(() => options.onUpdate({...base, status: 'analyzing', calls}));
  expect(text()).toContain('合计：120（另 1 次未返回）');
  expect(text()).toContain('请求失败');
  await press('升档方案');
  expect(options.signal.aborted).toBe(false);
  await act(async () => pending.resolve({...analyzed, calls}));
  await press('消耗详情');
  expect(text()).toContain('实际调用 2 次');
});

test('重复点击只启动一个任务，返回首页、卸载与重进仍可恢复进度和主动停止', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  act(() => {
    button('解析试卷').props.onPress();
    button('解析试卷').props.onPress();
  });
  await settle();
  expect(createChallenge).toHaveBeenCalledTimes(1);
  expect(analyzeChallenge).toHaveBeenCalledTimes(1);
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  await press('‹ 返回首页');
  expect(back).toHaveBeenCalledTimes(1);
  act(() => view!.unmount());
  view = undefined;
  expect(options.signal.aborted).toBe(false);
  expect(getChallengeTask(base.id)).toBeDefined();
  options.onUpdate({
    ...base,
    status: 'analyzing',
    progress: '后台正在核验样题',
  });
  (getChallenge as jest.Mock).mockResolvedValueOnce(base);
  await render(base.id);
  expect(text()).toContain('后台正在核验样题');
  await press('停止处理');
  expect(options.signal.aborted).toBe(true);
  await act(async () => pending.resolve({...analyzed, status: 'cancelled'}));
  expect(button('重新解析').props.disabled).toBe(false);
});

test('升档期间可进入设置与切换页卡，不会中断请求', async () => {
  const pending = deferred<ChallengeRecord>();
  (upgradeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await openSaved();
  await press('升档方案');
  await press('升档');
  await settle();
  const options = (upgradeChallenge as jest.Mock).mock.calls[0][2];
  await press('试卷分析');
  await press('模型设置');
  expect(modelSettings).toHaveBeenCalledTimes(1);
  act(() => view!.unmount());
  view = undefined;
  expect(options.signal.aborted).toBe(false);
  await act(async () => pending.resolve(completed));
  (getChallenge as jest.Mock).mockResolvedValueOnce(completed);
  await render(completed.id);
  expect(view!.root.findByType(Pdf).props.source.uri).toBe('file:///paper.pdf');
});

test('保存原卷期间离开，导入完成后继续已请求的解析', async () => {
  const copying = deferred<ChallengeRecord>();
  (createChallenge as jest.Mock).mockReturnValueOnce(copying.promise);
  await render();
  await uploadPhoto();
  await press('解析试卷');
  await press('‹ 返回首页');
  act(() => view!.unmount());
  view = undefined;
  await act(async () => copying.resolve(base));
  expect(analyzeChallenge).toHaveBeenCalledTimes(1);
  expect((analyzeChallenge as jest.Mock).mock.calls[0][1].signal.aborted).toBe(
    false,
  );
});

test('切换另一份记录后，后台旧任务的进度与完成结果不覆盖当前试卷', async () => {
  const other = {...base, id: 'challenge_other', title: '另一份试卷'};
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  (listChallenges as jest.Mock).mockResolvedValue([analyzed, other]);
  (getChallenge as jest.Mock).mockImplementation(async id =>
    id === other.id ? other : analyzed,
  );
  await render(analyzed.id);
  await press('重新解析');
  await settle();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  await press('原卷');
  await press(`打开${other.title}`);
  act(() => options.onUpdate({...analyzed, progress: '旧任务的后续进度'}));
  expect(text()).not.toContain('旧任务的后续进度');
  expect(options.signal.aborted).toBe(false);
  await act(async () => pending.resolve(analyzed));
  expect(selection).toHaveBeenLastCalledWith(other.id);
});

test('进入模型设置前保存未解析输入，返回可恢复原卷', async () => {
  await render();
  await uploadPhoto();
  await press('模型设置');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith([source]);
  expect(selection).toHaveBeenCalledWith(base.id);
  expect(modelSettings).toHaveBeenCalledTimes(1);
});

test('最近列表没有删除入口，管理页确认后批量删除并停止对应任务', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  (listChallenges as jest.Mock).mockResolvedValue([analyzed]);
  await openSaved();
  await press('原卷');
  expect(button(`删除${analyzed.title}`)).toBeUndefined();
  await press('重新解析');
  await settle();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  await press('管理');
  selectRecord(analyzed.title);
  await press('删除已选（1）');
  expect(deleteChallenge).not.toHaveBeenCalled();
  expect(options.signal.aborted).toBe(false);
  (listChallenges as jest.Mock).mockResolvedValue([]);
  const confirm = (Alert.alert as jest.Mock).mock.calls
    .slice(-1)[0][2]
    .find((item: {text: string}) => item.text === '删除').onPress;
  await act(async () => confirm());
  expect(deleteChallenge).toHaveBeenCalledWith(analyzed.id);
  expect(options.signal.aborted).toBe(true);
  await press('‹ 返回挑战');
  act(() => options.onUpdate(analyzed));
  await act(async () => pending.resolve(analyzed));
  expect(text()).toContain('上传一份试卷');
});

test('补充页面保护原记录，管理页旧确认回调不会破坏当前草稿', async () => {
  await openSaved();
  await press('管理');
  selectRecord(analyzed.title);
  await press('删除已选（1）');
  const stale = (Alert.alert as jest.Mock).mock.calls
    .slice(-1)[0][2]
    .find((item: {text: string}) => item.text === '删除').onPress;
  await press('‹ 返回挑战');
  await press('补充页面');
  await press('管理');
  expect(
    view!.root
      .findAllByType(Pressable)
      .find(node => node.props.accessibilityLabel === `选择${analyzed.title}`)!
      .props.disabled,
  ).toBe(true);
  await act(async () => stale());
  expect(deleteChallenge).not.toHaveBeenCalled();
  await press('‹ 返回挑战');
  expect(button('解析试卷').props.disabled).toBe(false);
});

test('记录读取失败可重试，恢复原记录的迟到结果不能覆盖新导入输入', async () => {
  const restoring = deferred<ChallengeRecord>();
  (getChallenge as jest.Mock).mockReturnValueOnce(restoring.promise);
  (listChallenges as jest.Mock).mockRejectedValueOnce(
    new Error('数据库暂时不可用'),
  );
  await render('challenge_previous');
  expect(text()).toContain('数据库暂时不可用');
  await press('重新读取记录');
  expect(text()).not.toContain('数据库暂时不可用');
  await uploadPhoto();
  await act(async () => restoring.resolve(analyzed));
  expect(button('解析试卷').props.disabled).toBe(false);
  expect(text()).toContain(source.name);
});
