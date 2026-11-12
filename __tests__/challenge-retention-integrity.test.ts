import {
  generationSeed,
  mergeGenerationPatch,
} from '../src/challenge/generation';
import {preserveRequiredOriginals} from '../src/challenge/selection';
import type {
  ChallengePaper,
  ExamAnalysis,
  QuestionAnswer,
} from '../src/challenge/types';

function fixture(): ExamAnalysis {
  return {
    isExam: true,
    title: '数学试卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    difficultySummary: '原范围内的基础题',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    knowledgePoints: ['一元一次方程'],
    sections: [{id: 's', title: '解答题', instructions: '按题意求解。'}],
    materials: [
      {
        id: 'm',
        title: '原共享条件',
        text: '变量只取实数。',
        isListening: false,
        figureIds: ['f'],
      },
    ],
    figures: [
      {
        id: 'f',
        kind: 'source',
        pageIndex: 0,
        box: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
        caption: '原坐标图',
        containsStudentMarks: false,
      },
    ],
    questions: ['q1', 'q2'].map((id, index) => ({
      id,
      number: String(index + 1),
      sectionId: 's',
      type: '解答题',
      stem: index ? '求3x=6的解。' : '求2x=4的解。',
      options: [],
      materialIds: index ? [] : ['m'],
      figureIds: [],
      knowledgePoints: ['一元一次方程'],
      score: 5,
      isListening: false,
      answerLines: 2,
      sourceRefs: [{pageIndex: 0, quote: '原条件'}],
      difficulty: {
        rating: 2,
        reasoningSteps: 1,
        explanation: '按等式性质求解。',
      },
    })),
    totalScore: 10,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
  };
}

function originalAnswer(questionId = 'q1'): QuestionAnswer {
  return {
    questionId,
    status: 'verified',
    answer: 'x=2',
    explanation: '原等式两边同除以x的系数，得到x=2。',
    scoringPoints: ['正确运用等式性质'],
    learningGuide: [],
  };
}

function preserve(paper: ChallengePaper, analysis: ExamAnalysis) {
  return preserveRequiredOriginals(paper, analysis, 1) as ChallengePaper;
}

function expectPending(answer: QuestionAnswer | undefined) {
  expect(answer).toMatchObject({
    status: 'requires_review',
    answer: '',
    scoringPoints: [],
    learningGuide: [],
  });
  expect(answer?.explanation).toContain('待核');
}

test('后批保留题回退已升档前问时，同时丢弃变式答案、评分点和学习说明', () => {
  const analysis = fixture();
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  const seed = generationSeed(analysis, 1);
  const first = mergeGenerationPatch(
    {
      questions: [
        {
          ...seed.questions[0],
          stem: '比较2x=18在指定约束下的解是否存在。',
          upgrade: {
            ...seed.questions[0].upgrade,
            mode: 'upgraded',
            changes: ['加入约束辨析'],
            pitfalls: ['遗漏约束'],
          },
        },
      ],
      answers: [
        {
          questionId: 'q1',
          status: 'verified',
          answer: 'x=9',
          explanation: '按新等式求得x=9，再核验约束。',
          scoringPoints: ['变式评分点：x=9'],
          learningGuide: [{knowledgePoint: '旧变式专用学习说明'}],
        },
      ],
    },
    analysis,
    seed,
    ['q1'],
    [],
  );
  expect(first.questions[0].upgrade.mode).toBe('upgraded');
  const final = mergeGenerationPatch(
    {questions: [], answers: []},
    analysis,
    first,
    ['q2'],
    ['q1'],
  );
  expect(final.questions[0].stem).toBe(analysis.questions[0].stem);
  expect(final.questions[0].upgrade.mode).toBe('retained');
  expectPending(final.answers.find(answer => answer.questionId === 'q1'));
  expect(JSON.stringify(final.answers)).not.toContain('x=9');
  expect(JSON.stringify(final.answers)).not.toContain('旧变式专用');
});

test('题目原本已保留且整个原题上下文完整时，保留已经可靠核实的原答案', () => {
  const analysis = fixture();
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  analysis.questions[1].upgradeEligibility = 'retain';
  const paper = generationSeed(analysis, 1);
  paper.answers = [originalAnswer(), originalAnswer('q2')];
  const before = JSON.stringify(paper);
  const result = preserve(paper, analysis);
  expect(result.answers.find(answer => answer.questionId === 'q1')).toEqual(
    originalAnswer(),
  );
  expect(result.answers.find(answer => answer.questionId === 'q2')).toEqual(
    originalAnswer('q2'),
  );
  expect(JSON.stringify(paper)).toBe(before);
});

test.each([
  [
    '题面',
    (paper: ChallengePaper): void => {
      paper.questions[0].stem = '求2x=18。';
    },
  ],
  [
    '题组指示',
    (paper: ChallengePaper): void => {
      paper.sections[0].instructions = '取整后求解。';
    },
  ],
  [
    '共享材料',
    (paper: ChallengePaper): void => {
      paper.materials[0].text = '变量只取整数。';
    },
  ],
  [
    '材料图',
    (paper: ChallengePaper): void => {
      paper.figures[0].caption = '不同坐标图';
    },
  ],
] as const)('恢复已被改动的%s时，不能沿用候选原答案', (_name, change) => {
  const analysis = fixture();
  analysis.questions[0].upgradeEligibility = 'retain';
  const paper = JSON.parse(
    JSON.stringify(generationSeed(analysis, 1)),
  ) as ChallengePaper;
  paper.answers[0] = originalAnswer();
  change(paper);
  const result = preserve(paper, analysis);
  expectPending(result.answers.find(answer => answer.questionId === 'q1'));
});

test('后问题面未变但前问上下文被改过，恢复前问后须将后问旧答案标待核', () => {
  const analysis = fixture();
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  analysis.questions[1].upgradeEligibility = 'retain';
  const paper = generationSeed(analysis, 1);
  paper.questions[0].stem = '求2x=18。';
  paper.answers = [originalAnswer(), originalAnswer('q2')];
  const result = preserve(paper, analysis);
  expectPending(result.answers.find(answer => answer.questionId === 'q1'));
  expectPending(result.answers.find(answer => answer.questionId === 'q2'));
});

test('前问解析待核时，不把依赖它的后问旧答案当作已验证原答案', () => {
  const analysis = fixture();
  analysis.questions[0].analysisIssues = ['难度分析待核'];
  analysis.questions[1].dependsOnQuestionIds = ['q1'];
  const paper = generationSeed(analysis, 1);
  paper.answers = [originalAnswer(), originalAnswer('q2')];
  const result = preserve(paper, analysis);
  expectPending(result.answers.find(answer => answer.questionId === 'q2'));
});

test.each(['requires_audio', 'verified'] as const)(
  '听力原题及可靠原上下文未变时沿用已有%s状态',
  status => {
    const analysis = fixture();
    analysis.subject = 'english';
    analysis.subjectLabel = '英语';
    analysis.questions[0].isListening = true;
    analysis.materials[0].isListening = true;
    analysis.materials[0].title = '听力原文转写';
    analysis.materials[0].text = 'The answer is two.';
    const paper = generationSeed(analysis, 1);
    paper.answers[0] =
      status === 'verified'
        ? originalAnswer()
        : {
            questionId: 'q1',
            status,
            answer: '',
            explanation: '听力答案待核，需结合原录音。',
            scoringPoints: [],
          };
    expect(
      preserve(paper, analysis).answers.find(
        answer => answer.questionId === 'q1',
      ),
    ).toEqual(paper.answers[0]);
  },
);
