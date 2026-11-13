import {selectUpgradeQuestions} from '../src/challenge/planning';
import {
  canResumeGeneration,
  CHALLENGE_GENERATION_SELECTION_VERSION,
  generationCheckpoint,
  generationSeed,
} from '../src/challenge/generation';
import {CHALLENGE_SUBJECTS} from '../src/challenge/rules';
import type {ChallengeSubject, ExamAnalysis} from '../src/challenge/types';

function fixture(count = 10, subject: ChallengeSubject = 'math'): ExamAnalysis {
  return {
    isExam: true,
    title: '试卷',
    subject,
    subjectLabel: subject,
    educationLevel: 'middle',
    knowledgePoints: ['原有知识点'],
    difficultySummary: '原有知识内估计难度',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    sections: [{id: 's1', title: '解答题', instructions: ''}],
    materials: [],
    figures: [],
    questions: Array.from({length: count}, (_, index) => ({
      id: `q${index + 1}`,
      number: String(index + 1),
      sectionId: 's1',
      type: '解答题',
      stem: `第${index + 1}题原有完整条件和设问。`,
      options: [],
      materialIds: [],
      figureIds: [],
      knowledgePoints: ['原有知识点'],
      score: 5,
      isListening: false,
      answerLines: 2,
      sourceRefs: [
        {pageIndex: 0, quote: `第${index + 1}题原有完整条件和设问。`},
      ],
      difficulty: {
        rating: 3,
        reasoningSteps: 1,
        explanation: '直接运用原核心。',
      },
    })),
    totalScore: count * 5,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
  };
}

test.each(
  CHALLENGE_SUBJECTS.flatMap(subject =>
    ([1, 2, 3] as const).map(level => ({
      subject,
      level,
      count: [2, 4, 7][level - 1],
    })),
  ),
)(
  '$subject升$level档只选择$count/10题，原卷不被修改',
  ({subject, level, count}) => {
    const analysis = fixture(10, subject);
    const before = JSON.stringify(analysis);
    const selected = selectUpgradeQuestions(analysis, level);
    expect(selected).toHaveLength(count);
    expect(new Set(selected).size).toBe(count);
    expect(JSON.stringify(analysis)).toBe(before);
  },
);

test.each([1, 2, 3] as const)(
  '升%s档的分母只含非听力题，听力永不入选',
  level => {
    const analysis = fixture(20, 'english');
    analysis.questions.slice(0, 8).forEach(question => {
      question.isListening = true;
    });
    const selected = selectUpgradeQuestions(analysis, level);
    expect(selected).toHaveLength(Math.ceil(12 * [0.2, 0.4, 0.65][level - 1]));
    expect(
      selected.every(
        id =>
          !analysis.questions.find(question => question.id === id)!.isListening,
      ),
    ).toBe(true);
  },
);

test('可升档的英语作文优先入选，仍遵守本档题数', () => {
  const analysis = fixture(10, 'english');
  analysis.questions[9].type = '书面表达';
  expect(selectUpgradeQuestions(analysis, 1)).toHaveLength(2);
  expect(selectUpgradeQuestions(analysis, 1)).toContain('q10');
});

test('同等条件下兼顾不同题组和原核心，不按全卷逐题遍历发请求', () => {
  const analysis = fixture();
  analysis.sections.push({id: 's2', title: '另一题组', instructions: ''});
  analysis.questions[8].sectionId = 's2';
  analysis.questions[8].knowledgePoints = ['另一个原核心'];
  expect(selectUpgradeQuestions(analysis, 1)).toEqual(['q1', 'q9']);
});

test('只选后问时原前问作为上下文，不为了保留题而升级所有前问', () => {
  const analysis = fixture(3);
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  analysis.questions[2].dependsOnQuestionIds = ['q1'];
  expect(selectUpgradeQuestions(analysis, 1)).toEqual(['q2']);
});

test('选择一个变式前问时，其全部后问也必须纳入计划', () => {
  const analysis = fixture(2);
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  expect(selectUpgradeQuestions(analysis, 3)).toEqual(['q1', 'q2']);
});

test('解析异常及其前问依赖均不入选，比例不可达时只使用可靠题', () => {
  const analysis = fixture();
  analysis.questions.slice(0, 9).forEach(question => {
    question.analysisIssues = ['本题条件辨认不完整'];
  });
  expect(selectUpgradeQuestions(analysis, 3)).toEqual(['q10']);
  analysis.questions[9].dependsOnQuestionIds = ['q1'];
  expect(selectUpgradeQuestions(analysis, 3)).toEqual([]);
});

test('已达本档比例时不再选择其它原题，已完成题也不重复请求', () => {
  const analysis = fixture();
  expect(
    selectUpgradeQuestions(analysis, 1, {
      upgradedQuestionIds: ['q1', 'q2'],
      attemptedQuestionIds: ['q1', 'q2'],
    }),
  ).toEqual([]);
});

test('候选明确保留后只按差额补选，不重试它或扩大到全卷', () => {
  const analysis = fixture();
  expect(
    selectUpgradeQuestions(analysis, 1, {
      upgradedQuestionIds: ['q1'],
      attemptedQuestionIds: ['q1', 'q2'],
    }),
  ).toEqual(['q3']);
  expect(
    selectUpgradeQuestions(analysis, 1, {
      attemptedQuestionIds: analysis.questions.map(question => question.id),
    }),
  ).toEqual([]);
});

test('旧草稿已改前问时只继续必要后问，其它原题不进入新队列', () => {
  const analysis = fixture();
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  analysis.questions[2].dependsOnQuestionIds = ['q2'];
  expect(
    selectUpgradeQuestions(analysis, 1, {
      upgradedQuestionIds: ['q1', 'q4'],
      attemptedQuestionIds: ['q1', 'q4'],
    }),
  ).toEqual(['q2', 'q3']);
});

test('已升档题的显式返修仍会继续，但已达比例时不补选其它原题', () => {
  const analysis = fixture();
  expect(
    selectUpgradeQuestions(analysis, 1, {
      upgradedQuestionIds: ['q1', 'q2'],
      attemptedQuestionIds: ['q1', 'q2'],
      pendingQuestionIds: ['q1'],
    }),
  ).toEqual(['q1']);
});

test('循环及缺失依赖局部排除，独立题仍能入选', () => {
  const analysis = fixture(5);
  analysis.questions[0].dependsOnQuestionIds = ['q2'];
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  analysis.questions[2].dependsOnQuestionIds = ['missing'];
  expect(selectUpgradeQuestions(analysis, 1)).toEqual(['q4']);
});

test('断点持久化已选题范围，拒绝未选题偷偷进入待修或已完成列表', () => {
  const analysis = fixture();
  const checkpoint = generationCheckpoint(
    analysis,
    1,
    ['q1'],
    generationSeed(analysis, 1),
    {
      selectionVersion: CHALLENGE_GENERATION_SELECTION_VERSION,
      selectedQuestionIds: ['q1', 'q2'],
      pendingQuestionIds: ['q2'],
    },
  );
  expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(true);
  expect(
    canResumeGeneration(
      {...checkpoint, pendingQuestionIds: ['q3']},
      analysis,
      1,
    ),
  ).toBe(false);
  expect(
    canResumeGeneration(
      {...checkpoint, completedQuestionIds: ['q3']},
      analysis,
      1,
    ),
  ).toBe(false);
  expect(
    canResumeGeneration(
      {...checkpoint, selectedQuestionIds: ['q1', 'q1']},
      analysis,
      1,
    ),
  ).toBe(false);
});
