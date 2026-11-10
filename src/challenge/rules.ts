import rules from '../assets/challenge/common.json';
import {
  ChallengeLevel,
  ChallengeSubject,
  PaperMaterial,
  PaperQuestion,
} from './types';

export type ChallengeMetricApplicability =
  | 'all'
  | 'non_listening'
  | 'writing'
  | 'reasoning';
export type ChallengeTaskCondition =
  | 'quantitative'
  | 'experimental'
  | 'scientific_conditions'
  | 'evidence'
  | 'spatial'
  | 'comparison'
  | 'geometric'
  | 'discrete'
  | 'relations'
  | 'invariant'
  | 'argument'
  | 'finite_objects';
export interface ChallengeMetric {
  key: string;
  label: string;
  min: number;
  max?: number;
  appliesTo: ChallengeMetricApplicability;
  taskCondition?: ChallengeTaskCondition;
}
export interface ChallengeDeepDirection {
  id: string;
  name: string;
  description: string;
  appliesTo: Exclude<ChallengeMetricApplicability, 'all'>;
  taskCondition?: ChallengeTaskCondition;
  sourceIds: string[];
}
export interface ChallengeDepthRequirements {
  minDirections: number;
  minConnections: number;
  requireNecessityExplanation: boolean;
  focusedRoute?: {
    minDirections: number;
    minDecisions: number;
    minBoundaryChecks: number;
  };
}
export type ChallengeMasteryDimension =
  | 'concept_boundary'
  | 'diagnosis_correction'
  | 'reasoning_evidence'
  | 'variant_transfer'
  | 'integrated_self_check';
export interface ChallengeMasteryRequirements {
  requireEveryCore: boolean;
  requiredDimensions: ChallengeMasteryDimension[];
  minMisconceptions: number;
  minTransferLinks: number;
  minSelfChecks: number;
  requireEvidence: boolean;
}
export interface ChallengeMasteryChallenge {
  id: string;
  name: string;
  knowledgeKeywords: string[];
  appliesTo: Exclude<ChallengeMetricApplicability, 'all'>;
  taskCondition?: ChallengeTaskCondition;
  educationLevels?: ('middle' | 'high')[];
  misconception: string;
  diagnosticContrast: string;
  correctionTarget: string;
  transferTarget: string;
  selfCheckTarget: string;
  sourceIds: string[];
}
export interface ChallengeTier {
  level: ChallengeLevel;
  label: string;
  summary: string;
  aspects: string[];
  metrics: ChallengeMetric[];
  depthRequirements: ChallengeDepthRequirements;
  masteryRequirements: ChallengeMasteryRequirements;
}
export interface ChallengeSubjectPolicy {
  subject: ChallengeSubject;
  label: string;
  summary: string;
  tiers: ChallengeTier[];
  deepDirections: ChallengeDeepDirection[];
  masteryChallenges: ChallengeMasteryChallenge[];
  subjectBlueprint: ChallengeSubjectBlueprint;
}
export interface ChallengeSubjectBlueprint {
  coreDomains: string[];
  misconceptionMechanisms: string[];
  difficultyProgression: {level: ChallengeLevel; qualityTargets: string[]}[];
  masteryAcceptance: string[];
  questionTypeGuidance: {
    questionType: string;
    design: string;
    answerEvidence: string;
  }[];
  scopeExclusions: string[];
}
export interface ChallengeSubjectIndex {
  subject: ChallengeSubject;
  label: string;
  summary: string;
}

export const CHALLENGE_RULES = rules as Omit<typeof rules, 'subjects'> & {
  subjects: ChallengeSubjectIndex[];
};
export const CHALLENGE_POLICY_VERSION = `${rules.id}:${rules.version}`;
export const CHALLENGE_SUBJECTS = CHALLENGE_RULES.subjects.map(
  item => item.subject,
);
export const CHALLENGE_STANDARD_REVIEW_ROLES = [
  'subject_scope',
  'import_fidelity',
  'pdf_answer',
  'user_workflow',
  'independent_quality',
] as const;
const subjectModules: Record<ChallengeSubject, () => unknown> = {
  math: () => require('../assets/challenge/subjects/math.json'),
  english: () => require('../assets/challenge/subjects/english.json'),
  chinese: () => require('../assets/challenge/subjects/chinese.json'),
  physics: () => require('../assets/challenge/subjects/physics.json'),
  chemistry: () => require('../assets/challenge/subjects/chemistry.json'),
  biology: () => require('../assets/challenge/subjects/biology.json'),
  history: () => require('../assets/challenge/subjects/history.json'),
  geography: () => require('../assets/challenge/subjects/geography.json'),
  politics: () => require('../assets/challenge/subjects/politics.json'),
  science: () => require('../assets/challenge/subjects/science.json'),
  other: () => require('../assets/challenge/subjects/other.json'),
};
const loadedSubjects = new Map<ChallengeSubject, ChallengeSubjectPolicy>();

export function loadChallengeSubjectRules(
  subject: ChallengeSubject,
): ChallengeSubjectPolicy {
  if (!CHALLENGE_SUBJECTS.includes(subject)) {
    throw new Error('试卷科目未确认，不能默认套用其他学科规则');
  }
  const cached = loadedSubjects.get(subject);
  if (cached) {
    return cached;
  }
  const loaded = subjectModules[subject]() as {
    policyVersion: string;
    policy: ChallengeSubjectPolicy;
  };
  if (
    loaded.policyVersion !== CHALLENGE_POLICY_VERSION ||
    loaded.policy?.subject !== subject
  ) {
    throw new Error('分科规则版本或科目不一致，请先同步当前标准');
  }
  loadedSubjects.set(subject, loaded.policy);
  return loaded.policy;
}

export function loadedChallengeSubjects(): readonly ChallengeSubject[] {
  return [...loadedSubjects.keys()];
}

export function challengeStandardApproved(
  review: unknown = CHALLENGE_RULES.standardReview,
): boolean {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return false;
  }
  const value = review as Record<string, unknown>;
  const complete = (items: unknown) =>
    Array.isArray(items) &&
    items.length === CHALLENGE_STANDARD_REVIEW_ROLES.length &&
    new Set(items).size === items.length &&
    CHALLENGE_STANDARD_REVIEW_ROLES.every(role => items.includes(role));
  if (
    value.status !== 'approved' ||
    value.scope !== 'difficulty_standard_only' ||
    value.reviewedPolicyVersion !== CHALLENGE_POLICY_VERSION ||
    !complete(value.roles) ||
    !complete(value.completedRoles) ||
    !Array.isArray(value.reviews) ||
    value.reviews.length !== CHALLENGE_STANDARD_REVIEW_ROLES.length
  ) {
    return false;
  }
  const reviews = value.reviews as {
    role?: unknown;
    status?: unknown;
    conclusion?: unknown;
  }[];
  return CHALLENGE_STANDARD_REVIEW_ROLES.every(
    role =>
      reviews.filter(
        item =>
          item &&
          item.role === role &&
          item.status === 'approved' &&
          typeof item.conclusion === 'string' &&
          item.conclusion.trim(),
      ).length === 1,
  );
}

export function challengeSubjectLabel(subject: ChallengeSubject) {
  return (
    CHALLENGE_RULES.subjects.find(item => item.subject === subject)?.label ||
    '其他学科'
  );
}

export function getChallengePolicy(
  subject: ChallengeSubject,
  level: ChallengeLevel,
): ChallengeTier & {
  subject: ChallengeSubject;
  subjectLabel: string;
  deepDirections: ChallengeDeepDirection[];
  masteryChallenges: ChallengeMasteryChallenge[];
  subjectBlueprint: ChallengeSubjectBlueprint;
  sourceIds: string[];
} {
  const policy = loadChallengeSubjectRules(subject);
  const tier = policy.tiers.find(item => item.level === level);
  if (!tier) {
    throw new Error('升档难度必须为1、2或3档');
  }
  return {
    ...tier,
    subject: policy.subject,
    subjectLabel: policy.label,
    deepDirections: policy.deepDirections,
    masteryChallenges: policy.masteryChallenges,
    subjectBlueprint: policy.subjectBlueprint,
    sourceIds: [
      ...new Set(
        [...policy.deepDirections, ...policy.masteryChallenges].flatMap(
          item => item.sourceIds,
        ),
      ),
    ],
  };
}

export function isWritingQuestion(
  question: Pick<PaperQuestion, 'type' | 'isListening'>,
) {
  return (
    !question.isListening &&
    /作文|写作|书面表达|续写|应用文|写话|writing|composition|essay|continuation/i.test(
      question.type,
    )
  );
}

export function isReasoningQuestion(
  question: Pick<PaperQuestion, 'type' | 'isListening'> &
    Partial<Pick<PaperQuestion, 'stem'>>,
) {
  if (question.isListening || isWritingQuestion(question)) {
    return false;
  }
  return (
    /计算|解答|证明|应用|分析|推理|综合|实验|探究|阅读|理解|材料|情境|辨析|论证|解释|比较|图表|data|reason|analysis|calculation|proof|reading|experiment|application/i.test(
      question.type,
    ) ||
    /根据|材料|图中|表中|如图|数据|实验|探究|对照|变量|推断|解释|为什么|原因|比较|判断.*依据|若.*则|已知|\d\s*[+\-*/=<>]|[a-z]\s*[+\-*/=<>]/i.test(
      question.stem || '',
    )
  );
}

function questionTaskContext(
  question: PaperQuestion,
  materials: PaperMaterial[],
) {
  const linkedMaterials = materials.filter(item =>
    question.materialIds.includes(item.id),
  );
  return `${question.type} ${question.stem} ${question.knowledgePoints.join(
    ' ',
  )} ${
    linkedMaterials.some(material => material.text.trim()) ? '材料证据' : ''
  } ${
    question.figureIds.length ||
    linkedMaterials.some(material => material.figureIds.length)
      ? '图形证据'
      : ''
  } ${linkedMaterials.map(item => `${item.title} ${item.text}`).join(' ')}`;
}

function applicableToQuestion(
  requirement: {
    appliesTo: ChallengeMetricApplicability;
    taskCondition?: ChallengeTaskCondition;
  },
  question: PaperQuestion,
  context: string,
) {
  const conditions: Record<ChallengeTaskCondition, RegExp> = {
    quantitative: /计算|方程|函数|公式|模型|数值|比例|\d|[a-z]\s*[+\-*/=<>]/i,
    experimental: /实验|探究|对照|变量|控制组|测量|experiment/i,
    scientific_conditions:
      /反应|实验|装置|测量|现象|过程|加热|溶液|条件|电路|电阻|电流|电压|伏安|灯泡|气体状态|热力学|光合(?:作用)?|呼吸作用|跨膜|渗透|物质运输/i,
    evidence:
      /材料|图表|图形|图中|图示|图像|图谱|图片|图线|地图|[如上下左右]图|图\s*[0-9一二三四五六七八九十]|表格|表中|[上下]表|表\s*[0-9一二三四五六七八九十]|数据|实验|现象|证据|阅读|source|data|reading/i,
    spatial:
      /空间|区域|位置|方向|比例尺|尺度|地理|地图|气候|地形|时序|河流|纬度|经度/i,
    comparison: /比较|变化|异同|因果|阶段|关系|原因|影响|对比/i,
    geometric:
      /几何|图形|三角|四边形|平行|垂直|圆|角|对称|坐标|面积|体积|全等|相似|geometry/i,
    discrete:
      /整数|自然数|奇偶|整除|倍数|余数|计数|排列|组合|概率|配对|分组|个数|integer|count/i,
    finite_objects:
      /分组|分配|配对|每组|每个.{0,12}(?:一次|恰用)|排列|排队|放入|抽取|枚举|不同分法|有限.{0,6}(?:对象|集合)|grouping|pairing|allocation|enumerat/i,
    relations:
      /函数|方程|不等式|数列|关系|比例|等量|和|差|积|商|分组|配对|可行|存在|唯一|参数|解|最[大小]|临界|条件|function|equation/i,
    invariant:
      /操作|变换|变动|变化|交换|移动|整数|自然数|运算|加法|减法|等量|等式|关系|状态|分组|配对|operation|change/i,
    argument:
      /观点|论证|推断|判断|依据|主张|原因|关系|影响|比较|阅读|理解|作者|论述|材料|argument|claim|reading/i,
  };
  return (
    !question.isListening &&
    (requirement.appliesTo === 'all' ||
      requirement.appliesTo === 'non_listening' ||
      (requirement.appliesTo === 'writing' && isWritingQuestion(question)) ||
      (requirement.appliesTo === 'reasoning' &&
        isReasoningQuestion({...question, stem: context}))) &&
    (!requirement.taskCondition ||
      conditions[requirement.taskCondition].test(context))
  );
}

export function applicableChallengeMetrics(
  subject: ChallengeSubject,
  level: ChallengeLevel,
  question: PaperQuestion,
  materials: PaperMaterial[] = [],
) {
  const context = questionTaskContext(question, materials);
  return getChallengePolicy(subject, level).metrics.filter(metric =>
    applicableToQuestion(metric, question, context),
  );
}

export function applicableChallengeDirections(
  subject: ChallengeSubject,
  level: ChallengeLevel,
  question: PaperQuestion,
  materials: PaperMaterial[] = [],
) {
  const context = questionTaskContext(question, materials);
  return getChallengePolicy(subject, level).deepDirections.filter(direction =>
    applicableToQuestion(direction, question, context),
  );
}

export function applicableMasteryChallenges(
  subject: ChallengeSubject,
  level: ChallengeLevel,
  question: PaperQuestion,
  materials: PaperMaterial[] = [],
  knowledgePoint?: string,
  educationLevel: 'middle' | 'high' | 'unknown' = 'unknown',
) {
  if (
    question.isListening ||
    (knowledgePoint !== undefined &&
      !question.knowledgePoints.includes(knowledgePoint))
  ) {
    return [];
  }
  const corePoints =
    knowledgePoint === undefined ? question.knowledgePoints : [knowledgePoint];
  const normalize = (text: string) =>
    text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  const context = questionTaskContext(question, materials);
  return getChallengePolicy(subject, level).masteryChallenges.filter(
    challenge =>
      (!challenge.educationLevels ||
        (educationLevel === 'unknown'
          ? challenge.educationLevels.includes('middle') &&
            challenge.educationLevels.includes('high')
          : challenge.educationLevels.includes(educationLevel))) &&
      challenge.knowledgeKeywords.some(
        keyword =>
          !!normalize(keyword) &&
          corePoints.some(point =>
            normalize(point).includes(normalize(keyword)),
          ),
      ) &&
      applicableToQuestion(challenge, question, context),
  );
}
