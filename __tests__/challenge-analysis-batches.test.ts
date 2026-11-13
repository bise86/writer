import {
  emptyExamDraft,
  finalizeExamDraft,
  mergeConfirmedQuestionBatch,
  mergeExamDraftBatch,
  retainUnparsedRegions,
} from '../src/challenge/analysisBatches';
import {validateExamDraft} from '../src/challenge/validation';
import type {
  ChallengePage,
  ExamDraft,
  SourceQuestion,
} from '../src/challenge/types';

const pages: ChallengePage[] = [
  {
    pageIndex: 0,
    documentType: 'exam',
    text: '数学试卷\n一、解答\n1. 计算2+3。\n2. 计算4+5。',
    hasStudentAnswers: false,
    figures: [],
    unreadableParts: [],
    questionRegions: [
      {number: '1', box: {x: 0, y: 0.1, width: 1, height: 0.3}},
      {number: '2', box: {x: 0, y: 0.5, width: 1, height: 0.3}},
    ],
  },
];
const section = {id: 's', title: '一、解答', instructions: ''};
const question = (number: number): SourceQuestion => ({
  id: `q${number}`,
  number: String(number),
  sectionId: 's',
  type: '计算题',
  stem: number === 1 ? '计算2+3。' : '计算4+5。',
  options: [],
  materialIds: [],
  figureIds: [],
  knowledgePoints: ['整数加法'],
  score: 5,
  isListening: false,
  answerLines: 2,
  sourceRefs: [{pageIndex: 0, quote: number === 1 ? '计算2+3。' : '计算4+5。'}],
  difficulty: {rating: 1, reasoningSteps: 1, explanation: '直接计算加法'},
  analysisIssues: [],
});
const summary = {
  title: '数学试卷',
  subject: 'math',
  subjectLabel: '数学',
  educationLevel: 'middle',
  titleEvidence: [{pageIndex: 0, quote: '数学试卷'}],
  difficultySummary: '原卷为基础加法',
};
const first = () =>
  mergeExamDraftBatch(
    emptyExamDraft(pages),
    {questions: [question(1)], sections: [section], pageComplete: false},
    pages,
    0,
    1,
  ).draft;

test('分批空草稿只在partial模式可用，不能被当作完整解析或进入升档', () => {
  const empty = emptyExamDraft(pages);
  expect(validateExamDraft(empty, pages, {partial: true}).questions).toEqual(
    [],
  );
  expect(() => validateExamDraft(empty, pages)).toThrow('questions');
});

test('后批仅合并新原题并复用稳定题组，完成时本地合并知识点而非要求模型重复整卷', () => {
  const base = first();
  const result = mergeExamDraftBatch(
    base,
    {questions: [question(2)], pageComplete: true},
    pages,
    0,
    1,
  );
  const completed = finalizeExamDraft(result.draft, summary, pages);
  expect(completed.questions.map(item => item.id)).toEqual(['q1', 'q2']);
  expect(completed.sections).toEqual([section]);
  expect(completed.knowledgePoints).toEqual(['整数加法']);
  expect(base.questions).toHaveLength(1);
});

test('已保存原题和共享材料不能被后批暗改或覆盖', () => {
  const base = first();
  expect(() =>
    mergeExamDraftBatch(
      base,
      {questions: [{...question(1), stem: '改写原题'}], pageComplete: true},
      pages,
      0,
      1,
    ),
  ).toThrow('已保存');
  expect(() =>
    mergeExamDraftBatch(
      base,
      {
        questions: [question(2)],
        sections: [{...section, instructions: '新要求'}],
        pageComplete: true,
      },
      pages,
      0,
      1,
    ),
  ).toThrow('不得在后批暗改');
});

test('同内容共享材料换ID时本地归一引用，避免跨批重复造成材料割裂', () => {
  const material = {
    id: 'm',
    title: '公共材料',
    text: '两个数相加。',
    isListening: false,
    figureIds: [],
  };
  const base = mergeExamDraftBatch(
    emptyExamDraft(pages),
    {
      questions: [{...question(1), materialIds: ['m']}],
      materials: [material],
      sections: [section],
      pageComplete: false,
    },
    pages,
    0,
    1,
  ).draft;
  const result = mergeExamDraftBatch(
    base,
    {
      questions: [{...question(2), materialIds: ['m-copy']}],
      materials: [{...material, id: 'm-copy'}],
      pageComplete: true,
    },
    pages,
    0,
    1,
  ).draft;
  expect(result.materials).toHaveLength(1);
  expect(result.questions[1].materialIds).toEqual(['m']);
});

test('分批声明完毕却遗漏题框中的题时，按原位置补原图待核题而非丢题或猜补', () => {
  const result = finalizeExamDraft(first(), summary, pages);
  expect(result.questions).toHaveLength(2);
  expect(result.questions[1]).toMatchObject({
    number: '2',
    stem: '',
    upgradeEligibility: 'retain',
    originalRegions: [{pageIndex: 0, box: pages[0].questionRegions![1].box}],
  });
  expect(result.questions[1].analysisIssues?.length).toBeGreaterThan(0);
});

test('遗漏的是前题时保留原位置；跨页同号原题补图范围，不产生重复题号', () => {
  const base: ExamDraft = {
    ...emptyExamDraft(pages),
    sections: [section],
    questions: [question(2)],
    knowledgePoints: ['整数加法'],
  };
  const result = retainUnparsedRegions(base, pages);
  expect(result.questions.map(item => item.number)).toEqual(['1', '2']);
  const continuation = {
    ...pages[0],
    pageIndex: 1,
    questionRegions: [pages[0].questionRegions![1]],
  };
  const crossPage = retainUnparsedRegions(base, [pages[0], continuation]);
  expect(crossPage.questions.filter(item => item.number === '2')).toHaveLength(
    1,
  );
  expect(
    crossPage.questions.find(item => item.number === '2')?.originalRegions?.[0]
      .pageIndex,
  ).toBe(1);
});

test('跨页母题框已有真实叶子题和公共原锚时，不误当遗漏小题再增一题', () => {
  const parentPage = {
    ...pages[0],
    questionRegions: [{...pages[0].questionRegions![0], number: '19'}],
  };
  const base = {
    ...first(),
    questions: [
      {
        ...question(1),
        number: '19(1)',
        majorQuestionId: 'm19',
        sourceRefs: [{pageIndex: 1, quote: '计算2+3。'}],
      },
    ],
    majorQuestions: [
      {
        id: 'm19',
        title: '第19题',
        sourceRefs: [{pageIndex: 0, quote: '一、解答'}],
      },
    ],
  };
  expect(retainUnparsedRegions(base, [parentPage]).questions).toHaveLength(1);
});

test('分批允许尚未遇到的前问ID，最终仍须绑定真实原题；无法绑定时保留相关原题', () => {
  const raw = {...question(1), dependsOnQuestionIds: ['not-yet-parsed']};
  const partial = mergeExamDraftBatch(
    emptyExamDraft(pages),
    {questions: [raw], sections: [section], pageComplete: true},
    pages,
    0,
    1,
  ).draft;
  expect(partial.questions[0].dependsOnQuestionIds).toEqual(['not-yet-parsed']);
  expect(() => validateExamDraft(partial, pages)).toThrow('依赖');
  const result = finalizeExamDraft(partial, summary, pages);
  expect(result.questions[0].upgradeEligibility).toBe('retain');
  expect(result.questions[0].dependsOnQuestionIds).toEqual([]);
});

test('未来页有不可辨认处不应在partial校验时误把当前可靠原题整体标为异常', () => {
  const later = {
    ...pages[0],
    pageIndex: 1,
    text: '第3题题干被遮挡',
    unreadableParts: ['第3题被遮挡'],
    questionRegions: [{number: '3', box: {x: 0, y: 0, width: 1, height: 1}}],
  };
  const result = mergeExamDraftBatch(
    emptyExamDraft([pages[0], later]),
    {questions: [question(1)], sections: [section], pageComplete: true},
    [pages[0], later],
    0,
    1,
  ).draft;
  expect(result.questions[0].analysisIssues).toEqual([]);
});

test.each([
  {questions: [], pageComplete: false},
  {questions: [question(1), question(2)], pageComplete: false},
  {questions: [question(1)], pageComplete: true, warnings: '非数组'},
])('拒绝空转、超额或格式无效的原题批次 %#', value => {
  expect(() =>
    mergeExamDraftBatch(
      emptyExamDraft(pages),
      {...value, sections: [section]},
      pages,
      0,
      1,
    ),
  ).toThrow();
});

test('科目核验只允许指定题的分析补丁，保存题干、顺序与原引文', () => {
  const base = first();
  const result = mergeConfirmedQuestionBatch(
    base,
    {
      questions: [
        {
          id: 'q1',
          knowledgePoints: ['整数加法'],
          difficulty: {
            rating: 2,
            reasoningSteps: 1,
            explanation: '实际原题知识范围',
          },
        },
      ],
    },
    pages,
    ['q1'],
  );
  expect(result.questions[0].stem).toBe(base.questions[0].stem);
  expect(result.questions[0].sourceRefs).toEqual(base.questions[0].sourceRefs);
  expect(result.questions[0].difficulty.rating).toBe(2);
  expect(() =>
    mergeConfirmedQuestionBatch(
      base,
      {questions: [{...question(1), stem: '新题'}]},
      pages,
      ['q1'],
    ),
  ).toThrow('不能增删题目或返回题干');
  expect(() =>
    finalizeExamDraft(base, {...summary, questions: []}, pages),
  ).toThrow('不重复返回questions');
});
