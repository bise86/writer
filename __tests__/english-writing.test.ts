import englishRules from '../src/assets/english-scoring-rules.json';
import highEnglishRules from '../src/assets/high-english-scoring-rules.json';
jest.mock('../src/db/database', () => ({}));
jest.mock('../src/services/openai', () => ({}));
import {scoreInstructions} from '../src/services/scoring';
import {validateScore} from '../src/services/score-validation';
import {getWritingRules} from '../src/services/writing';
import {scoreMetricsFor, summarizeScores} from '../src/services/reports';
import {EducationLevel, ScoreResult} from '../src/types';

const feedback = {
  strengths: ['原文有明确信息'],
  weaknesses: ['还可以更具体'],
  improvements: ['补充一项直接证据'],
};
const original = 'My Day\n\nI went home.';
const quote = 'I went home.';
function englishScore(level: EducationLevel = 'middle'): ScoreResult {
  const rules = getWritingRules('english', level);
  return {
    score: 85,
    bandId: 'high',
    admissionAdjustment: 0,
    admissionReason: '无准入调整',
    dimensionScores: {
      task: 18,
      content: 17,
      organization: 13,
      language: 29,
      format: 8,
    },
    dimensionFeedback: Object.fromEntries(
      rules.dimensions.map(item => [item.id, feedback]),
    ),
    qualificationEvidence: Object.fromEntries(
      rules.dimensions.map(item => [
        item.id,
        [
          {
            quote,
            explanation:
              '结合当前学段的具体要求判断可见文字；未提供原题与原图的部分待核。',
          },
        ],
      ]),
    ),
    summary: '待核题、待核材料、待核原图，训练预评。个别轻微疏漏不影响理解。',
    strengths: ['信息清楚'],
    weaknesses: ['局部表达可更具体'],
    improvements: ['补充一项有效细节'],
    suggestions: ['逐句核对语气与衔接'],
    titleFeedback: feedback,
    paragraphReviews: [{paragraphIndex: 1, ...feedback}],
    annotations: ['My Day', quote].map(value => ({
      quote: value,
      type: 'improvement',
      comment: '可以更具体',
      suggestion: '补充直接证据',
    })),
  };
}

const rubrics = [englishRules, highEnglishRules];
test.each(rubrics)(
  '$educationLabel 五档强化标准完整，提高一档且不冒充官方原始分',
  rubric => {
    expect(rubric.version).toBe(4);
    expect(rubric.scoringMethod).toBe('exam-informed-enhanced');
    expect(rubric.raisedByOneBand).toBe(true);
    expect(rubric.thirdBandIsExamFullQuality).toBe(true);
    expect(rubric.scoreScale.officialExamScale).toBe(false);
    expect(rubric.scoreScale.weightsAreOfficial).toBe(false);
    expect(rubric.scoreScale.nativeScoreConversion).toBeNull();
    expect(rubric.dimensions.map(item => item.id)).toEqual([
      'task',
      'content',
      'organization',
      'language',
      'format',
    ]);
    expect(rubric.dimensions.reduce((sum, item) => sum + item.max, 0)).toBe(
      100,
    );
    expect(rubric.bands.map(band => [band.id, band.min, band.max])).toEqual([
      ['pass', 60, 69],
      ['good', 70, 79],
      ['high', 80, 89],
      ['excellent', 90, 96],
      ['model', 97, 100],
    ]);
    expect(rubric.rules.calibrationPolicy).toMatch(/较v3.*提高一个/);
    expect(rubric.rules.admissionPolicy).toBeTruthy();
    expect(rubric.rules.ceiling.length).toBeGreaterThan(0);
    for (let score = 60; score <= 100; score += 1) {
      expect(
        rubric.bands.filter(band => score >= band.min && score <= band.max),
      ).toHaveLength(1);
    }
    for (const dimension of rubric.dimensions) {
      for (let score = 0; score <= dimension.max; score += 1) {
        expect(
          dimension.anchors.filter(
            anchor => score >= anchor.min && score <= anchor.max,
          ),
        ).toHaveLength(1);
      }
    }
    for (const band of rubric.bands) {
      expect(Object.keys(band.floor).sort()).toEqual(
        rubric.dimensions.map(item => item.id).sort(),
      );
      const floorTotal = Object.values(band.floor).reduce(
        (sum, value) => sum + value,
        0,
      );
      expect(floorTotal).toBeGreaterThanOrEqual(band.min);
      expect(floorTotal).toBeLessThanOrEqual(band.max);
      expect(band.admissionConditions.length).toBeGreaterThan(0);
      expect(Object.keys(band.dimensionExpectations).sort()).toEqual(
        rubric.dimensions.map(item => item.id).sort(),
      );
      for (const expectation of Object.values(band.dimensionExpectations)) {
        for (const key of [
          'requirements',
          'strengths',
          'allowedLimitations',
          'improvements',
        ] as const) {
          expect(expectation[key].length).toBeGreaterThan(0);
          expect(
            expectation[key].every(
              value => typeof value === 'string' && value.trim(),
            ),
          ).toBe(true);
        }
      }
    }
    for (const reference of rubric.examReferences) {
      expect(
        reference.sourceIds.every(id =>
          rubric.sources.some(source => source.id === id),
        ),
      ).toBe(true);
    }
  },
);

test('高中新增能力与初中各分项标准不同，底线逐项不低于初中', () => {
  expect(highEnglishRules.highSchoolCapabilities.length).toBeGreaterThanOrEqual(
    6,
  );
  for (let index = 0; index < englishRules.bands.length; index += 1) {
    const middle = englishRules.bands[index];
    const high = highEnglishRules.bands[index];
    for (const dimension of englishRules.dimensions) {
      const key = dimension.id as keyof typeof middle.floor;
      expect(high.floor[key]).toBeGreaterThanOrEqual(middle.floor[key]);
      expect(high.dimensionExpectations[key].requirements).not.toEqual(
        middle.dimensionExpectations[key].requirements,
      );
    }
  }
});

test('中考保留地方分值来源，高考应用文与续写分制和档次独立', () => {
  expect(englishRules.examReferences.map(item => item.maxScore)).toEqual([
    15, 20,
  ]);
  const practical = highEnglishRules.examReferences.find(
    item => item.taskType === 'practical',
  )!;
  const continuation = highEnglishRules.examReferences.find(
    item => item.taskType === 'continuation',
  )!;
  expect(practical.maxScore).toBe(15);
  expect(practical.bands.map(band => [band.min, band.max])).toEqual([
    [1, 3],
    [4, 6],
    [7, 9],
    [10, 12],
    [13, 15],
  ]);
  expect(continuation.maxScore).toBe(25);
  expect(continuation.bands.map(band => [band.min, band.max])).toEqual([
    [0, 0],
    [1, 5],
    [6, 10],
    [11, 14],
    [15, 17],
    [18, 21],
    [22, 25],
  ]);
});

test.each(['middle', 'high'] as const)(
  '%s 英语五档与未达标结果均可保存原文证据，分项不凑分',
  level => {
    const rules = getWritingRules('english', level);
    const values = [
      {
        bandId: 'unqualified',
        dimensionScores: {
          task: 0,
          content: 0,
          organization: 0,
          language: 0,
          format: 0,
        },
      },
      {
        bandId: 'unqualified',
        dimensionScores: {
          task: 12,
          content: 11,
          organization: 9,
          language: 21,
          format: 6,
        },
      },
      ...rules.bands.map(band => ({
        bandId: band.id,
        dimensionScores: band.floor,
      })),
    ];
    for (const value of values) {
      const score = Object.values(value.dimensionScores).reduce(
        (sum, item) => sum + item,
        0,
      );
      const result = validateScore(
        {...englishScore(level), ...value, score},
        original,
        rules,
      );
      expect(result).toMatchObject({
        score,
        bandId: value.bandId,
        educationLevel: level,
        rubricVersion: `${rules.id}:4`,
      });
      expect(result.qualificationEvidence).toEqual(
        englishScore(level).qualificationEvidence,
      );
    }
  },
);

test.each(['middle', 'high'] as const)(
  '%s 高档允许孤立的轻微疏漏，不一律封顶79',
  level => {
    const result = validateScore(
      englishScore(level),
      original,
      getWritingRules('english', level),
    );
    expect(result.score).toBe(85);
    expect(result.bandId).toBe('high');
    expect(result.admissionAdjustment).toBe(0);
  },
);

test('较v3提高一档：原60分基本完成的分项不能直接进入初中强化及格', () => {
  const dimensionScores = {
    task: 12,
    content: 12,
    organization: 9,
    language: 21,
    format: 6,
  };
  const value = {...englishScore(), score: 60, bandId: 'pass', dimensionScores};
  expect(() =>
    validateScore(value, original, getWritingRules('english')),
  ).toThrow('至少');
  const result = validateScore(
    {
      ...value,
      score: 59,
      bandId: 'unqualified',
      admissionAdjustment: 1,
      admissionReason: `强化及格任务与语言底线未过，原文“${quote}”显示相关差距。`,
    },
    original,
    getWritingRules('english'),
  );
  expect(result.dimensionScores).toEqual(dimensionScores);
  expect(result.score).toBe(59);
});

test('高中门槛独立：初中良好70分的同一组数字不能直接进入高中良好', () => {
  const dimensionScores = getWritingRules('english').bands.find(
    band => band.id === 'good',
  )!.floor;
  const value = {
    ...englishScore('high'),
    score: 70,
    bandId: 'good',
    dimensionScores,
  };
  expect(() =>
    validateScore(value, original, getWritingRules('english', 'high')),
  ).toThrow('至少');
  const result = validateScore(
    {
      ...value,
      score: 69,
      bandId: 'pass',
      admissionAdjustment: 1,
      admissionReason: `原文“${quote}”不满足高中良好档的持续语言控制底线。`,
    },
    original,
    getWritingRules('english', 'high'),
  );
  expect(result.score).toBe(69);
  expect(result.dimensionScores).toEqual(dimensionScores);
});

test('任一关键分项低于准入底线时，不能靠其他项补分维持原档', () => {
  for (const level of ['middle', 'high'] as const) {
    const rules = getWritingRules('english', level);
    for (const band of rules.bands) {
      for (const dimension of rules.dimensions) {
        const dimensionScores = {...band.floor};
        const compensating = rules.dimensions.find(
          item =>
            item.id !== dimension.id && dimensionScores[item.id] < item.max,
        )!;
        dimensionScores[dimension.id] -= 1;
        dimensionScores[compensating.id] += 1;
        const score = Object.values(dimensionScores).reduce(
          (sum, item) => sum + item,
          0,
        );
        expect(() =>
          validateScore(
            {
              ...englishScore(level),
              score,
              bandId: band.id,
              dimensionScores,
            },
            original,
            rules,
          ),
        ).toThrow(`dimensionScores.${dimension.id} 至少`);
      }
    }
  }
});

test('有证据的文字准入可单列封顶，保留真实85分分项不重复扣分', () => {
  const value = {
    ...englishScore(),
    score: 79,
    bandId: 'good',
    admissionAdjustment: 6,
    admissionReason: `原文“${quote}”的任务展开仍不足第三档，按第二档上限封顶。`,
  };
  const result = validateScore(value, original, getWritingRules('english'));
  expect(result.score).toBe(79);
  expect(
    Object.values(result.dimensionScores).reduce((sum, item) => sum + item, 0),
  ).toBe(85);
  expect(result.admissionAdjustment).toBe(6);
});

test.each([
  {
    score: 78,
    bandId: 'good',
    admissionAdjustment: 7,
    admissionReason: `原文“${quote}”未过第三档。`,
  },
  {score: 79, bandId: 'good', admissionAdjustment: 0},
  {
    score: 79,
    bandId: 'good',
    admissionAdjustment: 6,
    admissionReason: '高中要求更高所以降档',
  },
  {admissionAdjustment: -1},
  {admissionAdjustment: 0.5},
  {admissionAdjustment: undefined},
  {admissionReason: undefined},
  {bandId: 'proficient'},
  {bandId: 'competent'},
  {score: 100, bandId: 'model'},
  {dimensionScores: {...englishScore().dimensionScores, thesis: 18}},
  {
    dimensionFeedback: {
      ...englishScore().dimensionFeedback,
      structure: feedback,
    },
  },
  {summary: '确定达到考试满分。'},
  {qualificationEvidence: undefined},
  {qualificationEvidence: {...englishScore().qualificationEvidence, task: []}},
  {
    qualificationEvidence: {
      ...englishScore().qualificationEvidence,
      task: [{quote: '不在原文中', explanation: '不能编造'}],
    },
  },
  {
    qualificationEvidence: {
      ...englishScore().qualificationEvidence,
      task: [{quote, explanation: ''}],
    },
  },
  {
    qualificationEvidence: {
      ...englishScore().qualificationEvidence,
      task: ['不是证据对象'],
    },
  },
  {
    qualificationEvidence: {
      ...englishScore().qualificationEvidence,
      thesis: [{quote, explanation: '混入中文分项'}],
    },
  },
])('拒绝错分、错误准入调整、旧档次和虚构/缺失证据：%j', patch => {
  expect(() =>
    validateScore(
      {...englishScore(), ...patch},
      original,
      getWritingRules('english'),
    ),
  ).toThrow();
});

test.each(['chinese', 'english'] as const)(
  '%s 初高中提示中的示例可通过其自身数值和证据校验',
  type => {
    for (const level of ['middle', 'high'] as const) {
      const rules = getWritingRules(type, level);
      const example = scoreInstructions(0, type, level)
        .split('\n')
        .filter(line => line.startsWith('{'))
        .map(line => JSON.parse(line))
        .find(value => value.dimensionScores);
      const text = type === 'english' ? quote : '我走回了家。';
      const evidence =
        type === 'english'
          ? {
              qualificationEvidence: Object.fromEntries(
                rules.dimensions.map(item => [
                  item.id,
                  [
                    {
                      quote: text,
                      explanation:
                        '按示例验证引用和数值结构，不作真实质量判定。',
                    },
                  ],
                ]),
              ),
            }
          : {};
      expect(() =>
        validateScore(
          {
            ...example,
            ...evidence,
            annotations: [{...example.annotations[0], quote: text}],
          },
          text,
          rules,
        ),
      ).not.toThrow();
    }
  },
);

test.each(['middle', 'high'] as const)(
  '%s 英语提示执行提高一档、五档矩阵、证据和适用性限制',
  level => {
    const instructions = scoreInstructions(5, 'english', level);
    expect(instructions).toContain(getWritingRules('english', level).id);
    expect(instructions).toContain('提高一个档次');
    expect(instructions).toContain('不能机械扣10分');
    expect(instructions).toContain('dimensionExpectations');
    expect(instructions).toContain('qualificationEvidence');
    expect(instructions).toContain('保留真实分项');
    expect(instructions).toContain('不给通知或邀请函强加主题升华');
    expect(instructions).toContain('待核题、待核材料、待核原图，训练预评');
    expect(instructions).toContain('高档允许个别轻微失误');
    expect(instructions).toContain('15分应用文与25分读后续写');
    expect(instructions).toContain('证据与改进建议评审');
    if (level === 'high') {
      expect(instructions).toContain('高中英语强化能力');
      expect(instructions).toContain('不适用项说明原因，不扣分');
    }
  },
);

test('英语标题和书信称呼分别评价，正文编号不受强化档次影响', () => {
  expect(
    validateScore(englishScore(), original, getWritingRules('english'))
      .paragraphReviews,
  ).toHaveLength(1);
  const text = 'Dear Tom,\n\nI went home.';
  const result = validateScore(
    {
      ...englishScore(),
      salutationFeedback: feedback,
      annotations: [
        {
          quote: 'Dear Tom,',
          type: 'style',
          comment: '称呼得体',
          suggestion: '保持称呼与对象一致',
        },
        {
          quote,
          type: 'improvement',
          comment: '信息可更具体',
          suggestion: '补充一个原因',
        },
      ],
    },
    text,
    getWritingRules('english'),
  );
  expect(result.paragraphReviews).toHaveLength(1);
  expect(result.salutationFeedback).toEqual(feedback);
});

test('英文报表仍按英文五项汇总，保留强化前后的原始数值', () => {
  const report = summarizeScores(
    [
      {
        id: 'score-1',
        essayId: 'english-1',
        title: 'My Day',
        scoredAt: '2026-10-10T00:00:00.000Z',
        estimatedTime: false,
        scores: {
          total: 80,
          task: 17,
          content: 16,
          organization: 12,
          language: 27,
          format: 8,
        },
      },
    ],
    scoreMetricsFor(getWritingRules('english').dimensions),
  );
  expect(report.average).toMatchObject({
    total: 80,
    task: 17,
    organization: 12,
    language: 27,
  });
});
