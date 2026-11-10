import React from 'react';
import {Alert, PermissionsAndroid, Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import Pdf from 'react-native-pdf';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import ChallengeScreen from '../src/components/ChallengeScreen';
import {DEFAULT_SETTINGS} from '../src/settings';
import * as challengeRules from '../src/challenge/rules';
import {
  CHALLENGE_RULES,
  CHALLENGE_POLICY_VERSION,
  applicableMasteryChallenges,
  getChallengePolicy,
} from '../src/challenge/rules';
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
} from '../src/challenge/store';
import {analyzeChallenge, upgradeChallenge} from '../src/challenge/pipeline';
import {
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  challengeReviewRoleLabel,
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
jest.mock(
  '../src/challenge/pipeline',
  () => ({analyzeChallenge: jest.fn(), upgradeChallenge: jest.fn()}),
  {virtual: true},
);
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

const text = () => JSON.stringify(view!.toJSON());
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

test('取消照片或PDF导入不创建挑战，解析与升档在原卷缺失时禁用', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({didCancel: true});
  await render();
  expect(button('解析试卷').props.disabled).toBe(true);
  expect(button('升档').props.disabled).toBe(true);
  await press('上传照片');
  await press('上传 PDF');
  expect(createChallenge).not.toHaveBeenCalled();
  expect(analyzeChallenge).not.toHaveBeenCalled();
  expect(text()).toContain('已选');
});

test('未识科不预载默认数学；主动参考单科标准也不能替代本卷识科', async () => {
  const load = jest.spyOn(challengeRules, 'loadChallengeSubjectRules');
  await render();
  expect(load).not.toHaveBeenCalled();
  await press('查看各科三档提升标准');
  expect(load).not.toHaveBeenCalled();
  await press('英语');
  expect(load).toHaveBeenCalledWith('english');
  expect(load.mock.calls.every(([subject]) => subject === 'english')).toBe(
    true,
  );
  expect(text()).toContain('正在参考所选科目的标准');
  expect(text()).not.toContain('已加载对应科目标准');
  expect(button('升档').props.disabled).toBe(true);
});

test('独立识科加载单科后核实整卷，分析一致前不展示完整标准或允许升档', async () => {
  const load = jest.spyOn(challengeRules, 'loadChallengeSubjectRules');
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  await press('解析试卷');
  await settle();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  act(() =>
    options.onUpdate({
      ...base,
      status: 'analyzing',
      subjectIdentification: mathIdentification,
      loadedSubjectRules: {
        subject: 'math',
        policyVersion: CHALLENGE_POLICY_VERSION,
      },
    }),
  );
  expect(load).not.toHaveBeenCalled();
  expect(text()).toContain('已加载对应科目标准');
  expect(text()).toContain('正在核实整卷');
  expect(button('升档').props.disabled).toBe(true);
  await act(async () => pending.resolve(analyzed));
  expect(load).toHaveBeenCalledWith('math');
  expect(text()).toContain('已加载对应科目标准');
  expect(button('升档').props.disabled).toBe(false);
});

test('展示标题识科与每大题抽中题号，原页依据只随记录保存', async () => {
  const verification: SubjectVerification = {
    mode: 'title_sample',
    titleEvidence: [{pageIndex: 0, quote: '仅存档的原卷标题证据'}],
    samples: [
      {
        majorQuestionId: 'major_1',
        majorQuestionTitle: '一、选择题',
        candidateQuestionIds: ['candidate_hidden_1', 'selected_1'],
        selectedQuestionId: 'selected_1',
        selectedQuestionNumber: '4',
        sourceRefs: [{pageIndex: 0, quote: '仅存档的抽样原页证据'}],
      },
      {
        majorQuestionId: 'major_2',
        majorQuestionTitle: '二、解答题',
        candidateQuestionIds: ['selected_2'],
        selectedQuestionId: 'selected_2',
        selectedQuestionNumber: '12（2）',
        sourceRefs: [{pageIndex: 1, quote: '另一大题的原页依据'}],
      },
    ],
  };
  await openSaved({...analyzed, subjectVerification: verification});
  const visibleText = view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join('\n');
  expect(visibleText).toContain('标题识科，每大题随机1题佐证');
  expect(visibleText).toContain('一、选择题 · 题号 4');
  expect(visibleText).toContain('二、解答题 · 题号 12（2）');
  expect(visibleText).not.toContain('candidate_hidden_1');
  expect(visibleText).not.toContain('仅存档的原卷标题证据');
  expect(visibleText).not.toContain('仅存档的抽样原页证据');
});

test('扩大核验展示实际原因，并可从保存的科目票据恢复识科方式', async () => {
  const verification: SubjectVerification = {
    mode: 'expanded',
    titleEvidence: [],
    samples: [],
    expansionReason: '原卷标题缺失，需要结合整卷题目确认。',
  };
  const identification = {...mathIdentification, verification};
  await openSaved({
    ...analyzed,
    subjectIdentification: identification,
    analysis: {...analysis, subjectIdentification: identification},
  });
  expect(text()).toContain('扩大核验：原卷标题缺失，需要结合整卷题目确认。');
  expect(text()).not.toContain('本轮抽中的题目');
  expect(text()).not.toContain('标题识科，每大题随机1题佐证');
  expect(button('升档').props.disabled).toBe(false);
});

test.each([
  {
    label: '旧解析没有科目确认',
    value: {
      ...completed,
      subjectIdentification: undefined,
      analysis: {...analysis, subjectIdentification: undefined},
    },
  },
  {
    label: '混合多科',
    value: {
      ...base,
      status: 'failed' as const,
      error: '识别到数学和英语混合，请上传完整的单科试卷。',
    },
  },
  {
    label: '科目确认与整卷不一致',
    value: {
      ...analyzed,
      subjectIdentification: {
        ...mathIdentification,
        subject: 'english' as const,
        courseName: '英语',
      },
    },
  },
])('$label时禁止升档且不默认套其它科，旧PDF保留', async ({value}) => {
  const load = jest.spyOn(challengeRules, 'loadChallengeSubjectRules');
  await openSaved(value);
  expect(load).not.toHaveBeenCalled();
  expect(button('升档').props.disabled).toBe(true);
  if ('paperPdfUri' in value && value.paperPdfUri) {
    expect(view!.root.findByType(Pdf).props.source.uri).toBe(value.paperPdfUri);
  }
  expect(upgradeChallenge).not.toHaveBeenCalled();
});

test('图片与PDF按用户顺序混合导入，渲染页完整交给解析并清理临时PDF', async () => {
  await render();
  await uploadPhoto();
  (pickChallengePdf as jest.Mock).mockResolvedValueOnce(pdfSource);
  await press('上传 PDF');
  await press('第2项上移');
  await press('解析试卷');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith([pdfSource, source]);
  expect(discardChallengePdf).toHaveBeenCalledWith(pdfSource);
  expect(analyzeChallenge).toHaveBeenCalledWith(
    base.id,
    expect.objectContaining({
      settings,
      signal: expect.any(Object),
      onUpdate: expect.any(Function),
    }),
  );
  expect(text()).toContain('原卷解析');
  expect(text()).toContain('整数运算');
  expect(text()).toContain('难度预估');
  expect(selection).toHaveBeenCalledWith(base.id);
  expect(button('升档').props.disabled).toBe(false);
});

test('移除尚未入库PDF只清理其临时副本，不启动解析', async () => {
  (pickChallengePdf as jest.Mock).mockResolvedValueOnce(pdfSource);
  await render();
  await press('上传 PDF');
  await press('移除第1项');
  expect(discardChallengePdf).toHaveBeenCalledWith(pdfSource);
  expect(button('解析试卷').props.disabled).toBe(true);
  expect(createChallenge).not.toHaveBeenCalled();
});

test('拍摄可多次添加试卷页，未点击解析前不发起模型请求', async () => {
  (launchCamera as jest.Mock)
    .mockResolvedValueOnce({assets: [{uri: 'file:///camera1.jpg'}]})
    .mockResolvedValueOnce({assets: [{uri: 'file:///camera2.jpg'}]});
  await render();
  await press('拍照');
  await press('拍照');
  expect(launchCamera).toHaveBeenCalledTimes(2);
  expect(analyzeChallenge).not.toHaveBeenCalled();
  await press('解析试卷');
  expect(
    (createChallenge as jest.Mock).mock.calls[0][0].map(
      (item: ChallengeSource) => item.uri,
    ),
  ).toEqual(['file:///camera1.jpg', 'file:///camera2.jpg']);
});

test('关闭圆桌时保留一次基础综合校核，完成后可输出双PDF', async () => {
  (upgradeChallenge as jest.Mock).mockResolvedValueOnce(roundtableRecord(0));
  await openSaved();
  await press('升 3 档');
  await press('升档');
  await settle();
  expect(upgradeChallenge).toHaveBeenCalledWith(
    analyzed.id,
    3,
    expect.objectContaining({settings}),
  );
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    completed.paperPdfUri,
  );
  expect(text()).toContain('生成校核');
  expect(screenText()).toContain('本次采用：0 · 基础综合校核（1 个角色）');
  expect(screenText()).toContain('基础综合校核：通过');
  expect(button('下载试卷').props.disabled).toBe(false);
});

test('三角色逐项显示已完成和待完成，所有报告通过前不显示PDF', async () => {
  const finished = roundtableRecord(3);
  const firstRound = finished.reviewRounds[0];
  const partial: ChallengeRecord = {
    ...finished,
    reviewRounds: [{...firstRound, reviews: firstRound.reviews.slice(0, 1)}],
  };
  await openSaved(partial, 3);
  expect(screenText()).toContain('本次采用：3 角色圆桌评审');
  expect(screenText()).toContain('已完成 1 / 3 个角色');
  expect(screenText()).toContain(
    `${challengeReviewRoleLabel('difficulty', 3)}：待完成`,
  );
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  const pending = deferred<ChallengeRecord>();
  (upgradeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await press('升档');
  const options = (upgradeChallenge as jest.Mock).mock.calls[0][2];
  act(() =>
    options.onUpdate({
      ...partial,
      status: 'reviewing',
      reviewRounds: [{...firstRound, reviews: firstRound.reviews.slice(0, 2)}],
    }),
  );
  expect(screenText()).toContain('已完成 2 / 3 个角色');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  await act(async () => pending.resolve(finished));
  expect(screenText()).toContain('本轮全部通过');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
});

test('五角色提出异议后整轮重审，不沿用上一轮通过，修订明细仍放答案侧', async () => {
  const finished = roundtableRecord(5);
  const round = finished.reviewRounds[0];
  const privateFix = '答案侧才显示的具体修复：重新计算该题结果';
  const firstRound = {
    ...round,
    reviews: round.reviews.map(report =>
      report.role === 'scope'
        ? {
            ...report,
            verdict: 'revise' as const,
            issues: [
              {
                questionId: 'q1',
                code: 'scope',
                comment: '需修订',
                fix: privateFix,
              },
            ],
          }
        : report,
    ),
  };
  const secondRound = {...round, round: 2, candidateRevision: 2};
  const partial: ChallengeRecord = {
    ...finished,
    status: 'reviewing',
    candidateRevision: 2,
    reviewRounds: [
      firstRound,
      {...secondRound, reviews: secondRound.reviews.slice(0, 1)},
    ],
  };
  await openSaved(partial, 5);
  expect(screenText()).toContain('已完成 1 / 5 个角色');
  expect(screenText()).toContain('修复后开启下一轮，本轮所有角色都会重新评审');
  expect(screenText()).toContain(
    `${challengeReviewRoleLabel('answers', 5)}：待完成`,
  );
  expect(text()).not.toContain(privateFix);
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  (upgradeChallenge as jest.Mock).mockResolvedValueOnce({
    ...partial,
    status: 'completed',
    reviewRounds: [firstRound, secondRound],
  });
  await press('升档');
  expect(screenText()).toContain('本轮全部通过');
  expect(text()).not.toContain(privateFix);
  await press('答案 PDF');
  expect(text()).toContain(privateFix);
});

test('当前设置只用于下次生成，旧卷继续按已保存圆桌人数显示', async () => {
  await openSaved(roundtableRecord(3), 5);
  expect(screenText()).toContain('本次采用：3 角色圆桌评审');
  expect(screenText()).toContain('下一次生成评审：5 角色圆桌评审');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
  (upgradeChallenge as jest.Mock).mockResolvedValueOnce(roundtableRecord(5));
  await press('升档');
  expect(upgradeChallenge).toHaveBeenCalledWith(
    analyzed.id,
    1,
    expect.objectContaining({
      settings: expect.objectContaining({roundtableSize: 5}),
    }),
  );
  expect(screenText()).toContain('本次采用：5 角色圆桌评审');
});

test('旧单报告历史不按当前五角色设置追补，PDF照常浏览', async () => {
  await openSaved(completed, 5);
  expect(screenText()).toContain('本次采用：历史评审（人数未记录）');
  expect(screenText()).toContain('已记录 1 份报告');
  expect(screenText()).not.toContain('已完成 1 / 5 个角色');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    completed.paperPdfUri,
  );
});

test.each(['reviewProtocolVersion', 'reviewRoundtableSize'] as const)(
  '新圆桌快照缺少%s时不显示已通过PDF',
  async missingField => {
    await openSaved({...roundtableRecord(3), [missingField]: undefined}, 3);
    expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
    expect(screenText()).toContain('评审记录尚未完整');
  },
);

test('三档标准展示思维方向、实际联系和必要性说明，不只显示步骤计数', async () => {
  await render();
  await press('查看各科三档提升标准');
  await press('英语');
  await press('升 3 档');
  const policy = getChallengePolicy('english', 3);
  const visibleText = view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join('\n');
  expect(visibleText).toContain('思维深度要求');
  expect(visibleText).toContain('至少采用 3 个适用思路');
  expect(visibleText).toContain('至少形成 2 处有效联系');
  expect(visibleText).toContain('这些思路在新题解法中起什么关键作用');
  expect(visibleText).toContain(policy.deepDirections[0].name);
  expect(visibleText).toContain(policy.deepDirections[0].description);
  expect(visibleText).toContain(
    `当前使用深度与掌握训练标准 v${CHALLENGE_RULES.version}`,
  );
});

test('对应学科展示本档质性提升、范围与题型设计，验收指向训练题和讲解', async () => {
  await openSaved();
  const blueprint = getChallengePolicy('math', 1).subjectBlueprint;
  expect(text()).toContain(
    blueprint.difficultyProgression[0].qualityTargets[0],
  );
  await press('升 3 档');
  expect(text()).toContain(
    blueprint.difficultyProgression[2].qualityTargets[0],
  );
  await press('查看各科三档提升标准');
  expect(text()).toContain('训练题与答案讲解的验收要求');
  expect(text()).toContain(blueprint.masteryAcceptance[0]);
  expect(text()).toContain(blueprint.scopeExclusions[0]);
  expect(text()).toContain(blueprint.questionTypeGuidance[0].design);
});

test('每个原核心安排五维训练，三档配额按每题合计展示', async () => {
  await openSaved();
  const allText = () =>
    view!.root
      .findAllByType(Text)
      .map(node => [node.props.children].flat().join(''))
      .join('\n');
  expect(allText()).toContain('每个原题核心知识点都安排以下五维训练');
  for (const dimension of CHALLENGE_RULES.masteryFramework.dimensions) {
    expect(allText()).toContain(dimension.name);
  }
  expect(allText()).toContain(
    '每题合计至少辨析 1 类不同易错点、建立 1 处同核迁移联系，并安排 1 种有效自检',
  );
  await press('升 2 档');
  expect(allText()).toContain(
    '每题合计至少辨析 2 类不同易错点、建立 1 处同核迁移联系，并安排 2 种有效自检',
  );
  await press('升 3 档');
  expect(allText()).toContain(
    '每题合计至少辨析 3 类不同易错点、建立 2 处同核迁移联系，并安排 3 种有效自检',
  );
  expect(allText()).toContain(CHALLENGE_RULES.masteryFramework.claimBoundary);
  for (const intent of Object.values(
    CHALLENGE_RULES.masteryFramework.tierIntent[3],
  )) {
    expect(allText()).toContain(intent);
  }
});

test('按原知识点筛出候选目录名称，不把全科目录当成本卷覆盖，也不提前给出错解', async () => {
  const catalog = getChallengePolicy('math', 1).masteryChallenges;
  const selected = catalog.find(
    item => item.appliesTo === 'non_listening' && !item.taskCondition,
  )!;
  const knowledgePoint = selected.knowledgeKeywords[0];
  const originalQuestion = {
    ...analysis.questions[0],
    knowledgePoints: [knowledgePoint],
  };
  const matched = applicableMasteryChallenges(
    'math',
    1,
    originalQuestion,
    analysis.materials,
    knowledgePoint,
    analysis.educationLevel,
  );
  expect(matched.some(item => item.id === selected.id)).toBe(true);
  const unmatched = catalog.find(
    item => !matched.some(result => result.id === item.id),
  )!;
  await openSaved({
    ...analyzed,
    analysis: {
      ...analysis,
      knowledgePoints: [knowledgePoint],
      questions: [originalQuestion],
    },
  });
  expect(text()).toContain('按原知识点匹配的易错与难点目录');
  expect(text()).toContain(selected.name);
  expect(text()).not.toContain(unmatched.name);
  expect(text()).not.toContain(selected.misconception);
  expect(text()).not.toContain(selected.diagnosticContrast);
  expect(text()).toContain('不表示你已经出现这些错误或已经掌握');
});

test.each(['middle', 'unknown', 'high'] as const)(
  '学段为%s时只显示实际允许匹配的高中专属目录',
  async educationLevel => {
    const highOnly = getChallengePolicy('math', 1).masteryChallenges.find(
      item =>
        item.educationLevels?.length === 1 &&
        item.educationLevels[0] === 'high',
    )!;
    const knowledgePoint = highOnly.knowledgeKeywords[0];
    await openSaved({
      ...analyzed,
      analysis: {
        ...analysis,
        educationLevel,
        knowledgePoints: [knowledgePoint],
        questions: [
          {...analysis.questions[0], knowledgePoints: [knowledgePoint]},
        ],
      },
    });
    if (educationLevel === 'high') {
      expect(text()).toContain(highOnly.name);
    } else {
      expect(text()).not.toContain(highOnly.name);
    }
  },
);

test.each([1, 2])(
  '历史v%d标准的PDF继续浏览，不被标成当前掌握训练标准',
  async version => {
    await openSaved({
      ...completed,
      policyVersion: `exam-challenge-within-scope-v${version}:${version}`,
    });
    expect(text()).toContain('此卷按旧版标准生成');
    expect(text()).toContain(`历史标准 v${version}`);
    expect(view!.root.findByType(Pdf).props.source.uri).toBe(
      'file:///paper.pdf',
    );
    expect(upgradeChallenge).not.toHaveBeenCalled();
    expect(deleteChallenge).not.toHaveBeenCalled();
    act(() => view!.unmount());
    view = undefined;
    await openSaved({...completed, policyVersion: CHALLENGE_POLICY_VERSION});
    expect(text()).not.toContain('此卷按旧版标准生成');
  },
);

test('数学高档允许单策略深挖，不把组合方法数量当成唯一路线', async () => {
  await openSaved();
  await press('升 2 档');
  let visibleText = view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join('\n');
  expect(visibleText).toContain('可选路线一：组合深化');
  expect(visibleText).toContain('可选路线二：单策略深挖');
  expect(visibleText).toContain('至少完成 2 个关键决策和 1 项实际边界检查');
  expect(visibleText).toContain('两条路线任选其一');
  await press('升 3 档');
  visibleText = view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''))
    .join('\n');
  expect(visibleText).toContain('至少完成 3 个关键决策和 2 项实际边界检查');
});

test('答案侧逐题展示深化方向与原新要求，试卷侧不提前展示解法说明', async () => {
  const direction = getChallengePolicy('math', 1).deepDirections[0];
  await openSaved({
    ...completed,
    policyVersion: CHALLENGE_POLICY_VERSION,
    candidate: {
      ...candidate,
      questions: [
        {
          ...candidate.questions[0],
          upgrade: {
            ...candidate.questions[0].upgrade,
            directionEvidence: [
              {
                directionId: direction.id,
                originalDemand: '原题已直接给出运算关系。',
                newDemand: '新题需要由目标反推缺失条件。',
                problemQuote: '题干定位文字',
                solutionQuote: '答案中需要保留到答案PDF的具体解法',
                necessity: '答案中详细解释必要性',
              },
            ],
          },
        },
      ],
    },
  });
  await press('查看逐题分析');
  expect(text()).not.toContain('原题已直接给出运算关系');
  expect(text()).not.toContain('新题需要由目标反推缺失条件');
  await press('答案 PDF');
  expect(text()).toContain(direction.name);
  expect(text()).toContain('原题已直接给出运算关系');
  expect(text()).toContain('新题需要由目标反推缺失条件');
  expect(text()).not.toContain('答案中需要保留到答案PDF的具体解法');
  expect(text()).not.toContain('答案中详细解释必要性');
});

test('生成校核通过只说明试卷达标，具体修订内容仅在答案侧显示', async () => {
  const privateSummary = '校核修正为选B，另一选项不符合条件';
  const privateFix = '将第1题结果修订为9并补上步骤';
  await openSaved({
    ...completed,
    reviewRounds: [
      {
        ...completed.reviewRounds[0],
        reviews: [
          {
            ...completed.reviewRounds[0].reviews[0],
            verdict: 'revise',
            issues: [
              {
                questionId: 'q1',
                code: 'answer_consistency',
                comment: '原解答结果有误',
                fix: privateFix,
              },
            ],
          },
        ],
      },
      {
        ...completed.reviewRounds[0],
        round: 2,
        reviews: [
          {
            ...completed.reviewRounds[0].reviews[0],
            summary: privateSummary,
          },
        ],
      },
    ],
  });
  expect(text()).toContain('个人掌握情况需结合后续作答与订正判断');
  expect(text()).not.toContain(privateSummary);
  expect(text()).not.toContain(privateFix);
  expect(text()).toContain(CHALLENGE_RULES.masteryFramework.claimBoundary);
  await press('答案 PDF');
  expect(text()).toContain(privateSummary);
  expect(text()).toContain(privateFix);
  await press('试卷 PDF');
  expect(text()).not.toContain(privateSummary);
  expect(text()).not.toContain(privateFix);
});

test('解析仍有缺页或无法识别的问题时显示补充提示且禁止升档', async () => {
  await openSaved({
    ...analyzed,
    analysis: {
      ...analysis,
      unresolvedIssues: ['第2题条件缺失，请补拍右半页。'],
    },
  });
  expect(button('升档').props.disabled).toBe(true);
  expect(text()).toContain('第2题条件缺失');
  await press('补充页面');
  expect(button('解析试卷').props.disabled).toBe(false);
  expect(text()).toContain('原卷已放回待解析列表');
});

test('不是试卷或解析失败时不假成功，重新解析复用已持久化原卷', async () => {
  (analyzeChallenge as jest.Mock).mockRejectedValueOnce(
    new Error('上传内容不是试卷，请重新选择。'),
  );
  await render();
  await uploadPhoto();
  await press('解析试卷');
  await settle();
  expect(text()).toContain('上传内容不是试卷');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  await press('重新解析');
  await settle();
  expect(createChallenge).toHaveBeenCalledTimes(1);
  expect(analyzeChallenge).toHaveBeenCalledTimes(2);
});

test('重复点击解析只创建一次，离页中止请求，迟到结果不更新已卸载页面', async () => {
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
  expect(options.signal.aborted).toBe(true);
  expect(back).toHaveBeenCalledTimes(1);
  act(() => view!.unmount());
  view = undefined;
  await act(async () => {
    pending.resolve(analyzed);
  });
});

test('停止处理保留原卷与记录，可以重试而不重新导入', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  await press('解析试卷');
  await settle();
  await press('停止处理');
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  expect(options.signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve({...base, status: 'cancelled', progress: '已停止'}),
  );
  expect(button('重新解析').props.disabled).toBe(false);
  expect(createChallenge).toHaveBeenCalledTimes(1);
});

test('试卷和答案分开预览下载，取消保存不报成功，保存失败仍可预览和重试', async () => {
  await openSaved(completed);
  expect(view!.root.findByType(Pdf).props.source.uri).toBe('file:///paper.pdf');
  (saveChallengePdf as jest.Mock).mockResolvedValueOnce(false);
  await press('下载试卷');
  expect(text()).not.toContain('PDF 已保存');
  (saveChallengePdf as jest.Mock).mockRejectedValueOnce(
    new Error('目标目录不可写'),
  );
  await press('下载答案');
  expect(text()).toContain('目标目录不可写');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
  await press('答案 PDF');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    'file:///answers.pdf',
  );
  await press('下载答案');
  expect(saveChallengePdf).toHaveBeenLastCalledWith(
    'file:///answers.pdf',
    expect.stringContaining('答案.pdf'),
  );
  expect(text()).toContain('答案 PDF 已保存');
});

test('PDF预览故障可重新打开；候选与校核版本不一致时不暴露旧PDF', async () => {
  await openSaved(completed);
  act(() => view!.root.findByType(Pdf).props.onError('文件暂时无法读取'));
  expect(text()).toContain('文件暂时无法读取');
  await press('重新打开 PDF');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(1);
  act(() => view!.unmount());
  view = undefined;
  await openSaved({...completed, candidateRevision: 2});
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
});

test('进入模型设置前保存待解析输入，返回时可恢复选中的已保存挑战', async () => {
  await render();
  await uploadPhoto();
  await press('模型设置');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith([source]);
  expect(selection).toHaveBeenCalledWith(base.id);
  expect(modelSettings).toHaveBeenCalledTimes(1);
  expect(analyzeChallenge).not.toHaveBeenCalled();
  act(() => view!.unmount());
  view = undefined;
  (getChallenge as jest.Mock).mockResolvedValueOnce(analyzed);
  await render(base.id);
  expect(text()).toContain('原卷解析');
});

test('恢复上次挑战的迟到结果不能覆盖用户新导入的试卷', async () => {
  const previous = deferred<ChallengeRecord>();
  (getChallenge as jest.Mock).mockReturnValueOnce(previous.promise);
  await render('challenge_previous');
  await uploadPhoto();
  await act(async () => previous.resolve(analyzed));
  expect(text()).not.toContain('原卷解析');
  expect(button('解析试卷').props.disabled).toBe(false);
});

test('补充页面引用旧记录时禁止删除，旧确认回调也不能破坏草稿；新副本保存后解除保护', async () => {
  await openSaved(analyzed);
  await press(`删除${analyzed.title}`);
  const confirmation = (Alert.alert as jest.Mock).mock.calls.slice(-1)[0][2];
  const confirmDelete = confirmation.find(
    (item: {text: string}) => item.text === '删除',
  ).onPress;
  await press('补充页面');
  expect(button(`删除${analyzed.title}`).props.disabled).toBe(true);
  expect(text()).toContain('当前补充页面正在使用此记录');
  await act(async () => {
    await confirmDelete();
  });
  expect(deleteChallenge).not.toHaveBeenCalled();
  expect(button('解析试卷').props.disabled).toBe(false);

  const copying = deferred<ChallengeRecord>();
  const copied: ChallengeRecord = {
    ...base,
    id: 'challenge_copied',
    title: '补充后的数学卷',
    sources: [
      {
        ...source,
        uri: 'file:///copied/page.jpg',
        pageUris: ['file:///copied/page.jpg'],
      },
    ],
    pageUris: ['file:///copied/page.jpg'],
  };
  (createChallenge as jest.Mock).mockReturnValueOnce(copying.promise);
  (analyzeChallenge as jest.Mock).mockResolvedValueOnce({
    ...copied,
    analysis,
    status: 'analyzed',
  });
  (listChallenges as jest.Mock).mockResolvedValue([analyzed, copied]);
  await press('解析试卷');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith(analyzed.sources);
  expect(button(`删除${analyzed.title}`).props.disabled).toBe(true);
  await act(async () => copying.resolve(copied));
  await settle();
  expect(button(`删除${analyzed.title}`).props.disabled).toBe(false);
  expect(deleteChallenge).not.toHaveBeenCalled();
});

test('切换答案PDF后，旧试卷预览的迟到错误不能覆盖新预览', async () => {
  await openSaved(completed);
  const previousError = view!.root.findByType(Pdf).props.onError;
  await press('答案 PDF');
  act(() => previousError('来自旧试卷的错误'));
  expect(text()).not.toContain('来自旧试卷的错误');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    'file:///answers.pdf',
  );
});

test('记录读取失败可重试，删除只在确认后调用持久化服务', async () => {
  (listChallenges as jest.Mock).mockRejectedValueOnce(
    new Error('数据库暂时不可用'),
  );
  await render();
  expect(text()).toContain('数据库暂时不可用');
  (listChallenges as jest.Mock).mockResolvedValueOnce([analyzed]);
  await press('重新读取记录');
  await settle();
  await press(`删除${analyzed.title}`);
  expect(deleteChallenge).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls.slice(-1)[0][2];
  await act(async () => {
    await buttons
      .find((item: {text: string}) => item.text === '删除')
      .onPress();
  });
  expect(deleteChallenge).toHaveBeenCalledWith(analyzed.id);
});
