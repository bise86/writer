import {
  applyEvidenceQuoteRepairs,
  canonicalEvidenceQuote,
  canonicalizePaperEvidence,
  exactEvidenceQuote,
  invalidEvidenceQuotes,
  questionEvidenceSources,
} from '../src/challenge/evidence';
import type {ChallengePaper, ExamAnalysis} from '../src/challenge/types';

function fixture() {
  const source = {
    id: 'q1',
    number: '12(2)',
    sectionId: 's1',
    type: '解答题',
    stem: '已知x²≤4，求x的取值范围。',
    options: [],
    materialIds: ['m1'],
    figureIds: ['f1'],
    knowledgePoints: ['不等式的取值范围'],
    score: 5,
    isListening: false,
    answerLines: 3,
    sourceRefs: [{pageIndex: 0, quote: '已知x²≤4'}],
    difficulty: {
      rating: 3,
      reasoningSteps: 1,
      explanation: '原定义域内解不等式。',
    },
  };
  const analysis: ExamAnalysis = {
    isExam: true,
    title: '数学',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    knowledgePoints: source.knowledgePoints,
    difficultySummary: '直接判断范围',
    difficultyBasis: 'estimated',
    answerState: 'blank',
    sections: [{id: 's1', title: '解答', instructions: ''}],
    materials: [
      {
        id: 'm1',
        title: '原条件',
        text: 'x为实数。',
        isListening: false,
        figureIds: [],
      },
      {
        id: 'other',
        title: '无关材料',
        text: '不关联的材料不能证明本题。',
        isListening: false,
        figureIds: [],
      },
    ],
    figures: [
      {
        id: 'f1',
        kind: 'source',
        pageIndex: 0,
        box: {x: 0.1, y: 0.1, width: 0.2, height: 0.2},
        caption: '数轴端点为-2和2。',
        containsStudentMarks: false,
      },
    ],
    questions: [
      source,
      {...source, id: 'q2', number: '13', stem: '另一题独有的条件。'},
    ],
    totalScore: 10,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
  };
  const paper: ChallengePaper = {
    title: '新卷',
    subject: 'math',
    level: 1,
    sections: analysis.sections,
    materials: analysis.materials,
    figures: analysis.figures,
    totalScore: 10,
    timeLimitMinutes: null,
    questions: [source, analysis.questions[1]].map((item, index) => ({
      ...item,
      stem: index
        ? '另一题的新条件。'
        : '在原取值范围内再要求x>0，求满足全部条件的x。',
      upgrade: {
        mode: 'upgraded',
        level: 1,
        metrics: {},
        changes: ['辨析正数限制'],
        pitfalls: ['遗漏边界'],
        scopeExplanation: '同一范围',
        depthRoute: 'combined',
        directionEvidence: [],
        directionConnections: [],
        depthChecks: [],
      },
    })),
    answers: [
      {
        questionId: 'q1',
        status: 'verified',
        answer: '0<x≤2（仅结果，不作为解析依据）',
        explanation:
          '由x²≤4且x>0，可得0<x≤2。\n逐一核对定义域、正数限制和端点，x=2满足原条件。',
        scoringPoints: ['需满足原定义域和新增的正数限制。'],
        learningGuide: [
          {
            knowledgePoint: source.knowledgePoints[0],
            coreInsight: '只在学习说明出现的独有原理句子。',
            conditionBoundary: '定义域与正数限制必须同时成立。',
            reasoning: '先求原范围，再筛选正数。',
            problemQuote: '再要求x>0',
            solutionQuote: '由x²≤4且x>0，可得0<x≤2。',
            misconceptions: [
              {
                challengeId: 'source_specific',
                scopeReason: '原题范围之内的正数限制',
                sourceQuote: '已知x²≤4',
                wrongApproach: '只按原范围填写',
                whyWrong: '忽略新增正数限制',
                correction: '求两个条件的交集',
                solutionQuote: '可得0<x≤2',
              },
            ],
            transferLinks: [
              {
                kind: 'source_to_variant',
                originalCondition: '仅满足原不等式',
                changedCondition: '新增正数限制',
                invariant: '定义域仍为实数',
                adaptation: '筛除非正数部分',
                sourceQuote: '已知x²≤4',
                problemQuote: '再要求x>0',
                solutionQuote: '可得0<x≤2',
              },
            ],
            selfChecks: [
              {
                kind: 'conditions',
                method: '把端点代回两个条件',
                expected: '端点2都满足',
                solutionQuote: 'x=2满足原条件',
              },
            ],
          },
        ],
      },
      {
        questionId: 'q2',
        status: 'verified',
        answer: '另一结果',
        explanation: '第二题独有的解答依据。',
        scoringPoints: [],
        learningGuide: [],
      },
    ],
  };
  return {analysis, paper};
}

test('每题来源严格分开原题、新题与解析，不混入学习说明、裸答案、别题或无关材料', () => {
  const {analysis, paper} = fixture();
  const evidence = questionEvidenceSources(
    analysis.questions[0],
    paper.questions[0],
    analysis,
    paper.materials,
    paper.figures,
    paper.answers[0],
  );
  expect(evidence.original.map(source => source.text)).toContain(
    '已知x²≤4，求x的取值范围。',
  );
  expect(evidence.problem.map(source => source.text)).toContain(
    paper.questions[0].stem,
  );
  expect(evidence.solution.map(source => source.text)).toEqual([
    paper.answers[0].explanation,
    ...paper.answers[0].scoringPoints,
  ]);
  expect(JSON.stringify(evidence)).not.toContain('只在学习说明出现');
  expect(JSON.stringify(evidence)).not.toContain('仅结果');
  expect(JSON.stringify(evidence)).not.toContain('第二题独有');
  expect(JSON.stringify(evidence)).not.toContain('不关联的材料');
  expect(evidence.original.map(source => source.text)).toContain(
    '数轴端点为-2和2。',
  );
});

test.each([
  [
    ' “x²≤4且x>0， 可得0<x≤2。” ',
    '由x²≤4且x>0，\n可得0<x≤2。',
    'x²≤4且x>0，\n可得0<x≤2。',
  ],
  ['每组 和相等', '先确定每组和相等。', '每组和相等'],
  [
    'work with the given data',
    'Please work\nwith  the given data.',
    'work\nwith  the given data',
  ],
  [' x > 0 ', '限制为x>0。', 'x>0'],
])('纯排版差异还原为真实连续原句：%s', (quote, original, expected) => {
  expect(
    canonicalEvidenceQuote(quote, [
      {id: 's', field: 'solution.explanation', text: original},
    ]),
  ).toBe(expected);
});

test.each([
  ['x2≤4', 'x²≤4'],
  ['x<4', 'x≤4'],
  ['x≥4', 'x≤4'],
  ['x=-2', 'x=2'],
  ['x=20', 'x=2'],
  ['nowhere', 'now here'],
  ['ab', 'a b'],
  ['wrong', 'Wrong'],
  ['条件成立', '条件不成立'],
  ['甲条件……丙条件', '甲条件。乙条件。丙条件。'],
])('不模糊匹配公式、数字、否定、词边界或拼接引文：%s', (quote, original) => {
  expect(
    canonicalEvidenceQuote(quote, [{id: 's', field: 's', text: original}]),
  ).toBeUndefined();
});

test.each([
  ['x=2', 'x=20'],
  ['x=2', 'x=2.5'],
  ['x>0', 'x>0.5'],
  ['x=2', 'x=2. 5'],
  ['2', '-2'],
  ['2', '− 2'],
  ['5', '.5'],
  ['x=1', 'x=1,000'],
  ['x=2', 'x=2²'],
  ['x=2', 'x=2^3'],
  ['x=2', 'x=2 ^ 3'],
  ['x=2', 'x=2%'],
  ['work', 'homework'],
  ['possible', 'impossible'],
  ['valid', 'invalid'],
  ['can', "can't"],
  ['can', 'can’t'],
  ['t', "don't"],
  ['zero', 'non-zero'],
])('不把数字或英文词内部的截断片段当作完整引文：%s / %s', (quote, original) => {
  const sources = [{id: 's', field: 's', text: original}];
  expect(exactEvidenceQuote(quote, sources)).toBe(false);
  expect(canonicalEvidenceQuote(quote, sources)).toBeUndefined();
});

test.each([
  ['x = 2', 'x=20'],
  ['x > 0', 'x>0.5'],
  ['x = 2', 'x=2²'],
  ['x = 2', 'x=2. 5'],
])('排版还原也不能截断数字或公式：%s / %s', (quote, original) => {
  expect(
    canonicalEvidenceQuote(quote, [{id: 's', field: 's', text: original}]),
  ).toBeUndefined();
});

test.each([
  ['x>0', '满足x>0且x≤2', 'x>0'],
  ['x>0', '（x>0）', 'x>0'],
  ['2', 'The answer is 2.', '2'],
  ['can', 'You can work with the data.', 'can'],
  ["can't", "You can't remove this condition.", "can't"],
  ['x=2', '先排除x=20；最后得到x=2。', 'x=2'],
  ['x = 2', '先排除x=20；最后得到x=2。', 'x=2'],
])(
  '保留完整合法子句，并在前一个匹配截断时继续寻找：%s',
  (quote, original, expected) => {
    const sources = [{id: 's', field: 's', text: original}];
    expect(canonicalEvidenceQuote(quote, sources)).toBe(expected);
    expect(exactEvidenceQuote(expected, sources)).toBe(true);
  },
);

test('引文修复拒绝把错误数字匹配到更长的真实数值中', () => {
  const {analysis, paper} = fixture();
  paper.answers[0].explanation = '最终得到x=20，且必须核查边界。';
  paper.answers[0].scoringPoints = [];
  paper.answers[0].learningGuide![0].solutionQuote = 'x=2';
  const targets = invalidEvidenceQuotes(paper, analysis, ['q1']).filter(
    target => target.path === 'answer.learningGuide[0].solutionQuote',
  );
  expect(targets).toHaveLength(1);
  expect(() =>
    applyEvidenceQuoteRepairs(paper, analysis, targets, {
      fixes: [
        {
          questionId: 'q1',
          path: targets[0].path,
          sourceId: 'solution:explanation',
          quote: 'x = 2',
        },
      ],
    }),
  ).toThrow('真实连续原句');
});

test('自动还原只改变引文字段，原题、新题、解答与学习说明正文均不变', () => {
  const {analysis, paper} = fixture();
  paper.answers[0].learningGuide![0].solutionQuote =
    ' “由x²≤4且x>0， 可得0<x≤2。” ';
  const copy = canonicalizePaperEvidence(paper, analysis);
  expect(copy.answers[0].learningGuide![0].solutionQuote).toBe(
    '由x²≤4且x>0，可得0<x≤2。',
  );
  expect(copy.answers[0].explanation).toBe(paper.answers[0].explanation);
  expect(copy.questions[0].stem).toBe(paper.questions[0].stem);
  expect(copy.answers[0].learningGuide![0].coreInsight).toBe(
    paper.answers[0].learningGuide![0].coreInsight,
  );
  expect(paper.answers[0].learningGuide![0].solutionQuote).toContain('“');
  expect(invalidEvidenceQuotes(copy, analysis)).toEqual([]);
});

test('可以只修复指定题的具体引文，不能修改正文、自证或拿错来源类型', () => {
  const {analysis, paper} = fixture();
  const guide = paper.answers[0].learningGuide![0];
  guide.solutionQuote = guide.coreInsight;
  const targets = invalidEvidenceQuotes(paper, analysis, ['q1']);
  expect(targets).toHaveLength(1);
  expect(targets[0]).toMatchObject({
    questionNumber: '12(2)',
    path: 'answer.learningGuide[0].solutionQuote',
    origin: 'solution',
  });
  const fix = {
    questionId: 'q1',
    path: targets[0].path,
    sourceId: 'solution:explanation',
    quote: '可得0<x≤2',
  };
  const result = applyEvidenceQuoteRepairs(paper, analysis, targets, {
    fixes: [fix],
  });
  expect(result.answers[0].learningGuide![0].solutionQuote).toBe('可得0<x≤2');
  expect(result.answers[0].explanation).toBe(paper.answers[0].explanation);
  expect(result.answers[0].learningGuide![0].coreInsight).toBe(
    guide.coreInsight,
  );
  expect(result.questions).toEqual(paper.questions);
  expect(result.answers[1]).toEqual(paper.answers[1]);
  expect(guide.solutionQuote).toBe(guide.coreInsight);
  for (const value of [
    {fixes: [{...fix, quote: guide.coreInsight}]},
    {
      fixes: [
        {...fix, sourceId: 'original:stem', quote: analysis.questions[0].stem},
      ],
    },
    {fixes: [{...fix, questionId: 'q2', quote: paper.answers[1].explanation}]},
    {fixes: [{...fix, path: 'answer.explanation'}]},
    {fixes: [fix], answers: [{explanation: guide.coreInsight}]},
    {fixes: [fix, fix]},
  ]) {
    expect(() =>
      applyEvidenceQuoteRepairs(paper, analysis, targets, value),
    ).toThrow('引文修复未通过');
  }
});

test('原有解析不足时保留未解决字段，修复器不自动把学习说明附加进解析', () => {
  const {analysis, paper} = fixture();
  paper.answers[0].learningGuide![0].solutionQuote = '仅学习说明中的推理';
  const targets = invalidEvidenceQuotes(paper, analysis);
  const result = applyEvidenceQuoteRepairs(paper, analysis, targets, {
    fixes: [],
    unresolved: [
      {
        questionId: targets[0].questionId,
        path: targets[0].path,
        reason: '现有独立解析没有论据',
      },
    ],
  });
  expect(result).toEqual(paper);
  expect(invalidEvidenceQuotes(result, analysis)).toHaveLength(1);
});

test('保留题不参与引文修复，不让原题消耗额外模型请求', () => {
  const {analysis, paper} = fixture();
  paper.questions[0].upgrade.mode = 'retained';
  paper.answers[0].learningGuide![0].solutionQuote = '原题待核无需生成依据';
  expect(invalidEvidenceQuotes(paper, analysis)).toEqual([]);
});
