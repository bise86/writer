import {
  applyMasteryCatalogRepairs,
  invalidMasteryCatalogEntries,
} from '../src/challenge/masteryCatalog';
import type {
  ChallengeLevel,
  ChallengePaper,
  ChallengeSubject,
  ExamAnalysis,
  SourceQuestion,
} from '../src/challenge/types';

const cases: {
  subject: ChallengeSubject;
  point: string;
  stem: string;
  id: string;
}[] = [
  {
    subject: 'math',
    point: '等量关系',
    stem: '把1、2、3、4分成两组，每组两个数且和相等。',
    id: 'math_case_completeness',
  },
  {
    subject: 'english',
    point: '词形填空',
    stem: '用括号中单词的适当形式填空。',
    id: 'en_word_form_role',
  },
  {
    subject: 'chinese',
    point: '病句辨析',
    stem: '判断哪一句有成分残缺的语病。',
    id: 'zh_sentence_precision',
  },
  {
    subject: 'physics',
    point: '浮力',
    stem: '根据排开水的体积计算物体所受浮力。',
    id: 'physics_pressure_buoyancy_object',
  },
  {
    subject: 'chemistry',
    point: '溶液质量',
    stem: '给定溶质与水的质量，判断混合后的溶液质量。',
    id: 'chemistry_solution_mass_basis',
  },
  {
    subject: 'biology',
    point: '食物链关系',
    stem: '根据草、兔、鹰的摄食关系确定食物链。',
    id: 'biology_ecosystem_flow_level',
  },
  {
    subject: 'history',
    point: '历史阶段',
    stem: '根据材料比较两个阶段，按发生时间说明因果先后。',
    id: 'hist_time_causality',
  },
  {
    subject: 'geography',
    point: '等高线判读',
    stem: '根据图中的等高线和高度标记，判断两地相对高度。',
    id: 'geography_contour_landform',
  },
  {
    subject: 'politics',
    point: '权利义务',
    stem: '根据材料判断公民的权利与义务是否一致。',
    id: 'pol_right_duty',
  },
  {
    subject: 'science',
    point: '杠杆平衡',
    stem: '根据支点和力臂判断杠杆平衡条件。',
    id: 'science_lever_arm_conditions',
  },
  {
    subject: 'other',
    point: '条件语句',
    stem: '根据给定算法的if条件判断本次执行的分支。',
    id: 'other_algorithm_contract',
  },
];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// These fixtures test metadata permissions; actual question quality remains
// covered by full validator and pipeline regressions.
function fixture(
  data = cases[0],
  educationLevel: ExamAnalysis['educationLevel'] = 'middle',
  level: ChallengeLevel = 1,
) {
  const source: SourceQuestion = {
    id: 'q1',
    number: '7(2)',
    sectionId: 's1',
    type: '解答题',
    stem: data.stem,
    options: [],
    materialIds: [],
    figureIds: [],
    knowledgePoints: [data.point],
    score: 5,
    isListening: false,
    answerLines: 3,
    sourceRefs: [{pageIndex: 0, quote: data.stem}],
    difficulty: {rating: 2, reasoningSteps: 1, explanation: '原范围内的题目。'},
  };
  const analysis: ExamAnalysis = {
    isExam: true,
    title: '原试卷',
    subject: data.subject,
    subjectLabel: data.subject,
    educationLevel,
    knowledgePoints: source.knowledgePoints,
    difficultySummary: '原范围分析',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    sections: [{id: 's1', title: '解答', instructions: ''}],
    materials: [],
    figures: [],
    questions: [source],
    totalScore: 5,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
  };
  const paper: ChallengePaper = {
    title: '新卷',
    subject: data.subject,
    level,
    masteryStatus: 'training_only',
    sections: analysis.sections,
    materials: [],
    figures: [],
    totalScore: 5,
    timeLimitMinutes: null,
    questions: [
      {
        ...source,
        stem: `在原条件下重新辨析：${data.stem}`,
        upgrade: {
          mode: 'upgraded',
          level,
          metrics: {},
          changes: ['增加条件辨析'],
          pitfalls: ['忽略条件'],
          scopeExplanation: '原核心内',
          depthRoute: 'combined',
          directionEvidence: [],
          directionConnections: [],
          depthChecks: [],
        },
      },
    ],
    answers: [
      {
        questionId: 'q1',
        status: 'verified',
        answer: '答案',
        explanation: '核对原题条件，依据给定信息逐项判断。',
        scoringPoints: [],
        learningGuide: [
          {
            knowledgePoint: data.point,
            coreInsight: '本题核心关系必须联系给定条件使用。',
            conditionBoundary: '保留原限制，不能省略其中的适用前提。',
            reasoning: '先检验条件，再根据关系判断结论。',
            problemQuote: data.stem,
            solutionQuote: '依据给定信息逐项判断',
            misconceptions: [
              {
                challengeId: 'wrong_catalog_id',
                wrongApproach: '忽略限制直接套用结论。',
                whyWrong: '缺少适用条件使结论不成立。',
                correction: '先核对原条件再确定结论。',
                solutionQuote: '核对原题条件',
              },
            ],
            transferLinks: [],
            selfChecks: [],
          },
        ],
      },
    ],
  };
  return {analysis, paper};
}
function fixFor(
  target: ReturnType<typeof invalidMasteryCatalogEntries>[number],
  challengeId: string,
  extra: object = {},
) {
  return {
    questionId: target.questionId,
    path: target.path,
    challengeId,
    ...extra,
  };
}

test.each(
  cases.flatMap(data =>
    (['middle', 'high', 'unknown'] as const).flatMap(education =>
      ([1, 2, 3] as const).map(level => ({...data, education, level})),
    ),
  ),
)(
  '$subject / $education / $level档使用同一逐核心目录白名单，修复不改正文',
  data => {
    const {analysis, paper} = fixture(data, data.education, data.level);
    const before = clone(paper);
    const targets = invalidMasteryCatalogEntries(paper, analysis);
    expect(targets).toHaveLength(1);
    expect(targets[0].allowedChallengeIds).toContain(data.id);
    const repaired = applyMasteryCatalogRepairs(paper, analysis, targets, {
      fixes: [fixFor(targets[0], data.id)],
    });
    expect(paper).toEqual(before);
    const expected = clone(before);
    expected.answers[0].learningGuide![0].misconceptions[0].challengeId =
      data.id;
    expect(repaired).toEqual(expected);
    expect(invalidMasteryCatalogEntries(repaired, analysis)).toEqual([]);
  },
);

test.each(['middle', 'unknown'] as const)(
  '%s学段不因原核心带高中关键词而解锁高中专属目录',
  education => {
    const {analysis, paper} = fixture(
      {
        subject: 'math',
        point: '导数最值',
        stem: '利用导数判断区间内最值。',
        id: 'math_derivative_domain_extrema',
      },
      education,
    );
    const targets = invalidMasteryCatalogEntries(paper, analysis);
    expect(targets[0].allowedChallengeIds).not.toContain(
      'math_derivative_domain_extrema',
    );
    expect(targets[0].allowedChallengeIds).toContain('source_specific');
    expect(() =>
      applyMasteryCatalogRepairs(paper, analysis, targets, {
        fixes: [fixFor(targets[0], 'math_derivative_domain_extrema')],
      }),
    ).toThrow('不适用目录不得硬套');
    expect(analysis.educationLevel).toBe(education);
  },
);

test('高中原题确有对应原子核心时仍可使用原有高中目录', () => {
  const {analysis, paper} = fixture(
    {
      subject: 'math',
      point: '导数最值',
      stem: '利用导数判断区间内最值。',
      id: 'math_derivative_domain_extrema',
    },
    'high',
  );
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  expect(targets[0].allowedChallengeIds).toContain(
    'math_derivative_domain_extrema',
  );
});

test('目录缺项允许有原题依据的定制，不能修改原有错因正文或解法', () => {
  const {analysis, paper} = fixture({
    ...cases[0],
    point: '原卷特定构造子点',
  });
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  expect(targets[0].allowedChallengeIds).toEqual(['source_specific']);
  const repaired = applyMasteryCatalogRepairs(paper, analysis, targets, {
    fixes: [
      fixFor(targets[0], 'source_specific', {
        scopeReason:
          '目录未覆盖该原题子点，只检查原有分组的等和及完整性，不用新定理。',
        sourceQuote: ` “${analysis.questions[0].stem}” `,
      }),
    ],
  });
  expect(repaired.answers[0].learningGuide![0].misconceptions[0]).toMatchObject(
    {challengeId: 'source_specific', sourceQuote: analysis.questions[0].stem},
  );
  expect(repaired.answers[0].explanation).toBe(paper.answers[0].explanation);
});

test.each([
  {scopeReason: '', sourceQuote: cases[0].stem},
  {
    scopeReason: '同核心定制',
    sourceQuote: '本题核心关系必须联系给定条件使用。',
  },
  {scopeReason: '同核心定制', sourceQuote: '另一题的条件。'},
])('原题定制不能用空理由、学习说明或别题证明范围：%p', extra => {
  const {analysis, paper} = fixture();
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  expect(() =>
    applyMasteryCatalogRepairs(paper, analysis, targets, {
      fixes: [fixFor(targets[0], 'source_specific', extra)],
    }),
  ).toThrow('sourceQuote');
});

test.each([
  {questionId: 'other'},
  {path: 'answer.explanation'},
  {explanation: '偷偷改写答案'},
  {wrongApproach: '偷偷改写错解'},
  {knowledgePoint: '导数最值'},
  {educationLevel: 'high'},
])('修复白名单阻止更换题号、字段、学段、原核心或正文：%p', extra => {
  const {analysis, paper} = fixture();
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  const before = clone(paper);
  expect(() =>
    applyMasteryCatalogRepairs(paper, analysis, targets, {
      fixes: [fixFor(targets[0], cases[0].id, extra)],
    }),
  ).toThrow('易错目录修复未通过');
  expect(paper).toEqual(before);
});

test('不能借同题另一知识点或同批目录的ID，也不能伪造可用白名单', () => {
  const {analysis, paper} = fixture();
  analysis.questions[0].knowledgePoints.push('概率');
  paper.answers[0].learningGuide!.push({
    ...clone(paper.answers[0].learningGuide![0]),
    knowledgePoint: '概率',
  });
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  expect(targets[1].allowedChallengeIds).toContain('math_probability_base');
  expect(targets[0].allowedChallengeIds).not.toContain('math_probability_base');
  targets[0].allowedChallengeIds.push('math_probability_base');
  expect(() =>
    applyMasteryCatalogRepairs(paper, analysis, targets, {
      fixes: [fixFor(targets[0], 'math_probability_base')],
    }),
  ).toThrow('不适用目录不得硬套');
});

test.each(['retained', 'listening'] as const)(
  '%s原题不参与目录修复或额外模型请求',
  mode => {
    const {analysis, paper} = fixture();
    if (mode === 'retained') {
      paper.questions[0].upgrade.mode = 'retained';
    } else {
      analysis.questions[0].isListening = true;
      paper.questions[0].isListening = true;
    }
    expect(invalidMasteryCatalogEntries(paper, analysis)).toEqual([]);
  },
);

test('目录无法修复可以明确未解决，不能自动把现有内容改成source_specific', () => {
  const {analysis, paper} = fixture();
  const targets = invalidMasteryCatalogEntries(paper, analysis);
  const result = applyMasteryCatalogRepairs(paper, analysis, targets, {
    fixes: [],
    unresolved: [
      {
        questionId: 'q1',
        path: targets[0].path,
        reason: '现有错因涉及原题没有的概念。',
      },
    ],
  });
  expect(result).toEqual(paper);
  expect(invalidMasteryCatalogEntries(result, analysis)).toHaveLength(1);
});
