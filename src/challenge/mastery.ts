import {applicableMasteryChallenges, getChallengePolicy} from './rules';
import {exactEvidenceQuote, questionEvidenceSources} from './evidence';
import {masteryCatalogValidationMessage} from './masteryCatalog';
import {
  ChallengeFigure,
  ChallengeLevel,
  ExamAnalysis,
  PaperMaterial,
  PaperQuestion,
} from './types';

interface MasteryCheck {
  require(condition: unknown, message: string): void;
  text(value: unknown, field: string, allowEmpty?: boolean): void;
  array(
    value: unknown,
    field: string,
    min?: number,
    max?: number,
  ): value is any[];
}
function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}
function fingerprint(value: unknown) {
  return typeof value === 'string'
    ? (
        value
          .normalize('NFKC')
          .toLowerCase()
          .match(/[\p{L}\p{N}+\-*/=<>≤≥≠^%]/gu) || []
      ).join('')
    : '';
}
/** Validate the learner-facing explanation against the original core and real solution. */
export function validateLearningGuides(
  answer: Record<string, any>,
  generatedQuestion: Record<string, any>,
  source: PaperQuestion,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  generatedMaterials: PaperMaterial[],
  generatedFigures: ChallengeFigure[],
  field: string,
  check: MasteryCheck,
) {
  const path = `${field}.learningGuide`;
  if (source.isListening) {
    check.require(
      answer.learningGuide === undefined ||
        (Array.isArray(answer.learningGuide) &&
          answer.learningGuide.length === 0),
      `${path} 听力保持原样，不能新增掌握训练或借学习说明猜测听力答案`,
    );
    return;
  }
  const requirements = getChallengePolicy(
    analysis.subject,
    level,
  ).masteryRequirements;
  if (
    !check.array(
      answer.learningGuide,
      path,
      source.knowledgePoints.length,
      source.knowledgePoints.length,
    )
  ) {
    return;
  }
  const guidePoints: unknown[] = answer.learningGuide.map((guide: unknown) =>
    object(guide) ? guide.knowledgePoint : undefined,
  );
  check.require(
    new Set(guidePoints).size === guidePoints.length &&
      source.knowledgePoints.every(point => guidePoints.includes(point)),
    `${path} 必须为每个原核心知识点恰好给出一份五维学习说明，不能漏点、重复或扩充原核心`,
  );
  const evidence = questionEvidenceSources(
    source,
    generatedQuestion,
    analysis,
    generatedMaterials,
    generatedFigures,
    answer,
  );
  const originalTexts = evidence.original.map(item => item.text);
  const newTexts = evidence.problem.map(item => item.text);
  const solutionTexts = evidence.solution.map(item => item.text);
  const quote = (value: unknown, corpus: string[], quotePath: string) => {
    check.require(
      nonempty(value) &&
        !!fingerprint(value) &&
        exactEvidenceQuote(
          value,
          corpus.map((entry, index) => ({
            id: String(index),
            field: quotePath,
            text: entry,
          })),
        ),
      `${quotePath}（第${source.number}题，ID ${
        source.id
      }）必须逐字引用本题对应的原题、新题或答案解析，不能以学习说明自身、别题或伪造引文作证；本字段仅允许${
        quotePath.endsWith('.sourceQuote')
          ? '对应原题题文/关联材料或原图说明'
          : quotePath.endsWith('.problemQuote')
          ? '当前新题题文/关联材料或图示说明'
          : '本题答案的explanation或scoringPoints，不包括answer或learningGuide'
      }，原题与新题引文不能互换`,
    );
  };
  const concrete = (value: unknown, textPath: string, point?: string) => {
    check.text(value, textPath);
    const key = fingerprint(value);
    check.require(
      !!key &&
        key !== fingerprint(point) &&
        ![
          '认真审题',
          '仔细检查',
          '检查答案',
          '巩固基础',
          '理解知识点',
          '加强理解',
          '掌握知识点',
        ].includes(key),
      `${textPath} 必须说明本题具体原理、条件、错因或检查操作，不能仅复述知识点名或泛化学习口号`,
    );
  };
  const misconceptionKeys: string[] = [];
  const transferKeys: string[] = [];
  const transferKinds = new Set<string>();
  const selfCheckKinds = new Set<string>();
  const selfCheckOperations = new Map<string, string>();
  answer.learningGuide.forEach((guide: unknown, index: number) => {
    const guidePath = `${path}[${index}]`;
    if (!object(guide)) {
      check.require(false, `${guidePath} 必须是知识点掌握训练说明对象`);
      return;
    }
    const point = guide.knowledgePoint;
    check.require(
      source.knowledgePoints.includes(point),
      `${guidePath}.knowledgePoint 必须逐字对应本题原核心，目录不能授予额外知识许可`,
    );
    for (const key of ['coreInsight', 'conditionBoundary', 'reasoning']) {
      concrete(guide[key], `${guidePath}.${key}`, point);
    }
    check.require(
      new Set(
        [guide.coreInsight, guide.conditionBoundary, guide.reasoning].map(
          fingerprint,
        ),
      ).size === 3,
      `${guidePath} 原理、条件与推理须各有实际内容，不能复制同一句话冒充不同维度`,
    );
    quote(guide.problemQuote, newTexts, `${guidePath}.problemQuote`);
    quote(guide.solutionQuote, solutionTexts, `${guidePath}.solutionQuote`);
    const allowedChallenges = applicableMasteryChallenges(
      analysis.subject,
      level,
      source,
      analysis.materials,
      point,
      analysis.educationLevel,
    );
    if (
      check.array(guide.misconceptions, `${guidePath}.misconceptions`, 1, 20)
    ) {
      const localMisconceptions: string[] = [];
      guide.misconceptions.forEach((trap: unknown, trapIndex: number) => {
        const trapPath = `${guidePath}.misconceptions[${trapIndex}]`;
        if (!object(trap)) {
          check.require(false, `${trapPath} 必须给出可能错解、错因与正确做法`);
          return;
        }
        if (trap.challengeId === 'source_specific') {
          concrete(trap.scopeReason, `${trapPath}.scopeReason`, point);
          quote(trap.sourceQuote, originalTexts, `${trapPath}.sourceQuote`);
        } else {
          check.require(
            allowedChallenges.some(
              challenge => challenge.id === trap.challengeId,
            ),
            masteryCatalogValidationMessage(`${trapPath}.challengeId`, {
              questionId: source.id,
              questionNumber: source.number,
              knowledgePoint: point,
              educationLevel: analysis.educationLevel,
              receivedChallengeId: trap.challengeId,
              allowedChallengeIds: [
                ...allowedChallenges.map(challenge => challenge.id),
                'source_specific',
              ],
            }),
          );
        }
        for (const key of ['wrongApproach', 'whyWrong', 'correction']) {
          concrete(trap[key], `${trapPath}.${key}`, point);
        }
        check.require(
          new Set(
            [trap.wrongApproach, trap.whyWrong, trap.correction].map(
              fingerprint,
            ),
          ).size === 3,
          `${trapPath} 必须形成错解→错因→纠正链，不能用同义口号重复填充`,
        );
        quote(trap.solutionQuote, solutionTexts, `${trapPath}.solutionQuote`);
        const errorKey = `${fingerprint(trap.wrongApproach)}|${fingerprint(
          trap.whyWrong,
        )}`;
        misconceptionKeys.push(errorKey);
        localMisconceptions.push(errorKey);
      });
      check.require(
        new Set(localMisconceptions).size === localMisconceptions.length,
        `${guidePath}.misconceptions 同一核心内不得重复同一错因凑数`,
      );
    }
    if (check.array(guide.transferLinks, `${guidePath}.transferLinks`, 1, 20)) {
      const localTransfers: string[] = [];
      guide.transferLinks.forEach(
        (transfer: unknown, transferIndex: number) => {
          const transferPath = `${guidePath}.transferLinks[${transferIndex}]`;
          if (!object(transfer)) {
            check.require(
              false,
              `${transferPath} 必须解释同一原核心的条件变化与不变原理`,
            );
            return;
          }
          check.require(
            transfer.kind === 'source_to_variant' ||
              transfer.kind === 'condition_contrast',
            `${transferPath}.kind 只能为source_to_variant/condition_contrast`,
          );
          for (const key of [
            'originalCondition',
            'changedCondition',
            'invariant',
            'adaptation',
          ]) {
            concrete(transfer[key], `${transferPath}.${key}`, point);
          }
          check.require(
            fingerprint(transfer.originalCondition) !==
              fingerprint(transfer.changedCondition),
            `${transferPath} 须有真实条件或设问变化，原样照抄不计迁移`,
          );
          quote(
            transfer.sourceQuote,
            originalTexts,
            `${transferPath}.sourceQuote`,
          );
          quote(
            transfer.problemQuote,
            newTexts,
            `${transferPath}.problemQuote`,
          );
          quote(
            transfer.solutionQuote,
            solutionTexts,
            `${transferPath}.solutionQuote`,
          );
          const transferKey = `${fingerprint(
            transfer.originalCondition,
          )}|${fingerprint(transfer.changedCondition)}`;
          transferKeys.push(transferKey);
          localTransfers.push(transferKey);
          transferKinds.add(transfer.kind);
        },
      );
      check.require(
        new Set(localTransfers).size === localTransfers.length,
        `${guidePath}.transferLinks 同一核心内不得复制同一变化凑数`,
      );
    }
    if (check.array(guide.selfChecks, `${guidePath}.selfChecks`, 1, 3)) {
      const kinds: string[] = [];
      guide.selfChecks.forEach((selfCheck: unknown, checkIndex: number) => {
        const selfPath = `${guidePath}.selfChecks[${checkIndex}]`;
        if (!object(selfCheck)) {
          check.require(false, `${selfPath} 必须给出具体自检方法与预期结果`);
          return;
        }
        check.require(
          ['conditions', 'reasoning', 'result'].includes(selfCheck.kind),
          `${selfPath}.kind 只能为conditions/reasoning/result`,
        );
        concrete(selfCheck.method, `${selfPath}.method`, point);
        concrete(selfCheck.expected, `${selfPath}.expected`, point);
        check.require(
          fingerprint(selfCheck.method) !== fingerprint(selfCheck.expected),
          `${selfPath} 自检操作与预期须分别说明，不能照抄结论充作检验`,
        );
        quote(
          selfCheck.solutionQuote,
          solutionTexts,
          `${selfPath}.solutionQuote`,
        );
        const operation = `${fingerprint(selfCheck.method)}|${fingerprint(
          selfCheck.expected,
        )}`;
        check.require(
          !selfCheckOperations.has(operation) ||
            selfCheckOperations.get(operation) === selfCheck.kind,
          `${selfPath} 同一次检查不能换成条件/推理/结果三种名称重复计数`,
        );
        selfCheckOperations.set(operation, selfCheck.kind);
        kinds.push(selfCheck.kind);
        selfCheckKinds.add(selfCheck.kind);
      });
      check.require(
        new Set(kinds).size === kinds.length,
        `${guidePath}.selfChecks 每知识点同类自检不得重复凑数`,
      );
    }
  });
  check.require(
    new Set(misconceptionKeys).size >= requirements.minMisconceptions,
    `${path} 全题至少${requirements.minMisconceptions}个不同可能错误来源，跨核心共享同一错因只计一次，按题累计而非每核心机械堆数`,
  );
  check.require(
    new Set(transferKeys).size >= requirements.minTransferLinks,
    `${path} 全题至少${requirements.minTransferLinks}个不同同核迁移对照，跨核心共享同一变化只计一次`,
  );
  check.require(
    transferKinds.has('source_to_variant') &&
      (requirements.minTransferLinks < 2 ||
        transferKinds.has('condition_contrast')),
    `${path} 须含实际原题→变式迁移；升3档另须当前条件的真实反事实对照，解析不另增试题`,
  );
  check.require(
    selfCheckKinds.size >= requirements.minSelfChecks,
    `${path} 全题至少${requirements.minSelfChecks}类不同自检，按条件/推理/结果核查，不机械重复验算`,
  );
}
