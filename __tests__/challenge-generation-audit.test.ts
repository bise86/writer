import {
  affectedGenerationIds,
  canResumeGeneration,
  generationCheckpoint,
  generationSeed,
  mergeGenerationPatch,
  questionGenerationOrder,
  questionSuccessorIds,
  sharedAssetRepairIds,
} from '../src/challenge/generation';
import type {ChallengePaper, ExamAnalysis} from '../src/challenge/types';

function fixture(): ExamAnalysis {
  return {
    isExam: true,
    title: '数学试卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    difficultySummary: '等量关系与整数运算',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    knowledgePoints: ['整数运算'],
    sections: [{id: 's', title: '解答题', instructions: '请写出计算过程。'}],
    materials: [],
    figures: [],
    questions: ['q1', 'q2', 'q3', 'q4'].map((id, index) => ({
      id,
      number: String(index + 1),
      sectionId: 's',
      type: '解答题',
      stem: index === 0 ? '求1+1的值。' : '求原式的值。',
      options: [],
      materialIds: [],
      figureIds: [],
      knowledgePoints: ['整数运算'],
      score: 5,
      isListening: false,
      answerLines: 2,
      sourceRefs: [{pageIndex: 0, quote: '原式'}],
      difficulty: {rating: 2, reasoningSteps: 1, explanation: '直接计算。'},
      dependsOnQuestionIds: index === 1 ? ['q1'] : index === 2 ? ['q2'] : [],
    })),
    totalScore: 20,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
    subjectIdentification: {
      status: 'confirmed',
      subject: 'math',
      courseName: '数学',
      integrated: false,
      reason: '原标题与原题一致。',
      evidence: [{pageIndex: 0, quote: '数学试卷'}],
    },
  };
}

function clone(paper: ChallengePaper): ChallengePaper {
  return JSON.parse(JSON.stringify(paper));
}

test('原数组后问在前时先处理前问，组卷数组仍保持原位置', () => {
  const analysis = fixture();
  const [q1, q2, q3, q4] = analysis.questions;
  analysis.questions = [q3, q2, q1, q4];
  expect(
    questionGenerationOrder(
      analysis,
      analysis.questions.map(item => item.id),
    ),
  ).toEqual({orderedIds: ['q1', 'q2', 'q3', 'q4'], blockedIds: []});
  expect(analysis.questions.map(item => item.id)).toEqual([
    'q3',
    'q2',
    'q1',
    'q4',
  ]);
  expect(questionGenerationOrder(analysis, ['q3'])).toEqual({
    orderedIds: ['q3'],
    blockedIds: [],
  });
});

test('无依赖题按源顺序稳定选取，不按题ID或调用者数组重新排题', () => {
  const analysis = fixture();
  const [q1, q2, q3, q4] = analysis.questions;
  analysis.questions = [q4, q3, q2, q1];
  expect(questionGenerationOrder(analysis, ['q3', 'q2', 'q1', 'q4'])).toEqual({
    orderedIds: ['q4', 'q1', 'q2', 'q3'],
    blockedIds: [],
  });
});

test('循环及其后问单独标为不可可靠生成，独立题继续', () => {
  const analysis = fixture();
  analysis.questions[0].dependsOnQuestionIds = ['q2'];
  expect(
    questionGenerationOrder(
      analysis,
      analysis.questions.map(item => item.id),
    ),
  ).toEqual({orderedIds: ['q4'], blockedIds: ['q1', 'q2', 'q3']});
});

test('缺失前问及其后继不能使用原题占位结果盲目生成', () => {
  const analysis = fixture();
  analysis.questions[0].dependsOnQuestionIds = ['missing'];
  expect(questionGenerationOrder(analysis, ['q1', 'q2', 'q3', 'q4'])).toEqual({
    orderedIds: ['q4'],
    blockedIds: ['q1', 'q2', 'q3'],
  });
  expect(questionGenerationOrder(analysis, ['unrecognized'])).toEqual({
    orderedIds: [],
    blockedIds: ['unrecognized'],
  });
});

test('修订前问需包含全部传递后问，候选过滤不会截断中间依赖', () => {
  const analysis = fixture();
  expect([...questionSuccessorIds(analysis, ['q1'])]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
  expect([...questionSuccessorIds(analysis, ['q1'], ['q1', 'q3'])]).toEqual([
    'q1',
    'q3',
  ]);
  analysis.questions[0].dependsOnQuestionIds = ['q3'];
  expect([...questionSuccessorIds(analysis, ['q1'])]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
});

test('修订或回滚前问题文均使依赖旧结果的后问失效', () => {
  const analysis = fixture();
  const original = generationSeed(analysis, 1);
  const upgraded = clone(original);
  upgraded.questions[0].stem = '求2+2的值并说明运算依据。';
  upgraded.questions[0].upgrade.mode = 'upgraded';
  expect([...affectedGenerationIds(analysis, original, upgraded)]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
  expect([...affectedGenerationIds(analysis, upgraded, original)]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
});

test('只更正前问答案结果时后问也不能继续使用旧结论', () => {
  const analysis = fixture();
  const before = generationSeed(analysis, 1);
  const after = clone(before);
  before.answers[0].answer = '4';
  after.answers[0].answer = '6';
  expect([...affectedGenerationIds(analysis, before, after)]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
});

test('保留一道共享材料题导致材料回滚时，其它使用者及后问同时失效', () => {
  const analysis = fixture();
  analysis.materials = [
    {
      id: 'm',
      title: '分组条件',
      text: '每组有2人。',
      isListening: false,
      figureIds: [],
    },
  ];
  analysis.questions[0].materialIds = ['m'];
  analysis.questions[3].materialIds = ['m'];
  const original = generationSeed(analysis, 1);
  const changed = clone(original);
  changed.materials[0].text = '每组有4人。';
  expect([...affectedGenerationIds(analysis, changed, original)]).toEqual([
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
});

test('材料内图形变化也会使未直接声明figureIds的题及后问失效', () => {
  const analysis = fixture();
  analysis.materials = [
    {
      id: 'm',
      title: '分组条件',
      text: '按图分组。',
      isListening: false,
      figureIds: ['f'],
    },
  ];
  analysis.figures = [
    {
      id: 'f',
      kind: 'source',
      pageIndex: 0,
      box: {x: 0, y: 0, width: 1, height: 1},
      caption: '每组有2人。',
      containsStudentMarks: false,
    },
  ];
  analysis.questions[0].materialIds = ['m'];
  const before = generationSeed(analysis, 1);
  const after = clone(before);
  after.figures[0].caption = '每组有4人。';
  expect([...affectedGenerationIds(analysis, before, after)]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
});

test('修改作答说明会关联到本节各题，纯升档说明及引文元数据不误判条件变化', () => {
  const analysis = fixture();
  const before = generationSeed(analysis, 1);
  const metadata = clone(before);
  metadata.questions[0].upgrade.retentionReason = '更新保留原因。';
  metadata.questions[0].upgrade.directionEvidence = [];
  expect([...affectedGenerationIds(analysis, before, metadata)]).toEqual([]);
  expect([
    ...affectedGenerationIds(analysis, before, metadata, ['q1']),
  ]).toEqual(['q1', 'q2', 'q3']);
  const instructions = clone(before);
  instructions.sections[0].instructions = '请写出计算过程与依据。';
  expect([...affectedGenerationIds(analysis, before, instructions)]).toEqual([
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
});

test('修订断点保留待修题与评审反馈，旧生成断点仍可恢复', () => {
  const analysis = fixture();
  const feedback = {
    issues: [{questionId: 'q1', comment: '更正前问后同步后问。'}],
  };
  const pending = ['q1', 'q2', 'q3'];
  const checkpoint = generationCheckpoint(
    analysis,
    1,
    ['q1', 'q2', 'q3', 'q4'],
    generationSeed(analysis, 1),
    {phase: 'repair', pendingQuestionIds: pending, feedback},
  );
  pending.pop();
  const saved = JSON.parse(JSON.stringify(checkpoint));
  expect(canResumeGeneration(saved, analysis, 1)).toBe(true);
  expect(saved).toMatchObject({
    phase: 'repair',
    pendingQuestionIds: ['q1', 'q2', 'q3'],
    feedback,
  });
  const legacy = generationCheckpoint(
    analysis,
    1,
    ['q1'],
    generationSeed(analysis, 1),
  );
  delete legacy.phase;
  delete legacy.integrityVersion;
  expect(canResumeGeneration(legacy, analysis, 1)).toBe(true);
});

test('新断点标记答案一致性协议2，旧无标记可迁移，未知协议不能复用', () => {
  const analysis = fixture();
  const checkpoint = generationCheckpoint(
    analysis,
    1,
    ['q1'],
    generationSeed(analysis, 1),
  );
  expect(checkpoint.integrityVersion).toBe(2);
  expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(true);
  expect(
    canResumeGeneration(
      {...checkpoint, integrityVersion: undefined},
      analysis,
      1,
    ),
  ).toBe(true);
  for (const integrityVersion of [0, 1, 3]) {
    expect(
      canResumeGeneration({...checkpoint, integrityVersion}, analysis, 1),
    ).toBe(false);
  }
});

test.each([['q1', 'q1'], ['missing']] as string[][])(
  '待修ID非法或重复时拒绝复用断点：%j',
  (...pendingQuestionIds) => {
    const analysis = fixture();
    const checkpoint = generationCheckpoint(
      analysis,
      1,
      ['q1', 'q2', 'q3', 'q4'],
      generationSeed(analysis, 1),
      {phase: 'repair', pendingQuestionIds},
    );
    expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(false);
  },
);

test('修订断点丢失pending数组时不能当作已修完继续发布', () => {
  const analysis = fixture();
  const checkpoint = generationCheckpoint(
    analysis,
    1,
    ['q1', 'q2', 'q3', 'q4'],
    generationSeed(analysis, 1),
    {phase: 'repair'},
  );
  expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(false);
});

test('引文修复断点保留未验证候选，仅用合法题ID和返回阶段确定恢复方式', () => {
  const analysis = fixture();
  const candidate = generationSeed(analysis, 1);
  candidate.questions[0].upgrade.mode = 'upgraded';
  candidate.questions[0].stem = '完整新题尚待修正引文。';
  const checkpoint = generationCheckpoint(analysis, 1, [], candidate, {
    phase: 'evidence',
    pendingQuestionIds: ['q1', 'q2', 'q3', 'q4'],
    evidenceQuestionIds: ['q1'],
    afterEvidencePhase: 'generation',
  });
  expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(true);
  expect(checkpoint.paper.questions[0].stem).toBe('完整新题尚待修正引文。');
  expect(
    canResumeGeneration(
      {...checkpoint, evidenceQuestionIds: ['q1', 'q1']},
      analysis,
      1,
    ),
  ).toBe(false);
  expect(
    canResumeGeneration(
      {...checkpoint, evidenceQuestionIds: ['missing']},
      analysis,
      1,
    ),
  ).toBe(false);
  expect(
    canResumeGeneration(
      {...checkpoint, afterEvidencePhase: undefined},
      analysis,
      1,
    ),
  ).toBe(false);
});

function upgradedPaper(analysis: ExamAnalysis): ChallengePaper {
  const paper = clone(generationSeed(analysis, 1));
  paper.questions.forEach(question => {
    question.upgrade.mode = 'upgraded';
  });
  paper.answers.forEach(answer => {
    answer.status = 'verified';
    answer.answer = '已核结论';
    answer.explanation = '按当前题文与材料独立计算。';
    answer.scoringPoints = ['计算过程正确'];
  });
  return paper;
}

function sharedMaterialFixture() {
  const analysis = fixture();
  analysis.materials = [
    {
      id: 'm',
      title: '共同条件',
      text: '每组有2人。',
      isListening: false,
      figureIds: [],
    },
  ];
  analysis.questions[0].materialIds = ['m'];
  analysis.questions[3].materialIds = ['m'];
  const current = upgradedPaper(analysis);
  current.materials[0].text = '每组有4人。';
  const patch = {
    questions: [current.questions[0]],
    answers: [current.answers[0]],
    materials: [{...current.materials[0], text: '每组有3人。'}],
  };
  return {analysis, current, patch};
}

test('共享条件返修可跨小批次改动，但所有直接及依赖用户必须纳入整轮修订', () => {
  const {analysis, current, patch} = sharedMaterialFixture();
  expect(() =>
    mergeGenerationPatch(
      patch,
      analysis,
      current,
      ['q1'],
      ['q1', 'q2', 'q3', 'q4'],
    ),
  ).toThrow('其它批次或保留题');
  expect(() =>
    mergeGenerationPatch(
      patch,
      analysis,
      current,
      ['q1'],
      ['q1', 'q2', 'q3', 'q4'],
      {
        assetRepairQuestionIds: ['q1', 'q4'],
      },
    ),
  ).toThrow('其它批次或保留题');
  const repaired = mergeGenerationPatch(
    patch,
    analysis,
    current,
    ['q1'],
    ['q1', 'q2', 'q3', 'q4'],
    {assetRepairQuestionIds: ['q1', 'q2', 'q3', 'q4']},
  );
  expect(repaired.materials[0].text).toBe('每组有3人。');
  expect(current.materials[0].text).toBe('每组有4人。');
});

test.each(['retained', 'mandatory', 'listening'] as const)(
  '跨批共享资产返修不允许影响%s原题',
  reason => {
    const {analysis, current, patch} = sharedMaterialFixture();
    if (reason === 'retained') {
      current.questions[3].upgrade.mode = 'retained';
    } else if (reason === 'mandatory') {
      analysis.questions[3].upgradeEligibility = 'retain';
      analysis.questions[3].retentionReason = '保持原有条件。';
    } else {
      analysis.questions[3].isListening = true;
      current.questions[3].isListening = true;
    }
    expect(() =>
      mergeGenerationPatch(
        patch,
        analysis,
        current,
        ['q1'],
        ['q1', 'q2', 'q3', 'q4'],
        {
          assetRepairQuestionIds: ['q1', 'q2', 'q3', 'q4'],
        },
      ),
    ).toThrow('其它批次或保留题');
  },
);

test('同轮先修好的资产锁定，后批只能原样沿用，不能来回改动共同条件', () => {
  const {analysis, current, patch} = sharedMaterialFixture();
  const options = {
    assetRepairQuestionIds: ['q1', 'q2', 'q3', 'q4'],
    lockedAssetIds: ['materials:m'],
  };
  expect(() =>
    mergeGenerationPatch(
      patch,
      analysis,
      current,
      ['q1'],
      ['q1', 'q2', 'q3', 'q4'],
      options,
    ),
  ).toThrow('本轮已修订并锁定');
  patch.materials = [current.materials[0]];
  expect(
    mergeGenerationPatch(
      patch,
      analysis,
      current,
      ['q1'],
      ['q1', 'q2', 'q3', 'q4'],
      options,
    ).materials,
  ).toEqual(current.materials);
});

test('续修范围不沿已锁资产重拉已完成题，显式前问依赖的后继仍须重算', () => {
  const {analysis, current} = sharedMaterialFixture();
  expect([...sharedAssetRepairIds(analysis, current, ['q4'])]).toEqual([
    'q1', 'q2', 'q3', 'q4',
  ]);
  expect([
    ...sharedAssetRepairIds(analysis, current, ['q4'], ['materials:m']),
  ]).toEqual(['q4']);
  expect([
    ...sharedAssetRepairIds(analysis, current, ['q1'], ['materials:m']),
  ]).toEqual(['q1', 'q2', 'q3']);
});

test('多个已变共享条件迭代扩展修订范围，未改资产不额外扩展', () => {
  const analysis = fixture();
  analysis.questions.forEach(question => (question.dependsOnQuestionIds = []));
  analysis.questions[2].dependsOnQuestionIds = ['q2'];
  analysis.materials = ['m1', 'm2'].map(id => ({
    id,
    title: id,
    text: '原共同条件。',
    isListening: false,
    figureIds: [],
  }));
  analysis.questions[0].materialIds = ['m1'];
  analysis.questions[1].materialIds = ['m1', 'm2'];
  analysis.questions[3].materialIds = ['m2'];
  const current = upgradedPaper(analysis);
  current.materials[0].text = '第一份变式条件。';
  expect([...sharedAssetRepairIds(analysis, current, ['q1'])]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
  current.materials[1].text = '第二份变式条件。';
  expect([...sharedAssetRepairIds(analysis, current, ['q1'])]).toEqual([
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
  current.questions[3].upgrade.mode = 'retained';
  expect([...sharedAssetRepairIds(analysis, current, ['q1'])]).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
});

test('同批前问被保留规范化回退时暴露意图与实际变化，供后问再次生成', () => {
  const analysis = fixture();
  analysis.questions[2].dependsOnQuestionIds = ['q1'];
  const seed = generationSeed(analysis, 1);
  const intended = upgradedPaper(analysis);
  intended.questions[0].stem = '求2+2的值。';
  intended.questions[2].stem = '按前问所得4计算两倍。';
  const snapshots: {intent: ChallengePaper; normalized: ChallengePaper}[] = [];
  const sourceBefore = JSON.stringify(analysis);
  const seedBefore = JSON.stringify(seed);
  const result = mergeGenerationPatch(
    {
      questions: [intended.questions[0], intended.questions[2]],
      answers: [intended.answers[0], intended.answers[2]],
    },
    analysis,
    seed,
    ['q1', 'q2', 'q3'],
    [],
    {onNormalize: (intent, normalized) => snapshots.push({intent, normalized})},
  );
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].intent.questions[0].upgrade.mode).toBe('upgraded');
  expect(result.questions[0].upgrade.mode).toBe('retained');
  expect(
    affectedGenerationIds(
      analysis,
      snapshots[0].intent,
      snapshots[0].normalized,
    ),
  ).toContain('q3');
  expect(JSON.stringify(analysis)).toBe(sourceBefore);
  expect(JSON.stringify(seed)).toBe(seedBefore);
});

test('断点保留同轮共享资产锁与引文候选基础稿，拒绝伪造或重复资产ID', () => {
  const {analysis, current} = sharedMaterialFixture();
  const locks = ['materials:m'];
  const checkpoint = generationCheckpoint(analysis, 1, ['q1'], current, {
    phase: 'evidence',
    pendingQuestionIds: ['q2', 'q3', 'q4'],
    evidenceQuestionIds: ['q1'],
    afterEvidencePhase: 'repair',
    evidenceBasePaper: generationSeed(analysis, 1),
    lockedAssetIds: locks,
  });
  locks.pop();
  expect(checkpoint.lockedAssetIds).toEqual(['materials:m']);
  expect(checkpoint.evidenceBasePaper!.questions[0].stem).toBe(
    analysis.questions[0].stem,
  );
  expect(canResumeGeneration(checkpoint, analysis, 1)).toBe(true);
  for (const lockedAssetIds of [
    ['m'],
    ['figures:m'],
    ['materials:unknown'],
    ['materials:m', 'materials:m'],
  ]) {
    expect(
      canResumeGeneration({...checkpoint, lockedAssetIds}, analysis, 1),
    ).toBe(false);
  }
});
