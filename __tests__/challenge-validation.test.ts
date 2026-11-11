import {guessSubjectFromTitle} from '../src/challenge/subjectTitle';
import {
  challengeCoverage,
  minimumUpgradeCount,
} from '../src/challenge/selection';
import {
  applicableChallengeDirections,
  applicableChallengeMetrics,
  applicableMasteryChallenges,
  challengeStandardApproved,
  CHALLENGE_POLICY_VERSION,
  CHALLENGE_RULES,
  getChallengePolicy,
  isReasoningQuestion,
  loadChallengeSubjectRules,
} from '../src/challenge/rules';
import {
  validateChallengePage,
  validateChallengePaper,
  validateChallengeReview,
  validateExamAnalysis,
  validateExamDraft,
  validateSubjectIdentification,
  validateSubjectVerification,
  validateSubjectVotes,
} from '../src/challenge/validation';
import {
  buildSubjectVerification,
  buildProgressiveSubjectVerification,
  appendSubjectSample,
  subjectConsensus,
  subjectVerificationSamples,
} from '../src/challenge/subjectSampling';
import {
  ChallengeLevel,
  CHALLENGE_REVIEW_ROLES,
  ChallengeLearningGuide,
  ChallengeDepthCheck,
  ChallengeDirectionEvidence,
  ChallengePage,
  ChallengePaper,
  ExamAnalysis,
  QuestionUpgrade,
  SourceQuestion,
  SubjectIdentification,
  SubjectVerification,
  SubjectSampleVote,
} from '../src/challenge/types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stem =
  '将1、2、3、4分成两组，每组两个数且两组和相等，给出一种分法并说明理由。';
const partitionStem =
  '把1、2、3、4、5、6分成三组，每组两个数且每组和相等；每个数恰用一次，组内顺序和三组顺序不计。求全部不同分法并说明没有遗漏。';
const partitionSolution =
  '六数总和为21，故每组和必须为7。最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件；最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。交换组内次序或三组排列仍是同一分组，不能重复计数。仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次，因此等和本身不充分；本构造覆盖且不重用六数。';
const mathDirections: ChallengeDirectionEvidence[] = [
  {
    directionId: 'math_reverse_goal',
    originalDemand: '原题给出一种分法并验证即可。',
    newDemand: '由三组等和的目标反推每组必须达到的共同和。',
    problemQuote: '每组和相等',
    solutionQuote: '六数总和为21，故每组和必须为7。',
    necessity: '本解法以共同和为7约束全部分组，为后续配对锁定目标。',
  },
  {
    directionId: 'math_symmetry_pairing',
    originalDemand: '原题只需找到一个可行例子，不必排除遗漏。',
    newDemand: '利用共同和确定最小未用数与其唯一搭档的对应。',
    problemQuote: '每组两个数',
    solutionQuote: '最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。',
    necessity: '对应关系排除其余搭档，使得全部分组可以按结构锁定。',
  },
  {
    directionId: 'math_construction',
    originalDemand: '原题不要求证明给出的例子覆盖全部可能。',
    newDemand: '把必要的对应构造成符合覆盖条件的分组，并说明不存在其他构造。',
    problemQuote: '每个数恰用一次',
    solutionQuote:
      '构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件；最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
    necessity: '共同和只给必要条件，实际构造才能保证存在，并完成无遗漏结论。',
  },
];
function mathDepth(level: ChallengeLevel): Partial<QuestionUpgrade> {
  return {
    depthRoute: 'combined',
    directionEvidence: clone(mathDirections.slice(0, level)),
    directionConnections: [
      {
        from: 'math_reverse_goal',
        to: 'math_symmetry_pairing',
        solutionQuote: '故每组和必须为7。最小数1只能与6配成7',
        explanation: '反推的共同和成为选择唯一搭档的直接输入。',
      },
      {
        from: 'math_symmetry_pairing',
        to: 'math_construction',
        solutionQuote: '剩下3与4配成7。构造得到{1,6}、{2,5}、{3,4}',
        explanation: '被锁定的对应数对成为可行分组及完整性核查的直接输入。',
      },
    ].slice(0, level - 1),
    depthChecks: [],
  };
}
const writingStem =
  '给Tom写邀请邮件，说明活动时间和地点；Tom已表示周末要照顾妹妹，请以不施压的语气说明他可选择的参与方式，给出回复方式；在原字数范围内先突出邀请目的，再组织细节和回应。';
const writingSolution =
  'Dear Tom, Would you like to join our reading afternoon at the school library this Saturday at 2 pm? I understand you need to look after your sister, so please join only if it works for you. You may also share a book idea by email. Please reply by Friday to tell us which way you prefer. Best, Li Hua. 解析：先提出阅读邀请，再承认照顾妹妹的限制，由该限制推出现场与邮件两种参与方式，最后以回复选择收束。';
function writingDepth(level: ChallengeLevel): Partial<QuestionUpgrade> {
  const directions: ChallengeDirectionEvidence[] = [
    {
      directionId: 'en_context_pragmatics',
      originalDemand: '原题只要求说明邀请的时间地点。',
      newDemand: '根据收信人的照顾任务选择体谅而不施压的邀请语气。',
      problemQuote: 'Tom已表示周末要照顾妹妹',
      solutionQuote:
        'I understand you need to look after your sister, so please join only if it works for you.',
      necessity:
        '若不顾交际对象限制直接催促参加，会使本邀请失去体谅的交际目的。',
    },
    {
      directionId: 'en_writing_tradeoff',
      originalDemand: '原题无需协调参加方式与读者现实限制。',
      newDemand: '在不增加字数的前提下，为现实限制提供可执行的参与选择和回复。',
      problemQuote: '说明他可选择的参与方式，给出回复方式',
      solutionQuote:
        'You may also share a book idea by email. Please reply by Friday to tell us which way you prefer.',
      necessity:
        '体谅限制必须转为可执行的选择，否则只是口头客气，不能实现邀请。',
    },
    {
      directionId: 'en_writing_coherence',
      originalDemand: '原题未要求按读者决策过程组织信息。',
      newDemand: '把邀请目的、限制、选择和回复构成前后依赖的信息次序。',
      problemQuote: '先突出邀请目的，再组织细节和回应',
      solutionQuote:
        '先提出阅读邀请，再承认照顾妹妹的限制，由该限制推出现场与邮件两种参与方式，最后以回复选择收束。',
      necessity: '先有现实限制再给替代选择，读者才知道为何可选以及回复什么。',
    },
  ];
  return {
    depthRoute: 'combined',
    directionEvidence: directions.slice(0, level),
    directionConnections: [
      {
        from: 'en_context_pragmatics',
        to: 'en_writing_tradeoff',
        solutionQuote: '由该限制推出现场与邮件两种参与方式',
        explanation:
          '交际对象的限制决定替代参与方案，语气判断直接约束内容选择。',
      },
      {
        from: 'en_writing_tradeoff',
        to: 'en_writing_coherence',
        solutionQuote: '最后以回复选择收束',
        explanation:
          '参与方式的选择决定结尾须请求回复具体偏好，成为篇章收束的输入。',
      },
    ].slice(0, level - 1),
    depthChecks: [],
  };
}
function sourceQuestion(patch: Partial<SourceQuestion> = {}): SourceQuestion {
  return {
    id: 'q1',
    number: '1',
    sectionId: 's1',
    type: '解答题',
    majorQuestionId: 'major1',
    dependsOnQuestionIds: [],
    stem,
    options: [],
    materialIds: [],
    figureIds: [],
    knowledgePoints: ['整数四则运算与等量关系'],
    score: 5,
    isListening: false,
    answerLines: 2,
    sourceRefs: [{pageIndex: 0, quote: patch.stem || stem}],
    difficulty: {
      rating: 2,
      reasoningSteps: 1,
      explanation: '给出一个等和分组例子并验证，属估计而非实测。',
    },
    ...patch,
  };
}
function fixture(
  subject: ExamAnalysis['subject'] = 'math',
  question = sourceQuestion(),
) {
  const subjectLabel = CHALLENGE_RULES.subjects.find(
    item => item.subject === subject,
  )!.label;
  const page: ChallengePage = {
    pageIndex: 0,
    documentType: 'exam',
    text: `${subjectLabel}练习试卷\n一、基础题\n${question.stem}`,
    hasStudentAnswers: true,
    unreadableParts: [],
    figures: [],
  };
  const analysis: ExamAnalysis = {
    isExam: true,
    title: `${subjectLabel}练习试卷`,
    subject,
    subjectLabel: subject,
    educationLevel: 'middle',
    knowledgePoints: [...question.knowledgePoints],
    difficultySummary: '原范围内的基础试卷。',
    difficultyBasis: 'estimated',
    answerState: 'answered',
    sections: [{id: 's1', title: '一、基础题', instructions: ''}],
    materials: [],
    figures: [],
    questions: [question],
    totalScore: 5,
    timeLimitMinutes: 20,
    warnings: [],
    unresolvedIssues: [],
    titleEvidence: [{pageIndex: 0, quote: `${subjectLabel}练习试卷`}],
    majorQuestions: [
      {
        id: 'major1',
        title: '一、基础题',
        sourceRefs: [{pageIndex: 0, quote: '一、基础题'}],
      },
    ],
    subjectIdentification: {
      status: 'confirmed',
      subject,
      courseName: CHALLENGE_RULES.subjects.find(
        item => item.subject === subject,
      )!.label,
      integrated: false,
      reason: '根据印刷题型、材料及其实际考查知识确认科目。',
      evidence: [{pageIndex: 0, quote: question.stem}],
    },
  };
  return {page, analysis};
}
function masteryGuide(
  analysis: ExamAnalysis,
  question: SourceQuestion,
  level: ChallengeLevel,
) {
  if (question.isListening) {
    return [];
  }
  const math = analysis.subject === 'math';
  const misconceptions = math
    ? [
        {
          challengeId: 'math_case_completeness',
          wrongApproach: '给出一个可行例子后直接声称已经找到所有分组。',
          whyWrong: '例子只能证明存在，不能排除另有分法。',
          correction: '按最小未用数逐次锁定唯一搭档，说明所有候选都被覆盖。',
          solutionQuote:
            '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
        },
        {
          challengeId: 'math_case_deduplication',
          wrongApproach: '把{1,6}与{6,1}或交换三组的位置算成不同分法。',
          whyWrong: '分组只看每组有哪些数，组内和组间的排列不产生新分组。',
          correction: '先按原题对象同一性统一表示，再去除同一分组的排列。',
          solutionQuote: '交换组内次序或三组排列仍是同一分组，不能重复计数。',
        },
        {
          challengeId: 'math_object_constraints',
          wrongApproach: '把{1,6}重复三次，因为每组和均为7就判断分组可行。',
          whyWrong: '只满足等和这一必要条件，重复使用1与6且遗漏其余数。',
          correction: '同时核查各组等和与六个数各恰好使用一次。',
          solutionQuote:
            '仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次，因此等和本身不充分；本构造覆盖且不重用六数。',
        },
      ]
    : [
        {
          challengeId: 'en_writing_task_delivery',
          wrongApproach: '只写时间地点，不交代Tom可采用的参与方式和怎样回复。',
          whyWrong: '信息清单存在但读者仍无法据此完成参与和回应。',
          correction: '在原邀请文体内给出现场或邮件的选择，并明确回复偏好。',
          solutionQuote:
            'You may also share a book idea by email. Please reply by Friday to tell us which way you prefer.',
        },
        {
          challengeId: 'en_pragmatic_register',
          wrongApproach: '用You must join来催促有照顾妹妹任务的朋友到场。',
          whyWrong: '强迫语气忽略交际对象的现实限制，破坏邀请的体谅目的。',
          correction: '承认对方的限制，并用有选择余地的邀请语气。',
          solutionQuote:
            'I understand you need to look after your sister, so please join only if it works for you.',
        },
        {
          challengeId: 'en_discourse_reference',
          wrongApproach: '未说明邀请目的就要求回复选择，把替代方式与限制分开。',
          whyWrong: '读者不清楚回复什么，也难以理解为什么另设邮件参与。',
          correction: '按邀请、限制、参与选择、回复的依赖顺序组织信息。',
          solutionQuote:
            '先提出阅读邀请，再承认照顾妹妹的限制，由该限制推出现场与邮件两种参与方式，最后以回复选择收束。',
        },
      ];
  const selfChecks = math
    ? [
        {
          kind: 'conditions' as const,
          method: '逐数标记出现次数，并核查每组人数，查重复与遗漏。',
          expected: '六个数各出现一次，每组恰有两个数。',
          solutionQuote:
            '构造得到{1,6}、{2,5}、{3,4}，每个数恰用一次，符合全部条件',
        },
        {
          kind: 'reasoning' as const,
          method: '从共同和重查最小未用数是否有第二个合法搭档。',
          expected: '每次搭档唯一确定，任何另一分组都无法另选搭档。',
          solutionQuote:
            '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
        },
        {
          kind: 'result' as const,
          method: '独立重算三个数对的和，并按原题顺序等价口径核最终分组数。',
          expected: '三组和都为7，去除排列后只有一种分组。',
          solutionQuote:
            '最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。',
        },
      ]
    : [
        {
          kind: 'conditions' as const,
          method: '按读者、活动时间地点、参与选择、回复行动逐项对照邀请任务。',
          expected: '读者可以知道何时何地参加，以及不能到场时怎样参与和回复。',
          solutionQuote:
            'Would you like to join our reading afternoon at the school library this Saturday at 2 pm?',
        },
        {
          kind: 'reasoning' as const,
          method: '追问为何提供邮件方式，核对它是否由Tom的现实限制推出。',
          expected: '替代方式回应照顾妹妹的限制，不是与邀请无关的新增信息。',
          solutionQuote: '由该限制推出现场与邮件两种参与方式',
        },
        {
          kind: 'result' as const,
          method: '以收信人视角读结尾，检查是否能明确作出回复选择。',
          expected: 'Tom能在Friday前回复偏好的参与方式。',
          solutionQuote:
            'Please reply by Friday to tell us which way you prefer.',
        },
      ];
  return question.knowledgePoints.map((knowledgePoint, index) => ({
    knowledgePoint,
    coreInsight: math
      ? '整体总和与组数确定共同和，等量约束再锁定每个数的搭档。'
      : index === 0
      ? '邀请邮件要让读者能据具体信息采取参与和回复行动。'
      : '语气和信息次序服务特定读者及邀请目的，不以复杂句数替代交际效果。',
    conditionBoundary: math
      ? '共同和、每组两个数、每数恰用一次和顺序不计必须同时成立。'
      : '保留原邀请文体与交际目的，在原语言范围和字数内协调限制与信息。',
    reasoning: math
      ? '由总和反推7，按最小未用数强制配对，再以覆盖和唯一搭档说明没有遗漏。'
      : '由邀请目的确定必要信息，由对象限制选择体谅语气与替代方式，再以回复收束。',
    problemQuote: math ? '每组和相等' : '给Tom写邀请邮件',
    solutionQuote: math
      ? '六数总和为21，故每组和必须为7。'
      : 'Would you like to join our reading afternoon at the school library this Saturday at 2 pm?',
    misconceptions: clone(
      misconceptions.filter(
        (_, itemIndex) =>
          itemIndex < Math.max(level, question.knowledgePoints.length) &&
          itemIndex % question.knowledgePoints.length === index,
      ),
    ),
    transferLinks: [
      {
        kind: 'source_to_variant' as const,
        originalCondition: math
          ? '原题四数分两组，给出一种等和分法即可。'
          : index === 0
          ? '原题按时间地点完成基本邀请。'
          : '原题只给出邀请对象与目的，未给现实参与限制。',
        changedCondition: math
          ? '新题六数分三组，需要所有分法且不能重复用数。'
          : index === 0
          ? '新题须兼顾到场与邮件参与及明确回复。'
          : '新题加入照顾妹妹的限制，需要体谅语气。',
        invariant: math
          ? '整数运算与等量关系不变，不引入排列组合公式。'
          : `原有${knowledgePoint}仍决定文体、对象和行动目的，不引入新语言点。`,
        adaptation: math
          ? '把原题验证一个例子的处理，改为共同和约束下逐次锁定并证明全部。'
          : index === 0
          ? '把基本信息清单组织为读者可执行的参与和回复选择。'
          : '用有选择余地的表达邀请，在内容方案中回应对象限制。',
        sourceQuote: question.stem,
        problemQuote: math ? '求全部不同分法' : 'Tom已表示周末要照顾妹妹',
        solutionQuote: math
          ? '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。'
          : '由该限制推出现场与邮件两种参与方式',
      },
      ...(level === 3 && index === 0
        ? [
            {
              kind: 'condition_contrast' as const,
              originalCondition: math
                ? '原题分组须同时满足对象覆盖与组和相等。'
                : '原题邀请要求让收信人知道活动的具体安排。',
              changedCondition: math
                ? '只保留组和要求而忽略每数恰用一次，会允许重复同一数对。'
                : '若只列出时间地点而忽略对方限制，读者仍无法选择参与方式。',
              invariant: math
                ? '等和这一局部必要条件不能替代所有对象约束。'
                : '邀请目的与读者行动要求保持，改变信息组织不能漏交际任务。',
              adaptation: math
                ? '用重复{1,6}的原域反例区分必要条件与合法分组，不另增考题。'
                : '比较有无替代参与方式时邀请能否落实，再把选择与回复写清。',
              sourceQuote: question.stem,
              problemQuote: math ? '每个数恰用一次' : '说明他可选择的参与方式',
              solutionQuote: math
                ? '仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次'
                : 'You may also share a book idea by email.',
            },
          ]
        : []),
    ],
    selfChecks: clone(
      selfChecks.filter(
        (_, itemIndex) =>
          itemIndex < Math.max(level, question.knowledgePoints.length) &&
          itemIndex % question.knowledgePoints.length === index,
      ),
    ),
  }));
}
function generated(
  analysis: ExamAnalysis,
  level: ChallengeLevel = 1,
): ChallengePaper {
  return {
    title: '挑战试卷',
    masteryStatus: 'training_only',
    level,
    subject: analysis.subject,
    sections: clone(analysis.sections),
    materials: clone(analysis.materials),
    figures: clone(analysis.figures),
    totalScore: analysis.totalScore,
    timeLimitMinutes: analysis.timeLimitMinutes,
    questions: analysis.questions.map(question => {
      const base = clone(question);
      Reflect.deleteProperty(base, 'sourceRefs');
      Reflect.deleteProperty(base, 'difficulty');
      const metrics = Object.fromEntries(
        applicableChallengeMetrics(
          analysis.subject,
          level,
          question,
          analysis.materials,
        ).map(metric => [metric.key, metric.min]),
      );
      const writingCount = metrics.writingConstraints || 0;
      const changes = writingCount
        ? Array.from(
            {length: writingCount},
            (_, index) =>
              `原要求${index + 1}为基本完成→新要求${
                index + 1
              }为具体语境中准确落实`,
          )
        : ['原单步提问→增加逆向条件辨析'];
      return {
        ...base,
        stem: question.isListening
          ? question.stem
          : analysis.subject === 'english'
          ? writingStem
          : question.options.length
          ? partitionStem.replace('并说明没有遗漏', '')
          : partitionStem,
        upgrade: {
          level,
          metrics: question.isListening
            ? {}
            : {...metrics, changedConditions: changes.length},
          ...(question.isListening
            ? {}
            : analysis.subject === 'english'
            ? writingDepth(level)
            : mathDepth(level)),
          changes: question.isListening ? [] : changes,
          pitfalls: question.isListening
            ? []
            : Array.from(
                {length: level},
                (_, index) => `区分第${index + 1}个条件的不同错误来源`,
              ),
          scopeExplanation: '只使用原题核心知识，原有目标不删不增。',
        },
      };
    }),
    answers: analysis.questions.map(question => ({
      questionId: question.id,
      status: question.isListening ? 'requires_audio' : 'verified',
      answer: question.isListening
        ? '待核：需原录音。'
        : question.options.length
        ? 'A'
        : analysis.subject === 'english'
        ? writingSolution
        : '1种：{1,6}、{2,5}、{3,4}。',
      explanation: question.isListening
        ? '未提供原音频，不能采信学生已有选项，听力待核。'
        : analysis.subject === 'english'
        ? writingSolution
        : partitionSolution,
      scoringPoints: question.isListening ? [] : ['按原分值给出方法与结论分。'],
      learningGuide: masteryGuide(analysis, question, level),
    })),
  };
}

test('11科三档均有量化提升、适用条件与真实五角色标准定稿记录', () => {
  expect(CHALLENGE_RULES.subjects).toHaveLength(11);
  const subjects = CHALLENGE_RULES.subjects.map(item =>
    loadChallengeSubjectRules(item.subject),
  );
  expect(CHALLENGE_RULES.version).toBe(3);
  expect(
    subjects.reduce(
      (count, policy) => count + policy.masteryChallenges.length,
      0,
    ),
  ).toBeGreaterThanOrEqual(70);
  expect(
    subjects.reduce((count, policy) => count + policy.deepDirections.length, 0),
  ).toBeGreaterThanOrEqual(80);
  expect(CHALLENGE_RULES.standardReview.scope).toBe('difficulty_standard_only');
  expect(CHALLENGE_RULES.standardReview.reviewedPolicyVersion).toBe(
    CHALLENGE_POLICY_VERSION,
  );
  expect(challengeStandardApproved()).toBe(true);
  for (const policy of subjects) {
    expect(policy.tiers.map(tier => tier.level)).toEqual([1, 2, 3]);
    for (const tier of policy.tiers) {
      expect(tier.aspects.length).toBeGreaterThan(0);
      expect(tier.metrics.length).toBeGreaterThanOrEqual(2);
      expect(
        tier.metrics.every(
          metric =>
            metric.min >=
              (policy.subject === 'math' &&
              ['reasoningStepsAdded', 'representationChanges'].includes(
                metric.key,
              )
                ? 0
                : 1) && metric.max! >= metric.min,
        ),
      ).toBe(true);
      expect(tier.depthRequirements).toMatchObject({
        minDirections: tier.level,
        minConnections: tier.level - 1,
        requireNecessityExplanation: true,
      });
      expect(tier.masteryRequirements).toMatchObject({
        requireEveryCore: true,
        minMisconceptions: tier.level,
        minTransferLinks: tier.level === 3 ? 2 : 1,
        minSelfChecks: tier.level,
        requireEvidence: true,
      });
      expect(new Set(tier.masteryRequirements.requiredDimensions)).toEqual(
        new Set([
          'concept_boundary',
          'diagnosis_correction',
          'reasoning_evidence',
          'variant_transfer',
          'integrated_self_check',
        ]),
      );
      expect(policy.deepDirections.length).toBeGreaterThanOrEqual(3);
      for (const direction of policy.deepDirections) {
        expect(direction.description.trim()).not.toBe('');
        expect(direction.sourceIds.length).toBeGreaterThan(0);
        expect(
          direction.sourceIds.every(id =>
            CHALLENGE_RULES.sources.some(source => source.id === id),
          ),
        ).toBe(true);
      }
      expect(policy.masteryChallenges.length).toBeGreaterThanOrEqual(2);
      expect(
        policy.subjectBlueprint.difficultyProgression.map(item => item.level),
      ).toEqual([1, 2, 3]);
      for (const key of [
        'coreDomains',
        'misconceptionMechanisms',
        'masteryAcceptance',
        'scopeExclusions',
      ] as const) {
        expect(policy.subjectBlueprint[key].length).toBeGreaterThanOrEqual(3);
        expect(policy.subjectBlueprint[key].every(item => item.trim())).toBe(
          true,
        );
      }
      expect(
        policy.subjectBlueprint.questionTypeGuidance.length,
      ).toBeGreaterThanOrEqual(3);
      for (const guide of policy.subjectBlueprint.questionTypeGuidance) {
        expect(guide.questionType.trim()).not.toBe('');
        expect(guide.design.trim()).not.toBe('');
        expect(guide.answerEvidence.trim()).not.toBe('');
      }
      for (const challenge of policy.masteryChallenges) {
        expect(challenge.knowledgeKeywords.length).toBeGreaterThan(0);
        for (const key of [
          'misconception',
          'diagnosticContrast',
          'correctionTarget',
          'transferTarget',
          'selfCheckTarget',
        ] as const) {
          expect(challenge[key].trim()).not.toBe('');
        }
        expect(
          challenge.sourceIds.every(id =>
            CHALLENGE_RULES.sources.some(source => source.id === id),
          ),
        ).toBe(true);
      }
    }
  }
  for (const subject of ['english', 'chinese'] as const) {
    expect(
      [1, 2, 3].map(
        level =>
          getChallengePolicy(subject, level as ChallengeLevel).metrics.find(
            metric => metric.key === 'writingConstraints',
          )!.min,
      ),
    ).toEqual([1, 2, 3]);
  }
});

test('只标approved、缺角色、重复角色或旧标准版本不能冒充五角色定稿', () => {
  const review: {
    roles: string[];
    completedRoles: string[];
    reviewedPolicyVersion: string;
    reviews: {role: string; status: string; conclusion: string}[];
    [key: string]: unknown;
  } = clone(CHALLENGE_RULES.standardReview);
  expect(challengeStandardApproved({status: 'approved'})).toBe(false);
  expect(
    challengeStandardApproved({
      ...review,
      completedRoles: review.completedRoles.slice(1),
    }),
  ).toBe(false);
  expect(
    challengeStandardApproved({
      ...review,
      roles: Array(5).fill('subject_scope'),
    }),
  ).toBe(false);
  expect(
    challengeStandardApproved({...review, reviewedPolicyVersion: 'old:1'}),
  ).toBe(false);
  expect(
    challengeStandardApproved({
      ...review,
      reviews: review.reviews.map((item, index) =>
        index ? item : {...item, status: 'pending'},
      ),
    }),
  ).toBe(false);
});

test('纯术语填空不强制实验变量；共享实验材料中的题目按实际任务适用', () => {
  const plain = sourceQuestion({
    type: '术语填空',
    stem: '细胞中的遗传物质主要是____。',
    knowledgePoints: ['细胞结构'],
  });
  expect(isReasoningQuestion(plain)).toBe(false);
  expect(
    applicableChallengeMetrics('biology', 3, plain).map(metric => metric.key),
  ).toEqual(['changedConditions', 'pitfallDistinctions']);
  const withMaterial = {...plain, materialIds: ['m1']};
  const materials = [
    {
      id: 'm1',
      title: '实验数据',
      text: '对照实验中控制温度，记录测量数据。',
      isListening: false,
      figureIds: [],
    },
  ];
  expect(
    applicableChallengeMetrics('biology', 3, withMaterial, materials).map(
      metric => metric.key,
    ),
  ).toContain('variableControls');
});

test.each(['blank', 'answered', 'mixed'] as const)(
  '原卷%s状态均能解析，不因作答状态判非试卷',
  answerState => {
    const {page, analysis} = fixture();
    expect(validateChallengePage(page, 0)).toEqual(page);
    expect(
      validateExamAnalysis({...analysis, answerState}, [page]).answerState,
    ).toBe(answerState);
  },
);

test('不是试卷、未识别内容和不存在的原文引用不会被当作成功解析', () => {
  const {page, analysis} = fixture();
  expect(() =>
    validateExamAnalysis({...analysis, isExam: false}, [page]),
  ).toThrow('必须是');
  expect(() =>
    validateExamAnalysis(analysis, [{...page, documentType: 'not_exam'}]),
  ).toThrow(/非试卷|实际试卷/);
  expect(() =>
    validateExamAnalysis(analysis, [
      {...page, unreadableParts: ['题干被遮挡']},
    ]),
  ).toThrow('保留unresolvedIssues');
  const wrongQuote = clone(analysis);
  wrongQuote.questions[0].sourceRefs[0].quote = '模型补出的文字';
  expect(() => validateExamAnalysis(wrongQuote, [page])).toThrow('连续文字');
});

test('可保存缺页阻塞说明，但未解决内容不得进入新卷生成', () => {
  const {page, analysis} = fixture();
  const pending = validateExamAnalysis(
    {...analysis, unresolvedIssues: ['题干被遮挡']},
    [{...page, unreadableParts: ['题干被遮挡']}],
  );
  expect(() => validateChallengePaper(generated(pending), pending, 1)).toThrow(
    '尚有未解决',
  );
});

test.each([1, 2, 3] as const)(
  '升%s档保留题型和知识核心，计数与实际说明一致',
  level => {
    const {analysis} = fixture();
    const paper = generated(analysis, level);
    expect(validateChallengePaper(paper, analysis, level)).toEqual(paper);
  },
);

test.each([
  {key: 'id', value: 'new-id'},
  {key: 'number', value: '2'},
  {key: 'type', value: '单选题'},
  {key: 'score', value: 6},
  {key: 'isListening', value: true},
  {key: 'knowledgePoints', value: ['二次函数']},
  {key: 'knowledgePoints', value: []},
  {key: 'materialIds', value: ['missing']},
  {key: 'figureIds', value: ['missing']},
])('不允许微调改变原题核心结构或知识：$key=$value', ({key, value}) => {
  const {analysis} = fixture();
  const paper = generated(analysis);
  (paper.questions[0] as any)[key] = value;
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow();
});

test('删除一项原核心目标也应拒绝，不能用范围子集掩盖难点缩水', () => {
  const {analysis} = fixture(
    'math',
    sourceQuestion({knowledgePoints: ['一元一次方程', '等式性质']}),
  );
  const paper = generated(analysis);
  paper.questions[0].knowledgePoints = ['一元一次方程'];
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('全部核心');
});

test('原样、仅标点空格或重复易错描述不能算三档升难', () => {
  const {analysis} = fixture();
  const paper = generated(analysis, 3);
  paper.questions[0].stem = `  ${stem}！！！ `;
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow('实质变种');
  paper.questions[0].stem += '反向判断原条件。';
  paper.questions[0].upgrade.pitfalls = [
    '注意负号',
    '注意负号。',
    '注意负号！',
  ];
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow('凑指标');
});

test('自报升档数字必须在适用档范围并等于实际条目数', () => {
  const {analysis} = fixture();
  const paper = generated(analysis, 3);
  const stepMetric = getChallengePolicy('math', 3).metrics.find(
    metric => metric.key === 'reasoningStepsAdded',
  )!;
  paper.questions[0].upgrade.metrics.reasoningStepsAdded = stepMetric.max! + 1;
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    'reasoningStepsAdded',
  );
  paper.questions[0].upgrade.metrics.reasoningStepsAdded = 0;
  paper.questions[0].upgrade.metrics.pitfallDistinctions = 4;
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    '实际pitfalls条数',
  );
});

test('写作只计相对原题加强/新增要求，并逐条给原→新对照', () => {
  const writing = sourceQuestion({
    type: '书面表达',
    stem: '给Tom写邀请邮件，说明活动时间和地点。',
    knowledgePoints: ['邀请邮件', '交际目的'],
  });
  const {analysis} = fixture('english', writing);
  const paper = generated(analysis, 3);
  expect(
    validateChallengePaper(paper, analysis, 3).questions[0].upgrade.metrics
      .writingConstraints,
  ).toBe(3);
  paper.questions[0].upgrade.changes = ['写清时间', '写清地点', '写邀请邮件'];
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    '原要求→新要求',
  );
});

function listeningFixture() {
  const listening = sourceQuestion({
    type: '单项选择题',
    stem: 'Listen and choose the correct answer.',
    options: [
      {label: 'A', text: 'Yes.'},
      {label: 'B', text: 'No.'},
    ],
    isListening: true,
    materialIds: ['audio1'],
    knowledgePoints: ['听力信息获取'],
  });
  const {page, analysis} = fixture('english', listening);
  analysis.materials = [
    {
      id: 'audio1',
      title: '听力材料',
      text: '原录音另附。',
      isListening: true,
      figureIds: [],
    },
  ];
  return {page, analysis};
}

test('听力题和材料完全不变，无录音答案可以空或待核但不能猜学生选项', () => {
  const {analysis} = listeningFixture();
  const paper = generated(analysis, 3);
  expect(validateChallengePaper(paper, analysis, 3)).toEqual(paper);
  paper.answers[0].answer = '';
  expect(() => validateChallengePaper(paper, analysis, 3)).not.toThrow();
  paper.answers[0].answer = 'A';
  paper.answers[0].status = 'verified';
  paper.answers[0].scoringPoints = ['选A'];
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    '不得将学生填答',
  );
});

test('即使听力material标记错误或被非听力共享，也不能通过改写材料绕过冻结', () => {
  const {analysis} = listeningFixture();
  analysis.materials[0].isListening = false;
  const paper = generated(analysis);
  paper.materials[0].text = '改写的录音材料。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '听力共享材料',
  );
});

test('有明确原录音转写时才允许给听力确定答案', () => {
  const {page, analysis} = listeningFixture();
  analysis.materials[0].title = '听力原文转写';
  analysis.materials[0].text =
    'Transcript: Do you want to join our school activity? Yes, I do.';
  page.text += `\n${analysis.materials[0].title}：\n${analysis.materials[0].text}`;
  expect(() => validateExamAnalysis(analysis, [page])).not.toThrow();
  const paper = generated(analysis);
  paper.answers[0] = {
    questionId: 'q1',
    status: 'verified',
    answer: 'A',
    explanation: '原文明确回答Yes。',
    scoringPoints: ['A选项符合原文'],
  };
  expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
  paper.questions[0].options[0].text = 'Changed.';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '听力题必须原样保留',
  );
});

test('伪造听力转写标题、阅读材料改名或题干追加虚构原文不能打开确定答案', () => {
  const {page, analysis} = listeningFixture();
  analysis.materials[0].title = '听力原文';
  analysis.materials[0].text =
    'Would you like to go to the school tomorrow? Yes, I would.';
  expect(() => validateExamAnalysis(analysis, [page])).toThrow(
    '标识标题与正文一起溯源',
  );
  page.text += `\n阅读理解：${analysis.materials[0].text}`;
  expect(() => validateExamAnalysis(analysis, [page])).toThrow('不能改名');
  analysis.materials[0].title = '普通材料';
  analysis.questions[0].stem +=
    '\n听力原文：The speaker says the correct answer is option A, not option B.';
  expect(() => validateExamAnalysis(analysis, [page])).toThrow('不能追加虚构');
});

test('真实标识和极短转写按原页取证，不用任意字符数决定真假', () => {
  const {page, analysis} = listeningFixture();
  analysis.materials[0] = {
    id: 'audio1',
    title: '听力原文',
    text: 'No.',
    isListening: true,
    figureIds: [],
  };
  page.text += '\n听 力 原 文：\nNo.';
  expect(() => validateExamAnalysis(analysis, [page])).not.toThrow();
});

test('听力题组指示也必须冻结，不能从听两遍改为听一遍', () => {
  const {analysis} = listeningFixture();
  analysis.sections[0].instructions = '录音听两遍。';
  const paper = generated(analysis);
  paper.sections[0].instructions = '录音听一遍。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('听几遍');
});

test('图题保持原裁剪坐标，学生手写图必须干净重建而非直接印入', () => {
  const {page, analysis} = fixture();
  const figure = {
    id: 'p0-f1',
    kind: 'source' as const,
    pageIndex: 0,
    box: {x: 0.1, y: 0.2, width: 0.3, height: 0.3},
    caption: '原图',
    containsStudentMarks: true,
  };
  page.figures = [figure];
  analysis.figures = [figure];
  analysis.questions[0].figureIds = [figure.id];
  expect(() => validateExamAnalysis(analysis, [page])).not.toThrow();
  const paper = generated(analysis);
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '学生作答标记',
  );
  paper.figures = [
    {
      id: figure.id,
      kind: 'drawing',
      caption: '重建印刷图',
      width: 100,
      height: 100,
      elements: [{kind: 'line', x1: 10, y1: 10, x2: 90, y2: 90}],
    },
  ];
  expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
  (paper.figures[0] as any).elements[0].x2 = 1000;
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('不得越过');
});

test('答案不漏题、不重复，单选只能引用一个实际选项标签', () => {
  const choice = sourceQuestion({
    type: '单项选择题',
    stem: '将1、2、3、4分成两组，每组两个数且两组和相等，符合条件的分法是哪项？',
    options: [
      {label: 'A', text: '{1,4}、{2,3}'},
      {label: 'B', text: '{1,2}、{3,4}'},
    ],
  });
  const {analysis} = fixture('math', choice);
  const paper = generated(analysis);
  paper.questions[0].options = [
    {label: 'A', text: '{1,6}、{2,5}、{3,4}'},
    {label: 'B', text: '{1,5}、{2,6}、{3,4}'},
  ];
  expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
  paper.answers[0].answer = 'AB';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('单选题');
  paper.answers[0].answer = 'C';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('实际选项');
  paper.answers = [];
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('answers');
});

test('一次综合校核需覆盖所有题目，有问题不能approve', () => {
  const {analysis} = fixture();
  const paper = generated(analysis);
  const review = {
    role: 'answers',
    verdict: 'approve',
    checkedQuestionIds: ['q1'],
    summary: '已独立核对原范围与答案。',
    issues: [],
  };
  expect(() => validateChallengeReview(review, 'answers', paper)).not.toThrow();
  expect(() =>
    validateChallengeReview(
      {...review, checkedQuestionIds: []},
      'answers',
      paper,
    ),
  ).toThrow('所有题目');
  expect(() =>
    validateChallengeReview(
      {
        ...review,
        issues: [
          {
            questionId: 'q1',
            code: 'wrong',
            comment: '需要修改',
            fix: '修正答案',
          },
        ],
      },
      'answers',
      paper,
    ),
  ).toThrow('approve');
  expect(() =>
    validateChallengeReview({...review, role: 'scope'}, 'answers', paper),
  ).toThrow('指定');
});

test.each(CHALLENGE_REVIEW_ROLES)(
  '%s角色必须独立署名并覆盖整卷，不能冒用另一角色通过票',
  role => {
    const {analysis} = fixture();
    analysis.questions.push({
      ...clone(analysis.questions[0]),
      id: 'q2',
      number: '2',
    });
    analysis.totalScore = 10;
    const paper = generated(analysis);
    const vote = {
      role,
      verdict: 'approve',
      checkedQuestionIds: ['q1', 'q2'],
      summary: `已按${role}职责逐题核对本科规则。`,
      issues: [],
    };
    expect(() => validateChallengeReview(vote, role, paper)).not.toThrow();
    expect(() =>
      validateChallengeReview(
        {...vote, checkedQuestionIds: ['q1']},
        role,
        paper,
      ),
    ).toThrow('所有题目');
    expect(() =>
      validateChallengeReview(
        {...vote, role: role === 'answers' ? 'subject' : 'answers'},
        role,
        paper,
      ),
    ).toThrow('指定');
  },
);

test('畸形嵌套JSON返回明确校验问题，不发生未捕获的类型崩溃', () => {
  const {analysis} = fixture();
  for (const patch of [
    {figures: [null]},
    {materials: [null]},
    {questions: [null]},
    {answers: [null]},
    {sections: [null]},
  ]) {
    expect(() =>
      validateChallengePaper({...generated(analysis), ...patch}, analysis, 1),
    ).toThrow('挑战试卷校验未通过');
  }
});

test('深度有效时允许更短巧解，数学步数和表征次数零增量不强行拆步', () => {
  const {analysis} = fixture();
  const paper = generated(analysis, 3);
  paper.questions[0].upgrade.metrics.reasoningStepsAdded = 0;
  paper.questions[0].upgrade.metrics.representationChanges = 0;
  expect(() => validateChallengePaper(paper, analysis, 3)).not.toThrow();
});

test.each(['depthRoute', 'directionEvidence', 'directionConnections'] as const)(
  'v2非听力缺少%s不能仅凭旧数字指标通过',
  key => {
    const {analysis} = fixture();
    const paper = generated(analysis, 3);
    Reflect.deleteProperty(paper.questions[0].upgrade, key);
    expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(key);
  },
);

test('方向必须在原题任务内适用，不能借别科或新题自报的材料制造适用性', () => {
  const plain = sourceQuestion({
    type: '术语填空',
    stem: '细胞中的遗传物质主要是____。',
    knowledgePoints: ['细胞结构'],
  });
  expect(
    applicableChallengeDirections('biology', 3, plain).map(item => item.id),
  ).not.toContain('biology_causal_control');
  const {analysis} = fixture();
  const paper = generated(analysis);
  for (const directionId of [
    'en_context_pragmatics',
    'math_not_a_catalog_direction',
  ]) {
    paper.questions[0].upgrade.directionEvidence![0].directionId = directionId;
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      '原题任务适用',
    );
  }
});

test.each(['读后续写', 'continuation', '应用文', '写话', '书面表达'])(
  '%s识别写作专项，关联英文原材料提供证据而不依赖关键词',
  type => {
    const writing = sourceQuestion({
      type,
      stem: 'Continue the story in about 150 words.',
      knowledgePoints: ['叙事写作'],
      materialIds: ['m1'],
    });
    const material = {
      id: 'm1',
      title: 'A promise',
      text: 'Tom waited by the door. He had promised to stay until Jane returned.',
      isListening: false,
      figureIds: [],
    };
    expect(
      applicableChallengeDirections('english', 3, writing, [material]).map(
        direction => direction.id,
      ),
    ).toContain('en_read_write_transfer');
    expect(
      applicableChallengeMetrics('english', 3, writing, [material]).find(
        metric => metric.key === 'writingConstraints',
      )?.min,
    ).toBe(3);
    expect(
      applicableChallengeDirections('english', 3, writing, [
        {...material, id: 'unrelated'},
      ]).map(direction => direction.id),
    ).not.toContain('en_read_write_transfer');
  },
);

test('原要求不变、只贴方法名或同一要求贴多个标签均不能计升难', () => {
  const {analysis} = fixture();
  const original = generated(analysis, 3);
  const unchanged = clone(original);
  unchanged.questions[0].upgrade.directionEvidence![0].newDemand =
    unchanged.questions[0].upgrade.directionEvidence![0].originalDemand;
  expect(() => validateChallengePaper(unchanged, analysis, 3)).toThrow(
    '原样保留不计增量',
  );
  const nameOnly = clone(original);
  nameOnly.questions[0].upgrade.directionEvidence![0].necessity =
    getChallengePolicy('math', 3).deepDirections[0].name;
  expect(() => validateChallengePaper(nameOnly, analysis, 3)).toThrow(
    '不能只贴方向名称',
  );
  const repeatedDemand = clone(original);
  repeatedDemand.questions[0].upgrade.directionEvidence![1].newDemand =
    repeatedDemand.questions[0].upgrade.directionEvidence![0].newDemand + '！';
  expect(() => validateChallengePaper(repeatedDemand, analysis, 3)).toThrow(
    '同一新要求重复贴多个方向标签',
  );
  const repeatedDirection = clone(original);
  repeatedDirection.questions[0].upgrade.directionEvidence![1].directionId =
    repeatedDirection.questions[0].upgrade.directionEvidence![0].directionId;
  expect(() => validateChallengePaper(repeatedDirection, analysis, 3)).toThrow(
    '不得重复计数',
  );
});

test.each([
  {field: 'problemQuote', value: '新题根本没有给出的限制'},
  {field: 'problemQuote', value: ' 每组和相等 '},
  {field: 'solutionQuote', value: '不存在于解析的竞赛定理'},
  {field: 'solutionQuote', value: '1种：{1,6}、{2,5}、{3,4}。'},
  {field: 'solutionQuote', value: '！！！'},
] as const)('方向引文需逐字出现在本题题文或解析：$field=$value', patch => {
  const {analysis} = fixture();
  const paper = generated(analysis);
  paper.questions[0].upgrade.directionEvidence![0][patch.field] = patch.value;
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '必须逐字引用本题',
  );
});

test('不能借未关联材料或另一题的解析给本题方向作证', () => {
  const {analysis} = fixture();
  analysis.materials = [
    {
      id: 'unrelated',
      title: '另一材料',
      text: '未与本题关联的独有条件。',
      isListening: false,
      figureIds: [],
    },
  ];
  analysis.questions.push({
    ...clone(analysis.questions[0]),
    id: 'q2',
    number: '2',
  });
  analysis.totalScore = 10;
  const paper = generated(analysis);
  paper.answers[1].explanation += '另一题独有的关键推断。';
  paper.questions[0].upgrade.directionEvidence![0].solutionQuote =
    '另一题独有的关键推断。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '必须逐字引用本题',
  );
  paper.questions[0].upgrade.directionEvidence![0].solutionQuote =
    mathDirections[0].solutionQuote;
  paper.questions[0].upgrade.directionEvidence![0].problemQuote =
    '未与本题关联的独有条件。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '必须逐字引用本题',
  );
});

test.each(['self', 'external', 'reverse', 'forged'] as const)(
  '方向连接拒绝%s伪连接',
  kind => {
    const {analysis} = fixture();
    const paper = generated(analysis, 3);
    const connections = paper.questions[0].upgrade.directionConnections!;
    if (kind === 'self') {
      connections[0].to = connections[0].from;
    } else if (kind === 'external') {
      connections[0].to = 'math_counterexample';
    } else if (kind === 'reverse') {
      connections[1] = {
        ...connections[0],
        from: connections[0].to,
        to: connections[0].from,
      };
    } else {
      connections[0].solutionQuote = '并未出现在解析中的方向衔接';
    }
    expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
      'directionConnections',
    );
  },
);

test('连接数及每个方向有邻边仍不足，三角形与独立二点组不得冒充整体连通', () => {
  const {analysis} = fixture();
  const paper = generated(analysis, 3);
  const upgrade = paper.questions[0].upgrade;
  upgrade.directionEvidence!.push(
    {
      ...clone(mathDirections[0]),
      directionId: 'math_whole_structure',
      newDemand: '从所有数的整体量确定三组之间的共同约束。',
    },
    {
      ...clone(mathDirections[2]),
      directionId: 'math_existence_uniqueness',
      newDemand: '分别核查构造可达与全部分组唯一，区分必要和充分。',
    },
  );
  const ids = upgrade.directionEvidence!.map(item => item.directionId);
  upgrade.directionConnections = [
    [ids[0], ids[1]],
    [ids[1], ids[2]],
    [ids[2], ids[0]],
    [ids[3], ids[4]],
  ].map(([from, to]) => ({
    from,
    to,
    solutionQuote: '故每组和必须为7。',
    explanation: '用于检验有足够边数且无孤立方向时仍须实际连通。',
  }));
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    '必须使全部所选方向整体连通',
  );
});

const focusedChecks: ChallengeDepthCheck[] = [
  {
    kind: 'decision',
    description: '由目标反推共同和，先锁定后续搜索的必要总量。',
    problemQuote: '每组和相等',
    solutionQuote: '六数总和为21，故每组和必须为7。',
    explanation: '不先确定共同和，无法筛掉不可能的搭档。',
  },
  {
    kind: 'decision',
    description: '选最小未用数确定搭档，避免无组织枚举。',
    problemQuote: '每组两个数',
    solutionQuote: '最小数1只能与6配成7，继而2只能与5配成7，剩下3与4配成7。',
    explanation: '不是把各次加法重复计数，而是选择一次覆盖全部候选的处理次序。',
  },
  {
    kind: 'decision',
    description: '将一个可行例子提升为唯一搭档的完整性证明。',
    problemQuote: '求全部不同分法并说明没有遗漏',
    solutionQuote: '最小未用数的搭档每次都被和为7唯一确定，故不存在其他分组。',
    explanation:
      '只验证一个例子不能回答全部分法，必须说明任何其他候选都不可能。',
  },
  {
    kind: 'boundary',
    description: '组内及组间交换不生成新解，限定不同分组的计数边界。',
    problemQuote: '组内顺序和三组顺序不计',
    solutionQuote: '交换组内次序或三组排列仍是同一分组，不能重复计数。',
    explanation: '忽略此等价边界会把同一分法排列后重复计数。',
  },
  {
    kind: 'boundary',
    description: '等和只必要不充分，重复用数的反例界定可行构造。',
    problemQuote: '每个数恰用一次',
    solutionQuote:
      '仅把{1,6}重复三次虽每组和为7，却违反每个数恰用一次，因此等和本身不充分；本构造覆盖且不重用六数。',
    explanation:
      '该反例排除满足局部目标但违反整体覆盖的伪解，作用不同于顺序去重。',
  },
];
function focusedPaper(analysis: ExamAnalysis, level: 2 | 3) {
  const paper = generated(analysis, level);
  paper.questions[0].upgrade = {
    ...paper.questions[0].upgrade,
    depthRoute: 'focused',
    directionEvidence: clone(mathDirections.slice(0, 1)),
    directionConnections: [],
    depthChecks: clone(
      level === 2
        ? [focusedChecks[0], focusedChecks[1], focusedChecks[3]]
        : focusedChecks,
    ),
  };
  return paper;
}

test.each([2, 3] as const)(
  '数学%s档可单策略深挖，不强凑多个方向或增加机械步骤',
  level => {
    const {analysis} = fixture();
    const paper = focusedPaper(analysis, level);
    expect(() => validateChallengePaper(paper, analysis, level)).not.toThrow();
  },
);

test.each(['decision', 'boundary'] as const)(
  '聚焦路线缺少真实%s检查不能由其它类型的条数补齐',
  kind => {
    const {analysis} = fixture();
    const paper = focusedPaper(analysis, 3);
    const checks = paper.questions[0].upgrade.depthChecks!;
    checks.splice(
      checks.findIndex(item => item.kind === kind),
      1,
    );
    expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
      kind === 'decision' ? '至少3个不同关键决策' : '至少2个不同真实边界',
    );
  },
);

test('聚焦路线重复改写同一检查、伪造定位或非法类型必须拒绝', () => {
  const {analysis} = fixture();
  const original = focusedPaper(analysis, 3);
  const repeated = clone(original);
  repeated.questions[0].upgrade.depthChecks![1].solutionQuote =
    focusedChecks[0].solutionQuote;
  expect(() => validateChallengePaper(repeated, analysis, 3)).toThrow(
    '不能重复配对、拆步或改写同一检查',
  );
  const repeatedDescription = clone(original);
  repeatedDescription.questions[0].upgrade.depthChecks![4].description =
    focusedChecks[3].description + '！';
  expect(() =>
    validateChallengePaper(repeatedDescription, analysis, 3),
  ).toThrow('不能重复配对');
  const forged = clone(original);
  forged.questions[0].upgrade.depthChecks![4].problemQuote = '新增未给出的边界';
  expect(() => validateChallengePaper(forged, analysis, 3)).toThrow(
    '必须逐字引用本题',
  );
  const malformed = clone(original);
  (malformed.questions[0].upgrade.depthChecks![0] as any).kind = 'calculation';
  expect(() => validateChallengePaper(malformed, analysis, 3)).toThrow(
    '只能为decision/boundary',
  );
});

test('数学1档与其它科没有聚焦路线，组合路线也不叠加聚焦计数', () => {
  const {analysis} = fixture();
  const paper = generated(analysis);
  paper.questions[0].upgrade.depthRoute = 'focused';
  paper.questions[0].upgrade.depthChecks = clone(focusedChecks);
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'depthRoute',
  );
  const writing = fixture(
    'english',
    sourceQuestion({
      type: '书面表达',
      stem: '给Tom写邀请邮件，说明活动时间和地点。',
      knowledgePoints: ['邀请邮件', '交际目的'],
    }),
  ).analysis;
  const writingPaper = generated(writing, 3);
  writingPaper.questions[0].upgrade.depthRoute = 'focused';
  expect(() => validateChallengePaper(writingPaper, writing, 3)).toThrow(
    'depthRoute',
  );
  const combined = generated(analysis, 3);
  combined.questions[0].upgrade.depthChecks = clone(focusedChecks);
  expect(() => validateChallengePaper(combined, analysis, 3)).toThrow(
    '组合路线不应叠加',
  );
});

test('听力不需要方向证据，也不允许偷偷附加升难方向或聚焦检查', () => {
  const {analysis} = listeningFixture();
  const paper = generated(analysis, 3);
  expect(paper.questions[0].upgrade.directionEvidence).toBeUndefined();
  expect(() => validateChallengePaper(paper, analysis, 3)).not.toThrow();
  for (const key of [
    'directionEvidence',
    'directionConnections',
    'depthChecks',
  ] as const) {
    const altered = clone(paper);
    (altered.questions[0].upgrade as any)[key] = [{}];
    expect(() => validateChallengePaper(altered, analysis, 3)).toThrow(
      '听力保持不变',
    );
  }
  paper.questions[0].upgrade.depthRoute = 'focused';
  expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
    '听力不得使用聚焦',
  );
});

const guideFor = (paper: ChallengePaper) => paper.answers[0].learningGuide![0];

function samplingFixture() {
  const {analysis, page} = fixture();
  analysis.sections = [
    {id: 's1', title: '一、计算题', instructions: ''},
    {id: 's2', title: '二、应用题', instructions: ''},
  ];
  analysis.majorQuestions = analysis.sections.map((section, index) => ({
    id: `major${index + 1}`,
    title: section.title,
    sourceRefs: [{pageIndex: 0, quote: section.title}],
  }));
  const items = [
    {
      id: 'a1',
      number: '1(1)',
      majorQuestionId: 'major1',
      stem: '计算1+2的值。',
    },
    {
      id: 'a2',
      number: '1(2)',
      majorQuestionId: 'major1',
      stem: '计算4-1的值。',
    },
    {
      id: 'b1',
      number: '2(1)',
      majorQuestionId: 'major2',
      stem: '已知整数x+2=5，求x。',
    },
    {
      id: 'b2',
      number: '2(2)',
      majorQuestionId: 'major2',
      stem: '已知整数y-1=4，求y。',
    },
    {id: 'b3', number: '2(3)', majorQuestionId: 'major2', stem},
  ];
  analysis.questions = items.map(item =>
    sourceQuestion({
      ...item,
      sectionId: item.majorQuestionId === 'major1' ? 's1' : 's2',
      sourceRefs: [{pageIndex: 0, quote: `${item.number}. ${item.stem}`}],
    }),
  );
  analysis.totalScore = 25;
  page.text = `${analysis.title}\n${analysis.majorQuestions
    .map(
      major =>
        `${major.title}\n${analysis.questions
          .filter(item => item.majorQuestionId === major.id)
          .map(item => item.sourceRefs[0].quote)
          .join('\n')}`,
    )
    .join('\n')}`;
  return {analysis, pages: [page]};
}

test('通用草稿只提原卷结构和原核，模型夹带确认票据也不能直接用于生成', () => {
  const {analysis, pages} = samplingFixture();
  const draft = validateExamDraft(analysis, pages);
  expect(draft.subjectIdentification).toBeUndefined();
  expect(draft.questions).toHaveLength(5);
  expect(draft.majorQuestions?.map(major => major.id)).toEqual([
    'major1',
    'major2',
  ]);
  const unconfirmed = draft as unknown as ExamAnalysis;
  expect(() =>
    validateChallengePaper(generated(unconfirmed), unconfirmed, 1),
  ).toThrow('科目');
});

test.each([
  {draw: 0, selected: ['a1', 'b1']},
  {draw: 1 - Number.EPSILON, selected: ['a2', 'b3']},
])(
  '每大题从全部原序叶题随机抽一题，random=$draw使首末候选可达',
  ({draw, selected}) => {
    const {analysis} = samplingFixture();
    const random = jest.fn(() => draw);
    const verification = buildSubjectVerification(analysis, random);
    expect(verification.mode).toBe('title_sample');
    expect(verification.samples.map(item => item.candidateQuestionIds)).toEqual(
      [
        ['a1', 'a2'],
        ['b1', 'b2', 'b3'],
      ],
    );
    expect(verification.samples.map(item => item.selectedQuestionId)).toEqual(
      selected,
    );
    expect(random).toHaveBeenCalledTimes(2);
  },
);

test('等宽随机区间可取到三候选中每一题，不把每大题固定首题或只取前两题', () => {
  const {analysis} = samplingFixture();
  const selected = [0, 1, 2].map(
    index =>
      buildSubjectVerification(analysis, () => (index + 0.5) / 3).samples[1]
        .selectedQuestionId,
  );
  expect(selected).toEqual(['b1', 'b2', 'b3']);
});

test.each([-0.01, 1, NaN, Infinity])(
  '注入非法random=%s时拒绝静默偏向某题',
  draw => {
    expect(() =>
      buildSubjectVerification(samplingFixture().analysis, () => draw),
    ).toThrow(RangeError);
  },
);

test.each([
  'title',
  'majors',
  'assignment',
  'empty_major',
  'major_evidence',
  'question_evidence',
] as const)('缺失%s结构自动扩大全核，不抽残缺子集', field => {
  const {analysis} = samplingFixture();
  if (field === 'title') {
    analysis.titleEvidence = [];
  }
  if (field === 'majors') {
    analysis.majorQuestions = [];
  }
  if (field === 'assignment') {
    delete analysis.questions[0].majorQuestionId;
  }
  if (field === 'empty_major') {
    analysis.questions = analysis.questions.filter(
      item => item.majorQuestionId === 'major1',
    );
  }
  if (field === 'major_evidence') {
    analysis.majorQuestions![1].sourceRefs = [];
  }
  if (field === 'question_evidence') {
    analysis.questions[0].sourceRefs = [];
  }
  const random = jest.fn(() => 0.5);
  expect(buildSubjectVerification(analysis, random)).toMatchObject({
    mode: 'expanded',
    samples: [],
    expansionReason: expect.any(String),
  });
  expect(random).not.toHaveBeenCalled();
});

test('识科只发送抽中原题及必要母材料图，排除其它题和草稿学科猜测/难度', () => {
  const {analysis} = samplingFixture();
  analysis.materials = [
    {
      id: 'needed',
      title: '母题公共条件',
      text: '两组等和且每数恰用一次。',
      isListening: false,
      figureIds: ['f1'],
    },
    {
      id: 'private',
      title: '未抽中的材料',
      text: 'UNSELECTED_PRIVATE_TEXT',
      isListening: false,
      figureIds: [],
    },
  ];
  analysis.figures = [
    {
      id: 'f1',
      kind: 'source',
      pageIndex: 0,
      box: {x: 0.1, y: 0.2, width: 0.3, height: 0.2},
      caption: '本题原图。',
      containsStudentMarks: false,
    },
  ];
  analysis.questions[0].materialIds = ['needed'];
  analysis.questions[1].materialIds = ['private'];
  const before = clone(analysis);
  const verification = buildSubjectVerification(analysis, () => 0);
  const samples = subjectVerificationSamples(analysis, verification);
  expect(samples.map(item => item.question.id)).toEqual(['a1', 'b1']);
  expect(samples[0].materials.map(item => item.id)).toEqual(['needed']);
  expect(samples[0].figures.map(item => item.id)).toEqual(['f1']);
  expect(JSON.stringify(samples)).not.toContain('UNSELECTED_PRIVATE_TEXT');
  expect(samples[0].question).not.toHaveProperty('knowledgePoints');
  expect(samples[0].question).not.toHaveProperty('difficulty');
  samples[0].question.stem = '改返回值';
  samples[0].materials[0].text = '改返回材料';
  samples[0].figures[0].box.x = 0.8;
  expect(analysis).toEqual(before);
});

test('持久抽样不能缩水候选、漏掉大题、换题号或原锚，也不能丢失母题依赖', () => {
  const {analysis} = samplingFixture();
  const original = buildSubjectVerification(analysis, () => 0);
  const altered = [
    clone(original),
    clone(original),
    clone(original),
    clone(original),
  ];
  altered[0].samples[0].candidateQuestionIds = ['a1'];
  altered[1].samples.pop();
  altered[2].samples[0].selectedQuestionNumber = '1(2)';
  altered[3].samples[0].sourceRefs = [
    {pageIndex: 0, quote: '模型挑选的替代题'},
  ];
  for (const verification of altered) {
    expect(() => subjectVerificationSamples(analysis, verification)).toThrow();
  }
  analysis.questions[0].materialIds = ['missing'];
  expect(() => subjectVerificationSamples(analysis, original)).toThrow(
    '共用材料缺失',
  );
});

test('所抽后问带必要前问和本节作答说明，补依赖不算多抽且不重抽', () => {
  const {analysis} = samplingFixture();
  analysis.sections[0].instructions = '各小题按原条件说明过程。';
  analysis.questions[1].dependsOnQuestionIds = ['a1'];
  analysis.questions[1].stem = '根据上一问1(1)的结果再加1，求和值。';
  analysis.questions[0].materialIds = ['parent'];
  analysis.materials = [
    {
      id: 'parent',
      title: '前问公共条件',
      text: '1与2是本题已给的两个数。',
      isListening: false,
      figureIds: [],
    },
  ];
  const verification = buildSubjectVerification(
    analysis,
    () => 1 - Number.EPSILON,
  );
  const before = clone(verification);
  const samples = subjectVerificationSamples(analysis, verification);
  expect(verification.samples.map(item => item.selectedQuestionId)).toEqual([
    'a2',
    'b3',
  ]);
  expect(samples[0].dependencyQuestions.map(item => item.id)).toEqual(['a1']);
  expect(samples[0].section).toEqual(analysis.sections[0]);
  expect(samples[0].materials.map(item => item.id)).toEqual(['parent']);
  expect(verification).toEqual(before);
  expect(verification.samples).toHaveLength(2);
});

test.each(['missing', 'cycle', 'unlocated'] as const)(
  '必要前问依赖%s时不能静默丢弃上下文',
  kind => {
    const {analysis} = samplingFixture();
    if (kind === 'missing') {
      analysis.questions[1].dependsOnQuestionIds = ['not_in_source'];
    } else if (kind === 'cycle') {
      analysis.questions[1].dependsOnQuestionIds = ['a1'];
      analysis.questions[0].dependsOnQuestionIds = ['a2'];
    } else {
      analysis.questions[1].stem = '根据上一问的结果，继续求值。';
      analysis.questions[1].dependsOnQuestionIds = [];
    }
    const verification = buildSubjectVerification(
      analysis,
      () => 1 - Number.EPSILON,
    );
    expect(() => subjectVerificationSamples(analysis, verification)).toThrow();
  },
);

test('标题抽样证据必须逐大题覆盖抽中的真锚；扩大/旧全核仍须逐页', () => {
  const {analysis, pages} = samplingFixture();
  const verification = buildSubjectVerification(analysis, () => 0);
  const identified: SubjectIdentification = {
    status: 'confirmed',
    subject: 'math',
    courseName: '数学',
    integrated: false,
    reason: '印刷标题与各大题随机原题共同佐证数学课程。',
    evidence: [
      ...verification.titleEvidence,
      ...verification.samples.flatMap(item => item.sourceRefs),
    ],
  };
  const allPages = [
    ...pages,
    {
      ...pages[0],
      pageIndex: 1,
      documentType: 'exam_continuation' as const,
      text: '本试卷续页，继续第二大题原条件。',
    },
  ];
  expect(
    validateSubjectIdentification(identified, allPages, verification)
      .verification,
  ).toEqual(verification);
  expect(() =>
    validateSubjectIdentification(
      {...identified, evidence: identified.evidence.slice(1)},
      allPages,
      verification,
    ),
  ).toThrow('标题');
  expect(() =>
    validateSubjectIdentification(
      {...identified, evidence: identified.evidence.slice(0, -1)},
      allPages,
      verification,
    ),
  ).toThrow('抽中的');
  const expanded: SubjectVerification = {
    ...verification,
    mode: 'expanded',
    expansionReason: '抽样出现冲突，扩大核验完整原卷。',
  };
  expect(() =>
    validateSubjectIdentification(identified, allPages, expanded),
  ).toThrow('覆盖每一原页');
  expect(() => validateSubjectIdentification(identified, allPages)).toThrow(
    '覆盖每一原页',
  );
  const invalid = clone(verification);
  invalid.samples[0].selectedQuestionId = 'foreign';
  expect(() => validateSubjectVerification(invalid, pages)).toThrow(
    '完整候选集合',
  );
});

test('科目索引不夹带全部目录，按需加载单科并复用缓存', () => {
  jest.isolateModules(() => {
    const isolated: typeof import('../src/challenge/rules') =
      jest.requireActual('../src/challenge/rules');
    expect(isolated.loadedChallengeSubjects()).toEqual([]);
    for (const item of isolated.CHALLENGE_RULES.subjects) {
      expect(item).not.toHaveProperty('tiers');
      expect(item).not.toHaveProperty('masteryChallenges');
      expect(item).not.toHaveProperty('subjectBlueprint');
    }
    const math = isolated.loadChallengeSubjectRules('math');
    expect(math.subject).toBe('math');
    expect(isolated.loadedChallengeSubjects()).toEqual(['math']);
    expect(isolated.loadChallengeSubjectRules('math')).toBe(math);
    expect(isolated.getChallengePolicy('math', 3).subjectBlueprint).toBe(
      math.subjectBlueprint,
    );
    expect(isolated.loadedChallengeSubjects()).toEqual(['math']);
  });
});

test.each(['unknown', 'mixed', 'Math', '', '__proto__'])(
  '未支持科目标识%s不能在loader或policy中兜底other',
  subject => {
    expect(() => loadChallengeSubjectRules(subject as any)).toThrow(
      '科目未确认',
    );
    expect(() => getChallengePolicy(subject as any, 1)).toThrow('科目未确认');
  },
);

test('科目识别必须confirmed且引文逐字来自实际页，不能引文件名或猜造证据', () => {
  const {page, analysis} = fixture();
  const identification = analysis.subjectIdentification!;
  expect(validateSubjectIdentification(identification, [page])).toEqual(
    identification,
  );
  for (const patch of [
    {status: 'mixed'},
    {status: 'uncertain'},
    {subject: 'unknown'},
    {evidence: []},
    {evidence: [{pageIndex: 9, quote: page.text}]},
    {evidence: [{pageIndex: 0, quote: '数学试卷文件名.pdf'}]},
  ]) {
    expect(() =>
      validateSubjectIdentification({...identification, ...patch}, [page]),
    ).toThrow();
  }
  expect(() =>
    validateExamAnalysis(
      {...analysis, subject: 'english'},
      [page],
      identification,
    ),
  ).toThrow('与独立识科结果一致');
});

test('识科证据必须覆盖续页归属，不能只凭首页确认而忽略另一页', () => {
  const {page, analysis} = fixture();
  const continuation = {
    ...page,
    pageIndex: 1,
    documentType: 'exam_continuation' as const,
    text: '数学试卷续页\n2. 求另一组等和分法。',
  };
  expect(() =>
    validateSubjectIdentification(analysis.subjectIdentification, [
      page,
      continuation,
    ]),
  ).toThrow('覆盖每一原页');
  expect(() =>
    validateSubjectIdentification(
      {
        ...analysis.subjectIdentification!,
        evidence: [
          ...analysis.subjectIdentification!.evidence,
          {pageIndex: 1, quote: '数学试卷续页'},
        ],
      },
      [page, continuation],
    ),
  ).not.toThrow();
});

test('other仅接受有印刷课程名称证据的具体课程，未知或综合名称不能兜底', () => {
  const {page} = fixture();
  const originalPage = {
    ...page,
    text: '信息技术试卷\n程序输入输出与条件判断。',
  };
  const identified: SubjectIdentification = {
    status: 'confirmed',
    subject: 'other',
    courseName: '信息技术',
    integrated: false,
    reason: '印刷标题明确为信息技术，题目为程序输入输出与条件判断。',
    evidence: [{pageIndex: 0, quote: '信息技术试卷'}],
  };
  expect(validateSubjectIdentification(identified, [originalPage])).toEqual(
    identified,
  );
  const practice = {
    ...originalPage,
    text: '综合实践活动试卷\n围绕已给调查资料设计实践方案。',
  };
  expect(() =>
    validateSubjectIdentification(
      {
        ...identified,
        courseName: '综合实践活动',
        evidence: [{pageIndex: 0, quote: '综合实践活动试卷'}],
      },
      [practice],
    ),
  ).not.toThrow();
  expect(() =>
    validateSubjectIdentification(
      {...identified, evidence: [{pageIndex: 0, quote: page.text}]},
      [page],
    ),
  ).toThrow('原页科目名称证据');
  for (const name of [
    '其他',
    '未知科目',
    '未知课程',
    '未知学科',
    '待确认',
    '综合试卷',
    '综合测试',
    '混科',
    '数学',
    '英语',
  ]) {
    const source = {...page, text: `${name}：尚不能确定实际课程。`};
    expect(() =>
      validateSubjectIdentification(
        {
          ...identified,
          courseName: name,
          evidence: [{pageIndex: 0, quote: source.text}],
        },
        [source],
      ),
    ).toThrow(
      name === '数学' || name === '英语'
        ? '必须路由到对应科目规则'
        : '不能作为未知/混科兜底',
    );
  }
});

test('完整理综标题与科目结构可以确认science，数学页或仅文件名不能伪装合法综合卷', () => {
  const {page} = fixture();
  const integratedPage = {
    ...page,
    text: '普通高中理科综合能力测试\n物理部分：受力与运动\n化学部分：反应与物质\n生物部分：生命过程',
  };
  const identified: SubjectIdentification = {
    status: 'confirmed',
    subject: 'science',
    courseName: '理科综合',
    integrated: true,
    reason: '完整印刷标题及物理、化学、生物部分共同证明是正式理综结构。',
    evidence: [
      {pageIndex: 0, quote: '普通高中理科综合能力测试'},
      {
        pageIndex: 0,
        quote: '物理部分：受力与运动\n化学部分：反应与物质\n生物部分：生命过程',
      },
    ],
  };
  expect(validateSubjectIdentification(identified, [integratedPage])).toEqual(
    identified,
  );
  expect(() =>
    validateSubjectIdentification(
      {
        ...identified,
        evidence: [
          {pageIndex: 0, quote: '将1、2、3、4分成两组'},
          {pageIndex: 0, quote: '每组两个数'},
        ],
      },
      [page],
    ),
  ).toThrow();
  expect(() =>
    validateSubjectIdentification({...identified, subject: 'math'}, [
      integratedPage,
    ]),
  ).toThrow('综合课程');
});

test.each([
  {
    subject: 'physics' as const,
    point: '伏安测量',
    stem: '用伏安法测小灯泡的电阻，比较两次测得的电阻为何不同。',
    id: 'physics_circuit_measurement',
  },
  {
    subject: 'biology' as const,
    point: '光合作用净量',
    stem: '将植株由光照移入黑暗后比较测量值，解释净光合量与总光合量的关系。',
    id: 'biology_photosynthesis_net',
  },
  {
    subject: 'physics' as const,
    point: '气体状态',
    stem: '质量一定的气体缓慢受热，比较初末状态关系。',
    id: 'physics_thermal_system',
  },
])(
  '原$point任务可识别科学条件，不要求碰巧出现泛化关键词',
  ({subject, point, stem: sourceStem, id}) => {
    const source = sourceQuestion({stem: sourceStem, knowledgePoints: [point]});
    expect(
      applicableMasteryChallenges(subject, 3, source, [], point, 'high').map(
        item => item.id,
      ),
    ).toContain(id);
  },
);

test('原细胞结构识记不因同属生物学而取得高中跨膜运输卡', () => {
  const source = sourceQuestion({
    type: '术语填空',
    stem: '细胞的基本结构是什么？',
    knowledgePoints: ['细胞结构'],
  });
  expect(
    applicableMasteryChallenges(
      'biology',
      3,
      source,
      [],
      undefined,
      'high',
    ).map(item => item.id),
  ).not.toContain('biology_membrane_osmosis_conditions');
});

test('原核心有限分组可检索相关误区，仅出现整数和等量关系不授分组许可', () => {
  const groupingIds = [
    'math_case_completeness',
    'math_case_deduplication',
    'math_object_constraints',
  ];
  const partition = sourceQuestion();
  expect(
    applicableMasteryChallenges('math', 3, partition).map(item => item.id),
  ).toEqual(expect.arrayContaining(groupingIds));
  const equation = sourceQuestion({stem: '已知整数x满足x+2=5，求x。'});
  const equationIds = applicableMasteryChallenges('math', 3, equation).map(
    item => item.id,
  );
  for (const id of groupingIds) {
    expect(equationIds).not.toContain(id);
  }
  expect(
    applicableMasteryChallenges('math', 3, partition, [], '二次函数'),
  ).toEqual([]);
});

test('新题措辞或背景材料不能替原方程核心取得概率与分组目录许可', () => {
  const equation = sourceQuestion({
    stem: '已知整数x满足x+2=5，求x。',
    knowledgePoints: ['一元一次方程'],
    materialIds: ['m1'],
  });
  const {analysis} = fixture('math', equation);
  analysis.materials = [
    {
      id: 'm1',
      title: '活动背景',
      text: '同学讨论概率、有限分组和重复计数。',
      isListening: false,
      figureIds: [],
    },
  ];
  expect(
    applicableMasteryChallenges('math', 3, equation, analysis.materials).map(
      item => item.id,
    ),
  ).not.toContain('math_probability_base');
  expect(() =>
    validateChallengePaper(generated(analysis, 3), analysis, 3),
  ).toThrow('.challengeId');
});

test.each([undefined, 'mastered', '100%'])(
  '掌握标记%s不能冒充实际学生能力认证',
  status => {
    const {analysis} = fixture();
    const paper = generated(analysis);
    (paper as any).masteryStatus = status;
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      'masteryStatus 必须为training_only',
    );
  },
);

test('每原核心恰一条学习说明，三档配额按题累计而非每核心倍乘', () => {
  const {analysis} = fixture(
    'math',
    sourceQuestion({knowledgePoints: ['等量关系', '有限分组']}),
  );
  const original = generated(analysis, 3);
  expect(() => validateChallengePaper(original, analysis, 3)).not.toThrow();
  expect(
    original.answers[0].learningGuide!.map(item => item.misconceptions.length),
  ).toEqual([2, 1]);
  const guides = original.answers[0].learningGuide!;
  for (const replacement of [
    [],
    [guides[0]],
    [guides[0], guides[0]],
    [guides[0], {...guides[1], knowledgePoint: '二次函数'}],
  ]) {
    const paper = clone(original);
    paper.answers[0].learningGuide = clone(replacement);
    expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
      'learningGuide',
    );
  }
  const shared = clone(original);
  for (const guide of shared.answers[0].learningGuide!) {
    guide.misconceptions = [clone(guides[0].misconceptions[0])];
  }
  expect(() => validateChallengePaper(shared, analysis, 3)).toThrow(
    '至少3个不同可能错误来源',
  );
});

test.each([
  'coreInsight',
  'conditionBoundary',
  'reasoning',
  'problemQuote',
  'solutionQuote',
  'misconceptions',
  'transferLinks',
  'selfChecks',
] as const)('五维学习说明不能缺少%s', field => {
  const {analysis} = fixture();
  const paper = generated(analysis);
  Reflect.deleteProperty(guideFor(paper), field);
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(field);
});

test('学习原理、条件与推理不能只写口号、核心名称或复制同一句', () => {
  const {analysis} = fixture();
  const original = generated(analysis);
  for (const insight of [
    '认真审题',
    analysis.questions[0].knowledgePoints[0],
  ]) {
    const paper = clone(original);
    guideFor(paper).coreInsight = insight;
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      '泛化学习口号',
    );
  }
  guideFor(original).reasoning = guideFor(original).conditionBoundary;
  expect(() => validateChallengePaper(original, analysis, 1)).toThrow(
    '不能复制同一句话',
  );
});

test('易错训练须闭合错解→错因→纠正链，换标点或目录不增加错误来源', () => {
  const {analysis} = fixture();
  const original = generated(analysis, 3);
  const duplicated = clone(original);
  const first = guideFor(duplicated).misconceptions[0];
  guideFor(duplicated).misconceptions[1] = {
    ...clone(first),
    challengeId: 'math_case_deduplication',
    wrongApproach: first.wrongApproach + '！',
  };
  expect(() => validateChallengePaper(duplicated, analysis, 3)).toThrow(
    '不得重复同一错因',
  );
  const broken = clone(original);
  const trap = guideFor(broken).misconceptions[0];
  trap.correction = trap.whyWrong;
  expect(() => validateChallengePaper(broken, analysis, 3)).toThrow(
    '必须形成错解→错因→纠正链',
  );
  const foreign = clone(original);
  guideFor(foreign).misconceptions[0].challengeId = 'en_pragmatic_register';
  expect(() => validateChallengePaper(foreign, analysis, 3)).toThrow(
    '不适用目录不得硬套',
  );
});

test('目录未覆盖的原核心可据原文定制source_specific，但不能缺范围依据或伪造来源', () => {
  const {analysis} = fixture(
    'math',
    sourceQuestion({knowledgePoints: ['整体等和构造任务']}),
  );
  expect(applicableMasteryChallenges('math', 1, analysis.questions[0])).toEqual(
    [],
  );
  const paper = generated(analysis);
  const trap = guideFor(paper).misconceptions[0];
  trap.challengeId = 'source_specific';
  trap.scopeReason =
    '原题有限数表与两组等和任务支持核查构造和对象覆盖，不需要新计数定理。';
  trap.sourceQuote = analysis.questions[0].stem;
  expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
  trap.scopeReason = '';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'scopeReason',
  );
  trap.scopeReason = '仅核原题清晰给出的数与等和分组约束。';
  trap.sourceQuote = '原题没有给出的竞赛定理';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'sourceQuote',
  );
});

test('学习引文不能引用自身元数据、错用原新文本或擅自增加空白', () => {
  const {analysis} = fixture();
  const original = generated(analysis, 3);
  const mutations: ((guide: ChallengeLearningGuide) => void)[] = [
    guide => {
      guide.problemQuote = analysis.questions[0].stem;
    },
    guide => {
      guide.solutionQuote = guide.coreInsight;
    },
    guide => {
      guide.misconceptions[0].solutionQuote = guide.misconceptions[0].whyWrong;
    },
    guide => {
      guide.transferLinks[0].sourceQuote = partitionStem;
    },
    guide => {
      guide.transferLinks[0].problemQuote = analysis.questions[0].stem;
    },
    guide => {
      guide.transferLinks[0].solutionQuote = guide.transferLinks[0].invariant;
    },
    guide => {
      guide.selfChecks[0].solutionQuote = guide.selfChecks[0].expected;
    },
    guide => {
      guide.solutionQuote = ` ${guide.solutionQuote} `;
    },
  ];
  for (const mutate of mutations) {
    const paper = clone(original);
    mutate(guideFor(paper));
    expect(() => validateChallengePaper(paper, analysis, 3)).toThrow(
      '必须逐字引用本题对应',
    );
  }
});

test('另一题解析或未关联材料中的真句子不能替本题学习说明作证', () => {
  const {analysis} = fixture();
  analysis.questions.push({
    ...clone(analysis.questions[0]),
    id: 'q2',
    number: '2',
  });
  analysis.totalScore = 10;
  analysis.materials = [
    {
      id: 'unrelated',
      title: '另一材料',
      text: '未关联的独特原题证据。',
      isListening: false,
      figureIds: [],
    },
  ];
  const paper = generated(analysis);
  paper.answers[1].explanation += '第二题独有的解答依据。';
  guideFor(paper).solutionQuote = '第二题独有的解答依据。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'learningGuide[0].solutionQuote',
  );
  guideFor(paper).solutionQuote = '六数总和为21，故每组和必须为7。';
  guideFor(paper).transferLinks[0].sourceQuote = '未关联的独特原题证据。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'transferLinks[0].sourceQuote',
  );
});

test('同核迁移须真改条件，三档同时有原题变式和答案内条件对照', () => {
  const {analysis} = fixture();
  const original = generated(analysis, 3);
  const unchanged = clone(original);
  const transfer = guideFor(unchanged).transferLinks[0];
  transfer.changedCondition = transfer.originalCondition + '！';
  expect(() => validateChallengePaper(unchanged, analysis, 3)).toThrow(
    '原样照抄不计迁移',
  );
  const noContrast = clone(original);
  guideFor(noContrast).transferLinks[1].kind = 'source_to_variant';
  expect(() => validateChallengePaper(noContrast, analysis, 3)).toThrow(
    '升3档另须当前条件',
  );
  const duplicated = clone(original);
  guideFor(duplicated).transferLinks[1] = {
    ...clone(guideFor(duplicated).transferLinks[0]),
    kind: 'condition_contrast',
  };
  expect(() => validateChallengePaper(duplicated, analysis, 3)).toThrow(
    '不得复制同一变化',
  );
});

test('自检须区分条件、推理、结果，重复重算或把结论照抄成操作都拒绝', () => {
  const {analysis} = fixture();
  const original = generated(analysis, 3);
  const repeated = clone(original);
  for (const item of guideFor(repeated).selfChecks) {
    item.kind = 'result';
  }
  expect(() => validateChallengePaper(repeated, analysis, 3)).toThrow(
    '同类自检不得重复',
  );
  const copied = clone(original);
  guideFor(copied).selfChecks[0].method =
    guideFor(copied).selfChecks[0].expected;
  expect(() => validateChallengePaper(copied, analysis, 3)).toThrow(
    '自检操作与预期须分别说明',
  );
  const relabeled = clone(original);
  for (const item of guideFor(relabeled).selfChecks) {
    item.method = guideFor(original).selfChecks[0].method;
    item.expected = guideFor(original).selfChecks[0].expected;
  }
  expect(() => validateChallengePaper(relabeled, analysis, 3)).toThrow();
});

test('听力不附掌握训练，阅读材料的掌握原话不误判为系统学生诊断', () => {
  const listening = listeningFixture();
  const paper = generated(listening.analysis, 3);
  expect(paper.answers[0].learningGuide).toEqual([]);
  expect(() =>
    validateChallengePaper(paper, listening.analysis, 3),
  ).not.toThrow();
  paper.answers[0].learningGuide = [guideFor(generated(fixture().analysis))];
  expect(() => validateChallengePaper(paper, listening.analysis, 3)).toThrow(
    '听力保持原样，不能新增掌握训练',
  );
  const {analysis} = fixture();
  analysis.materials = [
    {
      id: 'm1',
      title: '原题引语',
      text: '他在日记中写道：“我已经掌握这段舞蹈。”',
      isListening: false,
      figureIds: [],
    },
  ];
  analysis.questions[0].materialIds = ['m1'];
  expect(() =>
    validateChallengePaper(generated(analysis), analysis, 1),
  ).not.toThrow();
});

test('畸形学习说明返回明确校验错误，不发生嵌套类型崩溃', () => {
  const {analysis} = fixture();
  for (const value of [null, {}, [null]]) {
    const paper = generated(analysis);
    (paper.answers[0] as any).learningGuide = value;
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      '挑战试卷校验未通过',
    );
  }
  for (const key of ['misconceptions', 'transferLinks', 'selfChecks']) {
    const paper = generated(analysis);
    (guideFor(paper) as any)[key] = [null];
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      '挑战试卷校验未通过',
    );
  }
});

test.each([
  {
    subject: 'math' as const,
    point: '导数最值',
    stem: '函数f(x)=x^3-3x，利用导数求区间[-2,2]内的最值。',
    id: 'math_derivative_domain_extrema',
  },
  {
    subject: 'physics' as const,
    point: '动量守恒',
    stem: '比较碰撞前后系统动量的方向关系，给出动量守恒适用条件。',
    id: 'physics_momentum_system_direction',
  },
  {
    subject: 'math' as const,
    point: '向量夹角',
    stem: '两非零向量方向相同，比较它们的夹角，并说明零向量能否照此定义夹角。',
    id: 'math_vector_zero_projection',
  },
  {
    subject: 'chemistry' as const,
    point: '电子转移',
    stem: '1mol Fe2+转化为Fe3+，计算该过程转移的电子数。',
    id: 'chemistry_redox_electron_basis',
  },
  {
    subject: 'biology' as const,
    point: 'DNA复制',
    stem: '根据DNA复制过程，比较模板链与新合成链的对应关系。',
    id: 'biology_information_direction_template',
  },
])(
  '高中$subject目录只在对应原子核心及已知高中学段适用',
  ({subject, point, stem: sourceStem, id}) => {
    const source = sourceQuestion({stem: sourceStem, knowledgePoints: [point]});
    expect(
      applicableMasteryChallenges(subject, 3, source, [], point, 'high').map(
        item => item.id,
      ),
    ).toContain(id);
    for (const level of ['middle', 'unknown'] as const) {
      expect(
        applicableMasteryChallenges(subject, 3, source, [], point, level).map(
          item => item.id,
        ),
      ).not.toContain(id);
    }
    for (const broadPoint of ['宽泛学科背景', '电学', '遗传', '函数']) {
      expect(
        applicableMasteryChallenges(
          subject,
          3,
          {...source, knowledgePoints: [broadPoint]},
          [],
          undefined,
          'high',
        ).map(item => item.id),
      ).not.toContain(id);
    }
  },
);

test.each(['question', 'material'] as const)(
  '本题通过%s关联的核实图caption可作证，重建图的新caption不能冒充原图来源',
  link => {
    const {analysis} = fixture();
    const sourceFigure = {
      id: 'f1',
      kind: 'source' as const,
      pageIndex: 0,
      box: {x: 0.1, y: 0.2, width: 0.4, height: 0.2},
      caption: '原图列出1、2、3、4，两个框代表等和分组。',
      containsStudentMarks: false,
    };
    analysis.figures = [sourceFigure];
    if (link === 'question') {
      analysis.questions[0].figureIds = ['f1'];
    } else {
      analysis.materials = [
        {
          id: 'm1',
          title: '题图',
          text: '',
          isListening: false,
          figureIds: ['f1'],
        },
      ];
      analysis.questions[0].materialIds = ['m1'];
    }
    const paper = generated(analysis);
    paper.figures = [
      {
        id: 'f1',
        kind: 'drawing',
        width: 200,
        height: 80,
        caption: '新图列出1、2、3、4、5、6。',
        elements: [{kind: 'text', x: 10, y: 20, text: '1 2 3 4 5 6'}],
      },
    ];
    paper.questions[0].upgrade.directionEvidence![0].problemQuote =
      paper.figures[0].caption;
    guideFor(paper).problemQuote = paper.figures[0].caption;
    guideFor(paper).transferLinks[0].sourceQuote = sourceFigure.caption;
    guideFor(paper).transferLinks[0].problemQuote = paper.figures[0].caption;
    expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
    guideFor(paper).transferLinks[0].sourceQuote = paper.figures[0].caption;
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
      'sourceQuote',
    );
  },
);

test('别题图caption即使真实存在，也不能作本题策略或学习证据', () => {
  const {analysis} = fixture();
  analysis.questions.push({
    ...clone(analysis.questions[0]),
    id: 'q2',
    number: '2',
    figureIds: ['f2'],
  });
  analysis.totalScore = 10;
  analysis.figures = [
    {
      id: 'f2',
      kind: 'source',
      pageIndex: 0,
      box: {x: 0.1, y: 0.2, width: 0.4, height: 0.2},
      caption: '第二题专属图形条件。',
      containsStudentMarks: false,
    },
  ];
  const paper = generated(analysis);
  paper.questions[0].upgrade.directionEvidence![0].problemQuote =
    analysis.figures[0].caption;
  guideFor(paper).problemQuote = analysis.figures[0].caption;
  guideFor(paper).transferLinks[0].sourceQuote = analysis.figures[0].caption;
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'directionEvidence[0].problemQuote',
  );
  paper.questions[0].upgrade.directionEvidence![0].problemQuote = '每组和相等';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    'learningGuide[0].problemQuote',
  );
});

function retainedPaper(
  total = 7,
  level: ChallengeLevel = 1,
  count = minimumUpgradeCount(total, level),
) {
  const {analysis} = fixture();
  analysis.questions = Array.from({length: total}, (_, index) => ({
    ...clone(analysis.questions[0]),
    id: `q${index + 1}`,
    number: String(index + 1),
  }));
  analysis.totalScore = total * 5;
  const paper = generated(analysis, level);
  for (let index = count; index < total; index += 1) {
    retainQuestion(paper, analysis, index);
  }
  return {analysis, paper};
}
function retainQuestion(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  index: number,
) {
  const original = clone(analysis.questions[index]);
  Reflect.deleteProperty(original, 'sourceRefs');
  Reflect.deleteProperty(original, 'difficulty');
  paper.questions[index] = {
    ...original,
    upgrade: {
      mode: 'retained',
      retentionReason: '该题原条件窄，当前档位缺少可靠的同范围提升空间。',
      level: paper.level,
      metrics: {},
      changes: [],
      pitfalls: [],
      scopeExplanation: '按原印刷题文原样保留，不计升档。',
    },
  };
  paper.answers[index] = {
    questionId: original.id,
    status: 'verified',
    answer: '{1,4}和{2,3}',
    explanation: '两组各有两个数，两组的和都为5。',
    scoringPoints: ['按原条件给出等和分组'],
  };
}

test.each([
  {level: 1 as const, count: 2},
  {level: 2 as const, count: 3},
  {level: 3 as const, count: 5},
])(
  '7道非听力题升$level档至少$count题，保留题不强加深度配额',
  ({level, count}) => {
    const {analysis, paper} = retainedPaper(7, level);
    expect(minimumUpgradeCount(7, level)).toBe(count);
    expect(validateChallengePaper(paper, analysis, level)).toEqual(paper);
    expect(challengeCoverage(analysis, level, paper)).toMatchObject({
      total: 7,
      upgraded: count,
      required: count,
    });
    retainQuestion(paper, analysis, count - 1);
    expect(() => validateChallengePaper(paper, analysis, level)).toThrow(
      '至少',
    );
  },
);

test('听力不参与覆盖率分母，非听力保留题仍参与分母', () => {
  const {analysis, paper} = retainedPaper(5, 2, 2);
  const listening = {
    ...clone(analysis.questions[0]),
    id: 'audio',
    number: '6',
    isListening: true,
  };
  analysis.questions.push(listening);
  paper.questions.push({
    ...listening,
    upgrade: {
      mode: 'retained',
      retentionReason: '听力保持不变',
      level: 2,
      metrics: {},
      changes: [],
      pitfalls: [],
      scopeExplanation: '沿用原录音',
    },
  });
  expect(challengeCoverage(analysis, 2, paper)).toMatchObject({
    total: 5,
    required: 2,
    upgraded: 2,
    retained: 3,
    percent: 40,
  });
});

test.each(['stem', 'options', 'answerLines'] as const)(
  '保留题不能暗改%s或伪报升档指标',
  field => {
    const {analysis, paper} = retainedPaper();
    const question = paper.questions[6];
    if (field === 'stem') {
      question.stem += '增加一项条件。';
    }
    if (field === 'options') {
      question.options.push({label: 'A', text: '新增选项'});
    }
    if (field === 'answerLines') {
      question.answerLines += 1;
    }
    expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('保留题');
  },
);

test('保留题共享材料与依赖前问都被冻结，升档不能间接修改原题', () => {
  const {analysis, paper} = retainedPaper();
  analysis.materials = [
    {
      id: 'm1',
      title: '原共享材料',
      text: '四个整数依次为1、2、3、4。',
      isListening: false,
      figureIds: [],
    },
  ];
  paper.materials = clone(analysis.materials);
  analysis.questions[6].materialIds = ['m1'];
  paper.questions[6].materialIds = ['m1'];
  paper.materials[0].text += '新增第五个整数。';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '保留题共享材料',
  );
  paper.materials = clone(analysis.materials);
  analysis.questions[6].dependsOnQuestionIds = ['q1'];
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow(
    '依赖的前问',
  );
});

test('单题分析存疑可保留，不能强行改题；其答案不可靠时明确待核', () => {
  const {analysis, paper} = retainedPaper();
  analysis.questions[6].analysisIssues = ['具体考点归属尚需教师核实'];
  paper.answers[6] = {
    ...paper.answers[6],
    status: 'requires_review',
    answer: '',
    explanation: '参考答案待核：原题条件的适用边界尚需核实。',
    scoringPoints: [],
  };
  expect(() => validateChallengePaper(paper, analysis, 1)).not.toThrow();
  paper.answers[6].answer = '未经核验的确定答案';
  expect(() => validateChallengePaper(paper, analysis, 1)).toThrow('明确待核');
  const upgraded = generated(analysis);
  expect(() => validateChallengePaper(upgraded, analysis, 1)).toThrow(
    '不得强行升档',
  );
});

test('首次只取3道不同小题，追加沿固定题池每次一题，不因缺标题送整卷', () => {
  const {analysis, pages} = samplingFixture();
  analysis.titleEvidence = [];
  const initial = buildProgressiveSubjectVerification(analysis, () => 0.5);
  expect(initial.samples).toHaveLength(3);
  expect(
    new Set(initial.samples.map(sample => sample.selectedQuestionId)).size,
  ).toBe(3);
  expect(subjectVerificationSamples(analysis, initial)).toHaveLength(3);
  expect(validateSubjectVerification(initial, pages).mode).toBe('progressive');
  const fourth = appendSubjectSample(analysis, initial);
  const fifth = appendSubjectSample(analysis, fourth);
  expect(fourth.samples).toHaveLength(4);
  expect(fifth.samples).toHaveLength(5);
  expect(fifth.samples.slice(0, 3)).toEqual(initial.samples);
  expect(() => appendSubjectSample(analysis, fifth)).toThrow('耗尽');
});

function sampleVotes(
  verification: SubjectVerification,
  subjects: SubjectSampleVote['subject'][],
): SubjectSampleVote[] {
  return subjects.map((subject, index) => ({
    questionId: verification.samples[index].selectedQuestionId,
    subject,
    courseName:
      subject === 'math'
        ? '数学'
        : subject === 'english'
        ? '英语'
        : subject === 'physics'
        ? '物理'
        : '',
    integrated: false,
    reason: '依据该小题实际印刷任务独立判断课程。',
    evidence:
      subject === 'unknown' ? [] : verification.samples[index].sourceRefs,
  }));
}

test('初抽3题需一致，初始2:1也先追加，追加后才按严格多数确认', () => {
  const {analysis} = samplingFixture();
  const initial = buildProgressiveSubjectVerification(analysis, () => 0.1);
  expect(
    subjectConsensus({
      ...initial,
      votes: sampleVotes(initial, ['math', 'math', 'math']),
    }),
  ).toMatchObject({subject: 'math', supportCount: 3});
  expect(
    subjectConsensus({
      ...initial,
      votes: sampleVotes(initial, ['math', 'math', 'english']),
    }),
  ).toBeUndefined();
  const fourth = appendSubjectSample(analysis, initial);
  expect(
    subjectConsensus({
      ...fourth,
      votes: sampleVotes(fourth, ['math', 'math', 'english', 'math']),
    }),
  ).toMatchObject({subject: 'math', supportCount: 3, total: 4});
  expect(
    subjectConsensus({
      ...fourth,
      votes: sampleVotes(fourth, ['math', 'math', 'english', 'english']),
    }),
  ).toBeUndefined();
  const fifth = appendSubjectSample(analysis, fourth);
  expect(
    subjectConsensus({
      ...fifth,
      votes: sampleVotes(fifth, ['math', 'math', 'english', 'english', 'math']),
    }),
  ).toMatchObject({subject: 'math', supportCount: 3, total: 5});
});

test('未知票留在分母，每次响应只能为本轮新增题投票且引用真实原锚', () => {
  const {analysis, pages} = samplingFixture();
  const initial = buildProgressiveSubjectVerification(analysis);
  const inputs = subjectVerificationSamples(analysis, initial);
  const votes = sampleVotes(initial, ['math', 'unknown', 'unknown']);
  expect(subjectConsensus({...initial, votes})).toBeUndefined();
  expect(validateSubjectVotes({votes}, pages, initial, inputs)).toEqual(votes);
  votes[0].questionId = 'not_selected';
  expect(() => validateSubjectVotes({votes}, pages, initial, inputs)).toThrow(
    '新增题',
  );
});

test('递进抽样不能替换已抽题、删减完整题池或伪造多数确认', () => {
  const {analysis, pages} = samplingFixture();
  const initial = buildProgressiveSubjectVerification(analysis);
  const tampered = clone(initial);
  tampered.candidateOrder!.pop();
  expect(() => subjectVerificationSamples(analysis, tampered)).toThrow(
    '完整题池',
  );
  const mixed = {
    ...initial,
    votes: sampleVotes(initial, ['math', 'math', 'unknown']),
  };
  const identified = {
    ...analysis.subjectIdentification!,
    evidence: [
      ...initial.titleEvidence,
      ...mixed.votes.flatMap(vote => vote.evidence),
    ],
  };
  expect(() => validateSubjectIdentification(identified, pages, mixed)).toThrow(
    '超过半数',
  );
});

test.each([
  ['九年级数学期中试卷', 'math', '数学'],
  ['English Test Paper', 'english', '英语'],
  ['道德与法治试卷', 'politics', '道德与法治'],
  ['理科综合（物理化学生物）试卷', 'science', '理科综合'],
  ['信息技术试卷', 'other', '信息技术'],
] as const)(
  '先从真实印刷标题%s识别%s，尚不视为已核验',
  (quote, subject, courseName) => {
    expect(guessSubjectFromTitle([{pageIndex: 0, quote}])).toMatchObject({
      subject,
      courseName,
    });
    const {analysis, pages} = samplingFixture();
    analysis.titleEvidence = [{pageIndex: 0, quote}];
    pages[0].text = quote + '\n' + pages[0].text;
    const verification = buildProgressiveSubjectVerification(analysis);
    expect(verification.titleGuess?.subject).toBe(subject);
    expect(verification.titleVerification).toBe('pending');
    expect(verification.samples).toHaveLength(3);
  },
);

test('无标题、通用标题和混科标题不猜科，文件名不能当标题证据', () => {
  expect(guessSubjectFromTitle([])).toBeUndefined();
  expect(
    guessSubjectFromTitle([{pageIndex: 0, quote: '期末测试试卷'}]),
  ).toBeUndefined();
  expect(
    guessSubjectFromTitle([{pageIndex: 0, quote: '数学与英语混合练习'}]),
  ).toBeUndefined();
  const {analysis} = samplingFixture();
  analysis.title = '数学.pdf';
  analysis.titleEvidence = [];
  const verification = buildProgressiveSubjectVerification(analysis);
  expect(verification.titleGuess).toBeUndefined();
  expect(verification.titleVerification).toBe('unavailable');
  expect(verification.samples).toHaveLength(3);
});

test('不能伪造标题初判或跳过三题核验直接宣称标题已确认', () => {
  const {analysis, pages} = samplingFixture();
  const verification = buildProgressiveSubjectVerification(analysis);
  expect(() =>
    validateSubjectVerification(
      {
        ...verification,
        titleGuess: {
          subject: 'english',
          courseName: '英语',
          evidence: verification.titleEvidence,
        },
      },
      pages,
    ),
  ).toThrow('标题初判');
  expect(() =>
    validateSubjectVerification(
      {...verification, titleVerification: 'verified'},
      pages,
    ),
  ).toThrow('须经抽样');
});
