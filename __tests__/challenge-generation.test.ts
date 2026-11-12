import {
  canResumeGeneration,
  generationAnalysis,
  generationCheckpoint,
  generationSeed,
  mergeGenerationPatch,
} from '../src/challenge/generation';
import type {ExamAnalysis} from '../src/challenge/types';

function fixture(): ExamAnalysis {
  const questions = ['q1', 'q2'].map((id, index) => ({
    id,
    number: String(index + 1),
    sectionId: 's',
    type: '解答题',
    stem: `第${index + 1}题原条件`,
    options: [],
    materialIds: ['m'],
    figureIds: [],
    knowledgePoints: ['等量关系'],
    score: 5,
    isListening: false,
    answerLines: 2,
    sourceRefs: [{pageIndex: 0, quote: '原条件'}],
    difficulty: {
      rating: 2,
      reasoningSteps: 1,
      explanation: '直接运用等量关系。',
    },
  }));
  return {
    isExam: true,
    title: '数学试卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    difficultySummary: '原范围内的基础题',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    knowledgePoints: ['等量关系'],
    sections: [{id: 's', title: '解答题', instructions: ''}],
    materials: [
      {
        id: 'm',
        title: '原共享条件',
        text: '两个数的和为10。',
        isListening: false,
        figureIds: [],
      },
    ],
    figures: [],
    questions,
    totalScore: 10,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
    subjectIdentification: {
      status: 'confirmed',
      subject: 'math',
      courseName: '数学',
      integrated: false,
      reason: '由原标题和抽样确认',
      evidence: [{pageIndex: 0, quote: '数学试卷'}],
    },
  };
}

function patch(source: ExamAnalysis, id = 'q1') {
  const question = source.questions.find(item => item.id === id)!;
  return {
    questions: [
      {
        ...question,
        stem: `${question.stem}，加入边界条件辨析。`,
        upgrade: {
          mode: 'upgraded',
          level: 1,
          metrics: {},
          changes: ['条件辨析'],
          pitfalls: ['遗漏边界'],
          scopeExplanation: '同范围',
        },
      },
    ],
    answers: [
      {
        questionId: id,
        status: 'verified',
        answer: '参考结论',
        explanation: '独立核验条件后得出。',
        scoringPoints: ['边界合法'],
      },
    ],
  };
}

test('只传升级补丁也能完整组卷；遗漏原题保持原位置与原文', () => {
  const source = fixture();
  const original = JSON.stringify(source);
  const result = mergeGenerationPatch(
    patch(source),
    source,
    generationSeed(source, 1),
    ['q1'],
    [],
  );
  expect(result.questions.map(question => question.id)).toEqual(['q1', 'q2']);
  expect(result.questions[0].stem).toContain('边界条件');
  expect(result.questions[1].stem).toBe(source.questions[1].stem);
  expect(result.questions[1].upgrade.mode).toBe('retained');
  expect(result.answers[1]).toMatchObject({
    status: 'requires_review',
    answer: '',
  });
  expect(JSON.stringify(source)).toBe(original);
});

test('同一批次不能写入其它题或伪造新的题ID', () => {
  const source = fixture();
  expect(() =>
    mergeGenerationPatch(
      patch(source, 'q2'),
      source,
      generationSeed(source, 1),
      ['q1'],
      [],
    ),
  ).toThrow('本批只能返回');
  const value = patch(source);
  value.questions[0].id = 'invented';
  expect(() =>
    mergeGenerationPatch(value, source, generationSeed(source, 1), ['q1'], []),
  ).toThrow('原卷题ID');
});

test('分批不得改动其它题仍在使用的共享材料', () => {
  const source = fixture();
  const value = {
    ...patch(source),
    materials: [{...source.materials[0], text: '把和改为20。'}],
  };
  expect(() =>
    mergeGenerationPatch(value, source, generationSeed(source, 1), ['q1'], []),
  ).toThrow('其它批次或保留题');
});

test('只通过前问间接使用的材料也要冻结，避免后批保留题导致前批条件失配', () => {
  const source = fixture();
  source.questions[1].materialIds = [];
  source.questions[1].dependsOnQuestionIds = ['q1'];
  const value = {
    ...patch(source),
    materials: [{...source.materials[0], text: '把和改为20。'}],
  };
  expect(() =>
    mergeGenerationPatch(value, source, generationSeed(source, 1), ['q1'], []),
  ).toThrow('其它批次或保留题');
});

test('未处理的前问依赖不回滚已完成变式，确认保留后再冻结必要原前问', () => {
  const source = fixture();
  source.questions[1].dependsOnQuestionIds = ['q1'];
  const first = mergeGenerationPatch(
    patch(source),
    source,
    generationSeed(source, 1),
    ['q1'],
    [],
  );
  expect(first.questions[0].upgrade.mode).toBe('upgraded');
  const final = mergeGenerationPatch(
    {questions: [], answers: []},
    source,
    first,
    ['q2'],
    ['q1'],
  );
  expect(final.questions[0].upgrade.mode).toBe('retained');
  expect(final.questions[0].stem).toBe(source.questions[0].stem);
  expect(final.questions[0].upgrade.retentionReason).not.toContain('解析');
});

test('显式返回保留题的旧格式也不能改写原题或把猜测答案当真值', () => {
  const source = fixture();
  const value = patch(source);
  value.questions[0].upgrade.mode = 'retained';
  value.questions[0].stem = '模型试图改写原题';
  const result = mergeGenerationPatch(
    value,
    source,
    generationSeed(source, 1),
    ['q1'],
    [],
  );
  expect(result.questions[0].stem).toBe(source.questions[0].stem);
  expect(result.answers[0]).toMatchObject({
    status: 'requires_review',
    answer: '',
  });
});

test('原卷、档次或规则不匹配不复用草稿；题框调整不会使已验证内容失效', () => {
  const source = fixture();
  const checkpoint = generationCheckpoint(
    source,
    1,
    ['q1'],
    generationSeed(source, 1),
  );
  expect(canResumeGeneration(checkpoint, source, 1)).toBe(true);
  expect(canResumeGeneration(checkpoint, source, 2)).toBe(false);
  const changed = fixture();
  changed.questions[0].stem += '新的原条件';
  expect(canResumeGeneration(checkpoint, changed, 1)).toBe(false);
  expect(
    canResumeGeneration({...checkpoint, policyVersion: 'old'}, source, 1),
  ).toBe(false);
  expect(
    canResumeGeneration(
      {...checkpoint, completedQuestionIds: ['unknown']},
      source,
      1,
    ),
  ).toBe(false);
  source.questions[0].originalRegions = [
    {pageIndex: 0, box: {x: 0, y: 0, width: 1, height: 1}},
  ];
  expect(canResumeGeneration(checkpoint, source, 1)).toBe(true);
});

test('干净原题无需增加整页原图，带作答图的保留题才补原图后备', () => {
  const source = fixture();
  expect(
    generationAnalysis(source).questions[0].originalRegions,
  ).toBeUndefined();
  source.figures = [
    {
      id: 'f',
      kind: 'source',
      pageIndex: 0,
      box: {x: 0.1, y: 0.2, width: 0.8, height: 0.3},
      caption: '原图',
      containsStudentMarks: true,
    },
  ];
  source.questions[0].figureIds = ['f'];
  const prepared = generationAnalysis(source);
  expect(prepared.questions[0].originalRegions).toHaveLength(1);
  expect(prepared.questions[1].originalRegions).toBeUndefined();
  expect(prepared.questions[0].analysisIssues).toEqual([]);
});
