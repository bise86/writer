import {
  analysisRequestSignature,
  candidateCheckpoint,
  checkpointSignature,
  sameCandidateCheckpoint,
  resumableReviewBatches,
} from '../src/challenge/checkpoints';
import {generationSeed} from '../src/challenge/generation';
import type {ChallengeReviewBatch, ExamAnalysis} from '../src/challenge/types';

function fixture() {
  const analysis: ExamAnalysis = {
    isExam: true,
    title: '数学试卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    answerState: 'blank',
    knowledgePoints: ['加法'],
    difficultySummary: '估计难度',
    difficultyBasis: 'estimated',
    warnings: [],
    unresolvedIssues: [],
    sections: [{id: 's', title: '计算', instructions: ''}],
    materials: [],
    figures: [],
    totalScore: 10,
    timeLimitMinutes: null,
    questions: ['q1', 'q2'].map((id, index) => ({
      id,
      number: String(index + 1),
      sectionId: 's',
      type: '计算题',
      stem: '计算2+3。',
      options: [],
      materialIds: [],
      figureIds: [],
      knowledgePoints: ['加法'],
      score: 5,
      isListening: false,
      answerLines: 1,
      sourceRefs: [{pageIndex: 0, quote: '计算2+3。'}],
      difficulty: {rating: 1, reasoningSteps: 1, explanation: '直接计算'},
    })),
  };
  const paper = generationSeed(analysis, 1);
  paper.questions[0].upgrade.mode = 'upgraded';
  const identity = candidateCheckpoint(
    analysis,
    paper,
    ['file:///original.png'],
    2,
    5,
  );
  const batch: ChallengeReviewBatch = {
    role: 'answers',
    pageIndex: -1,
    questionIds: ['q1'],
    report: {
      role: 'answers',
      verdict: 'approve',
      checkedQuestionIds: ['q1'],
      summary: '已独立核验原题与新题',
      issues: [],
    },
  };
  return {analysis, paper, identity, batch};
}

test('断点签名忽略对象键排列，保留题目顺序、正文、规则和来源差异', () => {
  expect(checkpointSignature({b: 2, a: [1, 2]})).toBe(
    checkpointSignature({a: [1, 2], b: 2}),
  );
  expect(checkpointSignature({a: [1, 2]})).not.toBe(
    checkpointSignature({a: [2, 1]}),
  );
  const {analysis, paper, identity} = fixture();
  expect(
    candidateCheckpoint(
      analysis,
      {...paper, title: '另一试卷'},
      ['file:///original.png'],
      2,
      5,
    ).candidateSignature,
  ).not.toBe(identity.candidateSignature);
  expect(
    candidateCheckpoint(analysis, paper, ['file:///replacement.png'], 2, 5)
      .sourceSignature,
  ).not.toBe(identity.sourceSignature);
});

test('解析纠错断点不重复持久化图片base64，仍绑定原任务和提示词', () => {
  const input = [
    {
      role: 'user',
      content: [
        {type: 'input_image', image_url: 'data:image/png;base64,SECRET_BYTES'},
      ],
    },
  ];
  const signature = analysisRequestSignature(input, '解析本页');
  expect(signature).not.toContain('SECRET_BYTES');
  expect(signature).not.toBe(analysisRequestSignature(input, '另一任务'));
});

test('只复用同来源、候选、修订、人数、协议和轮次的完整有效角色子报告', () => {
  const {analysis, paper, identity, batch} = fixture();
  const stored = {
    ...identity,
    version: 'review-batches-v1' as const,
    round: 1,
    batches: [batch],
  };
  expect(sameCandidateCheckpoint(identity, {...stored})).toBe(true);
  expect(
    resumableReviewBatches(stored, identity, 1, analysis, paper),
  ).toHaveLength(1);
  for (const key of [
    'sourceSignature',
    'candidateSignature',
    'candidateRevision',
    'policyVersion',
    'reviewProtocolVersion',
    'roundtableSize',
  ] as const) {
    const stale = {
      ...stored,
      [key]:
        key === 'candidateRevision'
          ? 3
          : key === 'roundtableSize'
          ? 3
          : 'stale',
    };
    expect(resumableReviewBatches(stale, identity, 1, analysis, paper)).toEqual(
      [],
    );
  }
  expect(resumableReviewBatches(stored, identity, 2, analysis, paper)).toEqual(
    [],
  );
});

test('缓存不能混入原题、错角色或重复小题报告，合格前批仍可保留', () => {
  const {analysis, paper, identity, batch} = fixture();
  const retained = {
    ...batch,
    questionIds: ['q2'],
    report: {...batch.report, checkedQuestionIds: ['q2']},
  };
  const wrongRole = {...batch, role: 'subject' as const};
  const stored = {
    ...identity,
    version: 'review-batches-v1' as const,
    round: 1,
    batches: [batch, retained, wrongRole, batch],
  };
  expect(resumableReviewBatches(stored, identity, 1, analysis, paper)).toEqual([
    batch,
  ]);
});

test('同题两个原图页的评审分别保存，不能把第1页报告当作第2页已审', () => {
  const {analysis, paper, batch} = fixture();
  analysis.figures = [0, 1].map(pageIndex => ({
    id: `f${pageIndex}`,
    kind: 'source',
    pageIndex,
    box: {x: 0, y: 0, width: 1, height: 1},
    caption: '原图条件',
    containsStudentMarks: false,
  }));
  analysis.questions[0].figureIds = ['f0', 'f1'];
  paper.figures = analysis.figures;
  paper.questions[0].figureIds = ['f0', 'f1'];
  const identity = candidateCheckpoint(
    analysis,
    paper,
    ['page0', 'page1'],
    2,
    5,
  );
  const batches = [
    {...batch, pageIndex: 0},
    {...batch, pageIndex: 1},
  ];
  const stored = {
    ...identity,
    version: 'review-batches-v1' as const,
    round: 1,
    batches,
  };
  expect(resumableReviewBatches(stored, identity, 1, analysis, paper)).toEqual(
    batches,
  );
  expect(
    resumableReviewBatches(
      {...stored, batches: [batch]},
      identity,
      1,
      analysis,
      paper,
    ),
  ).toEqual([]);
});
