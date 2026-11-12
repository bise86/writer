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
import ImageCropper from '../src/shared/media/ImageCropper';
import {
  persistImage,
  cropImage,
  discardPreparedImages,
} from '../src/shared/media/images';
import {
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  getChallengeReviewRoles,
} from '../src/challenge/review';
import {generationSeed} from '../src/challenge/generation';
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
} from '../src/challenge/types';

jest.mock('react-native-pdf', () => 'ChallengePdf');
jest.mock('../src/shared/media/ImageCropper', () => 'SharedImageCropper');
jest.mock('../src/shared/media/images', () => ({
  persistImage: jest.fn(),
  cropImage: jest.fn(),
  discardPreparedImages: jest.fn(async () => undefined),
}));
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
    .find(
      node =>
        node.props.accessibilityLabel === label ||
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
  await submitCrop();
}
async function openSaved(
  value = analyzed,
  roundtableSize: ChallengeRoundtableSize = settings.roundtableSize,
) {
  (listChallenges as jest.Mock).mockResolvedValueOnce([value]);
  (getChallenge as jest.Mock).mockResolvedValueOnce(value);
  await render(undefined, roundtableSize);
  await act(async () => {
    view!.root
      .findAllByType(Pressable)
      .find(node => node.props.accessibilityLabel?.startsWith('打开挑战'))!
      .props.onPress();
  });
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
  (createChallenge as jest.Mock).mockImplementation(
    async (sources: ChallengeSource[]) => ({
      ...base,
      sources,
      pageUris: sources.flatMap(itemSource => itemSource.pageUris),
    }),
  );
  (analyzeChallenge as jest.Mock).mockResolvedValue(analyzed);
  (upgradeChallenge as jest.Mock).mockResolvedValue(completed);
  (pickChallengePdf as jest.Mock).mockResolvedValue(null);
  (saveChallengePdf as jest.Mock).mockResolvedValue(true);
  (deleteChallenge as jest.Mock).mockResolvedValue(undefined);
  (discardChallengePdf as jest.Mock).mockResolvedValue(undefined);
  (persistImage as jest.Mock).mockImplementation(
    async uri => `${uri}.prepared`,
  );
  (cropImage as jest.Mock).mockResolvedValue('file:///cropped.jpg');
  (discardPreparedImages as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  jest.restoreAllMocks();
});

async function submitCrop(choice = {kind: 'original'}) {
  await act(async () => {
    await view!.root.findByType(ImageCropper).props.onSubmit(choice);
  });
  await settle();
}
async function chooseLevel(level: 1 | 2 | 3) {
  await press('升档难度');
  act(() =>
    view!.root
      .findAllByType(Pressable)
      .filter(node => node.props.accessibilityRole === 'radio')
      [level - 1].props.onPress(),
  );
}
function confirm(label: string) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.slice(-1)[0][2];
  return act(async () => {
    await buttons
      .find((item: {text: string}) => item.text === label)
      .onPress?.();
  });
}
async function startAnalysis() {
  await press('解析试卷');
  await settle();
}

test('挑战首页是开始入口和最近列表，不显示页卡或PDF预览', async () => {
  (listChallenges as jest.Mock).mockResolvedValueOnce([completed]);
  await render();
  expect(text()).toContain('开始试卷升华');
  expect(text()).toContain('最近挑战');
  expect(text()).toContain(completed.title);
  expect(text()).toContain('已完成');
  expect(text()).toContain(new Date(completed.createdAt).toLocaleString());
  expect(button('拍照')).toBeDefined();
  expect(button('上传照片')).toBeDefined();
  expect(button('上传 PDF')).toBeDefined();
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  expect(
    view!.root
      .findAllByType(Pressable)
      .filter(node => node.props.accessibilityRole === 'tab'),
  ).toHaveLength(0);
  expect(button(`删除${completed.title}`)).toBeUndefined();
});

test('相册多选逐张裁剪，保存后进入详情且不自动发模型请求', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [
      {uri: source.uri, fileName: source.name},
      {uri: 'file:///second.jpg', fileName: '第二页'},
    ],
  });
  await render();
  await press('上传照片');
  expect(launchImageLibrary).toHaveBeenCalledWith(
    expect.objectContaining({selectionLimit: 0}),
  );
  expect(view!.root.findByType(ImageCropper).props.pageLabel).toBe('1 / 2');
  await submitCrop();
  expect(createChallenge).not.toHaveBeenCalled();
  expect(view!.root.findByType(ImageCropper).props.pageLabel).toBe('2 / 2');
  const crop = {
    kind: 'crop',
    source: {width: 1000, height: 1000},
    rect: {x: 0, y: 0, width: 500, height: 500},
  };
  await submitCrop(crop);
  expect(cropImage).toHaveBeenCalledWith(
    'file:///second.jpg',
    crop.source,
    crop.rect,
  );
  expect(createChallenge).toHaveBeenCalledWith([
    expect.objectContaining({uri: `${source.uri}.prepared`}),
    expect.objectContaining({uri: 'file:///cropped.jpg'}),
  ]);
  expect(text()).toContain('原卷 · 2 张');
  expect(text()).toContain('试卷（待解析）');
  expect(analyzeChallenge).not.toHaveBeenCalled();
  expect(button('解析试卷').props.disabled).toBe(false);
  expect(button('升档').props.disabled).toBe(true);
});

test('取消多图裁剪清理已准备副本，不创建半份试卷', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [{uri: source.uri}, {uri: 'file:///second.jpg'}],
  });
  await render();
  await press('上传照片');
  await submitCrop();
  await act(async () => view!.root.findByType(ImageCropper).props.onCancel());
  await settle();
  expect(createChallenge).not.toHaveBeenCalled();
  expect(discardPreparedImages).toHaveBeenCalledWith([
    `${source.uri}.prepared`,
  ]);
  expect(text()).toContain('开始试卷升华');
});

test('连续拍照每张都裁剪，结束拍摄后一次性保存', async () => {
  (launchCamera as jest.Mock)
    .mockResolvedValueOnce({assets: [{uri: source.uri}]})
    .mockResolvedValueOnce({assets: [{uri: 'file:///next.jpg'}]});
  await render();
  await press('拍照');
  await submitCrop();
  expect(createChallenge).not.toHaveBeenCalled();
  await confirm('继续拍摄');
  await settle();
  expect(view!.root.findByType(ImageCropper).props.pageLabel).toBe('第 2 张');
  await submitCrop();
  await confirm('完成');
  await settle();
  expect(launchCamera).toHaveBeenCalledTimes(2);
  expect(createChallenge).toHaveBeenCalledTimes(1);
  expect(text()).toContain('原卷 · 2 张');
});

test('取消选择和选择器权限错误不创建记录，可直接重试', async () => {
  (launchImageLibrary as jest.Mock)
    .mockResolvedValueOnce({didCancel: true})
    .mockResolvedValueOnce({
      errorCode: 'permission',
      errorMessage: '相册权限未授权',
    });
  await render();
  await press('上传照片');
  await press('上传照片');
  expect(text()).toContain('相册权限未授权');
  expect(createChallenge).not.toHaveBeenCalled();
  await uploadPhoto();
  expect(button('解析试卷')).toBeDefined();
});

test('裁剪保存失败留在同一张图重试，入库失败清理本次图片副本', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [{uri: source.uri}],
  });
  (persistImage as jest.Mock).mockRejectedValueOnce(new Error('保存失败'));
  await render();
  await press('上传照片');
  await act(async () => {
    await expect(
      view!.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
    ).rejects.toThrow('保存失败');
  });
  expect(view!.root.findByType(ImageCropper)).toBeDefined();
  (createChallenge as jest.Mock).mockRejectedValueOnce(new Error('磁盘不可写'));
  await submitCrop();
  expect(text()).toContain('磁盘不可写');
  expect(discardPreparedImages).toHaveBeenCalledWith([
    `${source.uri}.prepared`,
  ]);
  expect(text()).toContain('开始试卷升华');
});

test('PDF导入后进入详情，每份试卷只允许一个PDF但可以补充多张照片', async () => {
  (pickChallengePdf as jest.Mock).mockResolvedValueOnce(pdfSource);
  await render();
  await press('上传 PDF');
  await settle();
  expect(createChallenge).toHaveBeenCalledWith([pdfSource]);
  expect(discardChallengePdf).toHaveBeenCalledWith(pdfSource);
  expect(text()).toContain('原卷 · 2 张');
  expect(analyzeChallenge).not.toHaveBeenCalled();
  await press('补充页面');
  expect(button('补充 PDF').props.disabled).toBe(true);
  (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
    assets: [{uri: source.uri, fileName: source.name}],
  });
  await press('补充照片');
  await submitCrop();
  expect(createChallenge).toHaveBeenLastCalledWith([
    pdfSource,
    expect.objectContaining({kind: 'image'}),
  ]);
  expect(text()).toContain('原卷 · 3 张');
});

test('详情按标题、原卷、操作按钮、页卡排列，原卷始终展示且字体适中', async () => {
  await openSaved();
  const labels = view!.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().join(''));
  expect(labels.indexOf(analysis.title)).toBeLessThan(
    labels.indexOf('原卷 · 1 张'),
  );
  expect(labels.indexOf('原卷 · 1 张')).toBeLessThan(
    labels.indexOf('解析试卷'),
  );
  expect(labels.indexOf('解析试卷')).toBeLessThan(labels.indexOf('试卷分析'));
  const title = view!.root
    .findAllByType(Text)
    .find(node => node.props.accessibilityLabel === '试卷标题')!;
  expect(title.props.style.fontSize).toBeLessThanOrEqual(22);
  const tabs = view!.root
    .findAllByType(Pressable)
    .filter(node => node.props.accessibilityRole === 'tab');
  expect(tabs.map(node => node.findByType(Text).props.children)).toEqual([
    '试卷分析',
    '升档方案',
    '试卷预览',
    '答案预览',
  ]);
  expect(button('原卷')).toBeUndefined();
  expect(button('消耗详情')).toBeUndefined();
  await press('升档方案');
  expect(text()).toContain('原卷 · 1 张');
  await press('查看原卷 1');
  expect(
    view!.root.findByType('ChallengeImageViewer' as any).props.uris,
  ).toEqual(source.pageUris);
});

test('新详情默认1档，下拉改变档次同步方案，不需要到页卡内寻找升档操作', async () => {
  await render();
  await uploadPhoto();
  await startAnalysis();
  expect(text()).toContain('升 1 档 ▾');
  expect(button('升档').props.disabled).toBe(false);
  await press('升档方案');
  for (const level of [1, 2, 3] as const) {
    await chooseLevel(level);
    expect(text()).toContain(getChallengePolicy('math', level).summary);
    expect(text()).toContain(
      `非听力题目标升档 ${{1: 20, 2: 40, 3: 65}[level]}%`,
    );
  }
  await press('试卷分析');
  await press('升档');
  await settle();
  expect(upgradeChallenge).toHaveBeenCalledWith(base.id, 3, expect.anything());
});

test('成功解析后升档可点击，说明文字或课程名称副本差异不误禁用', async () => {
  await openSaved({
    ...analyzed,
    analysis: {
      ...analysis,
      subjectIdentification: {
        ...mathIdentification,
        courseName: 'Mathematics',
        reason: '另一份已核实说明',
      },
    },
  });
  expect(button('升档').props.disabled).toBe(false);
  await press('升档');
  await settle();
  expect(upgradeChallenge).toHaveBeenCalledTimes(1);
});

test('局部解析异常不禁用升档，提示原位保留与比例不足仍正常完成', async () => {
  await openSaved({
    ...analyzed,
    analysis: {...analysis, unresolvedIssues: ['第1题条件缺失']},
  });
  expect(button('升档').props.disabled).toBe(false);
  expect(text()).toContain('局部解析异常的题将按原位置保留');
  expect(text()).not.toContain('升档前需要补充');
  await press('升档');
  await settle();
  expect(upgradeChallenge).toHaveBeenCalledTimes(1);
});

test('无升档题的空评审轮明确显示无需评审，不伪称五角色通过且PDF可浏览', async () => {
  await openSaved({
    ...completed,
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    reviewRoundtableSize: 5,
    candidate: generationSeed(analysis, 1),
    reviewRounds: [
      {
        round: 1,
        candidateRevision: completed.candidateRevision!,
        roundtableSize: 5,
        reviews: [],
      },
    ],
  });
  await press('升档方案');
  expect(text()).toContain('无升档题，原题保留，无需模型评审');
  expect(text()).not.toContain('本轮全部通过');
  expect(text()).not.toContain('评审记录尚未完整');
  await press('试卷预览');
  expect(button('下载试卷')).toBeDefined();
});

test('解析异常导致低于比例的已完成结果展示实际值及保留原因', async () => {
  const questions = Array.from({length: 5}, (_, index) => ({
    ...analysis.questions[0],
    id: `q${index + 1}`,
    number: String(index + 1),
    ...(index
      ? {
          analysisIssues: ['题目解析不完整'],
          upgradeEligibility: 'retain' as const,
        }
      : {}),
  }));
  await openSaved({
    ...completed,
    analysis: {...analysis, questions},
    candidate: {
      ...candidate,
      level: 3,
      questions: questions.map((question, index) => ({
        ...question,
        upgrade: {
          ...candidate.questions[0].upgrade,
          level: 3,
          mode: index ? 'retained' : 'upgraded',
          retentionReason: index ? '解析不完整，原位置保留' : undefined,
        },
      })),
    },
    reviewRounds: completed.reviewRounds.map(round => ({
      ...round,
      reviews: round.reviews.map(review => ({
        ...review,
        checkedQuestionIds: questions.map(question => question.id),
      })),
    })),
  });
  await press('升档方案');
  expect(text()).toContain('已升档 1 / 5 道非听力题（20.0%）');
  expect(text()).toContain('未达原目标 65%，已正常完成');
  expect(text()).toContain('解析不完整，原位置保留');
  expect(text()).toContain('已完成');
});

test('解析成功再点需要确认，可取消、复用已识别页面或重新识别全部页面', async () => {
  await openSaved();
  await press('解析试卷');
  expect(analyzeChallenge).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith(
    '是否重新解析试卷？',
    expect.any(String),
    expect.any(Array),
  );
  await confirm('取消');
  expect(analyzeChallenge).not.toHaveBeenCalled();
  await press('解析试卷');
  await confirm('继续解析');
  await settle();
  expect(analyzeChallenge).toHaveBeenLastCalledWith(
    base.id,
    expect.objectContaining({analysisMode: 'resume'}),
  );
  await press('解析试卷');
  await confirm('重新解析');
  await settle();
  expect(analyzeChallenge).toHaveBeenLastCalledWith(
    base.id,
    expect.objectContaining({analysisMode: 'restart'}),
  );
});

test('失败或待解析记录直接续解析，老确认框不能作用于另一份记录', async () => {
  await openSaved({...base, status: 'failed'});
  await press('解析试卷');
  await settle();
  expect(analyzeChallenge).toHaveBeenCalledWith(
    base.id,
    expect.objectContaining({analysisMode: 'resume'}),
  );
  await press('解析试卷');
  const stale = (Alert.alert as jest.Mock).mock.calls
    .slice(-1)[0][2]
    .find((value: {text: string}) => value.text === '重新解析').onPress;
  await press('‹ 返回挑战');
  await act(async () => stale());
  expect(analyzeChallenge).toHaveBeenCalledTimes(1);
});

test('逐题分析、难度分布、知识范围只在分析页卡，原卷始终在页卡外', async () => {
  await openSaved();
  expect(text()).toContain('难度分布');
  expect(text()).toContain('知识范围');
  expect(text()).toContain(analysis.questions[0].stem);
  await press('升档方案');
  expect(text()).not.toContain('难度分布');
  expect(text()).not.toContain(analysis.questions[0].stem);
  expect(text()).toContain('原卷 · 1 张');
});

test('方案列出升级题号与保留原因，改变下拉档次不改写已完成结果', async () => {
  const questions = Array.from({length: 5}, (_, index) => ({
    ...analysis.questions[0],
    id: `q${index + 1}`,
    number: String(index + 1),
  }));
  const value = {
    ...completed,
    level: 2 as const,
    analysis: {...analysis, questions},
    candidate: {
      ...candidate,
      level: 2 as const,
      questions: questions.map((question, index) => ({
        ...question,
        upgrade: {
          ...candidate.questions[0].upgrade,
          level: 2 as const,
          mode: index < 2 ? ('upgraded' as const) : ('retained' as const),
          changes: index < 2 ? ['由直接计算改为反推条件'] : [],
          retentionReason: '原题范围窄，维持原题',
        },
      })),
    },
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
  await chooseLevel(3);
  expect(text()).toContain('原目标升档 4 题');
  expect(text()).toContain('本次生成结果 · 升 2 档');
});

test.each([0, 3, 5] as const)(
  '生成记录沿保存的%d角色校核设置显示进度，摘要不泄露答案',
  async size => {
    const value = roundtableRecord(size);
    value.reviewRounds[0].reviews[0].summary = '不可泄露的答案';
    await openSaved(value, 5);
    await press('升档方案');
    expect(text()).toContain(size ? `${size} 角色圆桌评审` : '基础综合校核');
    expect(text()).not.toContain('不可泄露的答案');
  },
);

test('试卷和答案各自PDF预览下载，原卷始终可见，错误可重开且旧回调不污染新页卡', async () => {
  await openSaved(completed);
  await press('试卷预览');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe('file:///paper.pdf');
  expect(text()).toContain('原卷 · 1 张');
  const oldError = view!.root.findByType(Pdf).props.onError;
  act(() => oldError('暂不可读'));
  expect(text()).toContain('暂不可读');
  await press('重新打开 PDF');
  await press('下载试卷');
  expect(saveChallengePdf).toHaveBeenLastCalledWith(
    'file:///paper.pdf',
    expect.stringContaining('试卷.pdf'),
  );
  await press('答案预览');
  act(() => oldError('旧试卷的迟到错误'));
  expect(text()).not.toContain('旧试卷的迟到错误');
  expect(view!.root.findByType(Pdf).props.source.uri).toBe(
    'file:///answers.pdf',
  );
  await press('下载答案');
  expect(saveChallengePdf).toHaveBeenLastCalledWith(
    'file:///answers.pdf',
    expect.stringContaining('答案.pdf'),
  );
});

test('候选版本未通过时不显示PDF，保存取消或失败不会报成功', async () => {
  await openSaved({...completed, candidateRevision: 2});
  await press('试卷预览');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
  await act(async () => view!.unmount());
  view = undefined;
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
});

test('首次请求后出现独立消耗页卡，运行中累计更新，切换页卡不中断任务', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  expect(button('消耗详情')).toBeUndefined();
  await startAnalysis();
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
  expect(text()).toContain('进行中 1 次');
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
  ];
  act(() => options.onUpdate({...base, status: 'analyzing', calls}));
  expect(text()).toContain('合计：120');
  await press('试卷分析');
  expect(options.signal.aborted).toBe(false);
  await act(async () => pending.resolve({...analyzed, calls}));
});

test('返回挑战首页或主首页、卸载后后台请求继续，重进可恢复并主动停止', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await render();
  await uploadPhoto();
  await startAnalysis();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  await press('‹ 返回挑战');
  expect(text()).toContain('开始试卷升华');
  expect(back).not.toHaveBeenCalled();
  expect(options.signal.aborted).toBe(false);
  await press('‹ 返回首页');
  expect(back).toHaveBeenCalledTimes(1);
  await act(async () => view!.unmount());
  view = undefined;
  options.onUpdate({
    ...base,
    status: 'analyzing',
    progress: '后台正在核验标题',
  });
  (getChallenge as jest.Mock).mockResolvedValueOnce(base);
  await render(base.id);
  expect(text()).toContain('后台正在核验标题');
  expect(getChallengeTask(base.id)).toBeDefined();
  await press('停止处理');
  expect(options.signal.aborted).toBe(true);
  await act(async () => pending.resolve({...analyzed, status: 'cancelled'}));
  expect(button('解析试卷').props.disabled).toBe(false);
});

test('升档时可进入设置，返回继续原请求，详情外主页不嵌入PDF', async () => {
  const pending = deferred<ChallengeRecord>();
  (upgradeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  await openSaved();
  await press('升档');
  await settle();
  const options = (upgradeChallenge as jest.Mock).mock.calls[0][2];
  await press('模型设置');
  expect(modelSettings).toHaveBeenCalledTimes(1);
  await act(async () => view!.unmount());
  view = undefined;
  expect(options.signal.aborted).toBe(false);
  await act(async () => pending.resolve(completed));
  (getChallenge as jest.Mock).mockResolvedValueOnce(completed);
  await render(completed.id);
  expect(view!.root.findByType(Pdf).props.source.uri).toBe('file:///paper.pdf');
  await press('‹ 返回挑战');
  expect(view!.root.findAllByType(Pdf)).toHaveLength(0);
});

test('重复点击不重复请求，后台旧任务不能覆盖另一个新详情', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  const other = {...base, id: 'challenge_other', title: '另一份试卷'};
  await render();
  await uploadPhoto();
  act(() => {
    button('解析试卷').props.onPress();
    button('解析试卷').props.onPress();
  });
  await settle();
  expect(analyzeChallenge).toHaveBeenCalledTimes(1);
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  (listChallenges as jest.Mock).mockResolvedValue([other]);
  await press('‹ 返回挑战');
  (getChallenge as jest.Mock).mockResolvedValueOnce(other);
  await press(`打开挑战${other.title}`);
  act(() => options.onUpdate({...analyzed, progress: '旧任务的后续进度'}));
  await act(async () => pending.resolve(analyzed));
  expect(text()).not.toContain('旧任务的后续进度');
  expect(selection).toHaveBeenLastCalledWith(other.id);
});

test('最近没有删除入口，管理页确认后停止任务并删除记录', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  (listChallenges as jest.Mock).mockResolvedValue([analyzed]);
  await openSaved();
  await press('解析试卷');
  await confirm('继续解析');
  await settle();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  await press('‹ 返回挑战');
  expect(button(`删除${analyzed.title}`)).toBeUndefined();
  await press('管理');
  selectRecord(analyzed.title);
  await press('删除已选（1）');
  expect(deleteChallenge).not.toHaveBeenCalled();
  (listChallenges as jest.Mock).mockResolvedValue([]);
  await confirm('删除');
  expect(deleteChallenge).toHaveBeenCalledWith(analyzed.id);
  expect(options.signal.aborted).toBe(true);
  await press('‹ 返回挑战');
  await act(async () => pending.resolve(analyzed));
  expect(text()).toContain('开始试卷升华');
});

test('旧恢复结果不覆盖刚导入的新记录，记录读取失败可重试', async () => {
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
  expect(text()).toContain('试卷（待解析）');
  expect(button('解析试卷').props.disabled).toBe(false);
});
