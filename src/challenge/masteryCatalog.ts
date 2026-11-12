import {applicableMasteryChallenges, ChallengeMasteryChallenge} from './rules';
import {
  canonicalEvidenceQuote,
  EvidenceSource,
  questionEvidenceSources,
} from './evidence';
import type {ChallengePaper, ExamAnalysis} from './types';

type Data = Record<string, any>;
const object = (value: unknown): value is Data =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();

export interface MasteryCatalogIssue {
  questionId: string;
  questionNumber: string;
  path: string;
  knowledgePoint: string;
  educationLevel: ExamAnalysis['educationLevel'];
  receivedChallengeId: unknown;
  allowedChallengeIds: string[];
  challenges: ChallengeMasteryChallenge[];
  originalSources: EvidenceSource[];
  context: Data;
}
interface CatalogBinding extends MasteryCatalogIssue {
  owner: Data;
}

export function masteryCatalogValidationMessage(
  field: string,
  context: Pick<
    MasteryCatalogIssue,
    | 'questionId'
    | 'questionNumber'
    | 'knowledgePoint'
    | 'educationLevel'
    | 'receivedChallengeId'
    | 'allowedChallengeIds'
  >,
) {
  const education = {
    middle: '初中',
    high: '高中',
    unknown: '未知（不启用学段专属目录）',
  }[context.educationLevel];
  return `${field}（第${context.questionNumber}题，ID ${
    context.questionId
  }，原核心“${
    context.knowledgePoint
  }”）必须是本学段、本题原核心与原任务适用的具体易错点目录ID；不适用目录不得硬套。当前学段：${education}；收到：${JSON.stringify(
    context.receivedChallengeId,
  )}；可用ID：${context.allowedChallengeIds.join(
    '、',
  )}。只能选本知识点列出的适用目录；确无适用项时使用source_specific，并提供具体scopeReason和本题原题的真实连续sourceQuote，不得改学段或知识点来过校验。`;
}

function bindings(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  ids?: readonly string[],
): CatalogBinding[] {
  const result: CatalogBinding[] = [];
  for (const question of paper.questions) {
    if (
      !object(question) ||
      question.isListening ||
      question.upgrade?.mode === 'retained' ||
      (ids && !ids.includes(question.id))
    ) {
      continue;
    }
    const source = analysis.questions.find(item => item.id === question.id);
    const answer = paper.answers.find(
      item => object(item) && item.questionId === question.id,
    );
    if (
      !source ||
      source.isListening ||
      !answer ||
      !Array.isArray(answer.learningGuide)
    ) {
      continue;
    }
    const originalSources = questionEvidenceSources(
      source,
      question,
      analysis,
      paper.materials,
      paper.figures,
      answer,
    ).original;
    answer.learningGuide.forEach((guide: unknown, index: number) => {
      if (
        !object(guide) ||
        !source.knowledgePoints.includes(guide.knowledgePoint) ||
        !Array.isArray(guide.misconceptions)
      ) {
        return;
      }
      const challenges = applicableMasteryChallenges(
        analysis.subject,
        paper.level,
        source,
        analysis.materials,
        guide.knowledgePoint,
        analysis.educationLevel,
      );
      guide.misconceptions.forEach((trap: unknown, child: number) => {
        if (!object(trap)) {
          return;
        }
        result.push({
          questionId: source.id,
          questionNumber: source.number,
          path: `answer.learningGuide[${index}].misconceptions[${child}]`,
          knowledgePoint: guide.knowledgePoint,
          educationLevel: analysis.educationLevel,
          receivedChallengeId: trap.challengeId,
          allowedChallengeIds: [
            ...challenges.map(challenge => challenge.id),
            'source_specific',
          ],
          challenges,
          originalSources,
          context: {
            coreInsight: guide.coreInsight,
            conditionBoundary: guide.conditionBoundary,
            misconception: {...trap},
          },
          owner: trap,
        });
      });
    });
  }
  return result;
}

export function invalidMasteryCatalogEntries(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  ids?: readonly string[],
): MasteryCatalogIssue[] {
  return bindings(paper, analysis, ids)
    .filter(
      binding =>
        typeof binding.receivedChallengeId !== 'string' ||
        !binding.allowedChallengeIds.includes(binding.receivedChallengeId),
    )
    .map(({owner: _owner, ...issue}) => issue);
}

/** Change catalog bindings only. Content errors still require ordinary regeneration. */
export function applyMasteryCatalogRepairs(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  targets: MasteryCatalogIssue[],
  value: unknown,
): ChallengePaper {
  const invalid = (reason: string): never => {
    throw new Error(`易错目录修复未通过：${reason}`);
  };
  if (
    !object(value) ||
    !Array.isArray(value.fixes) ||
    value.fixes.length > targets.length ||
    Object.keys(value).some(key => !['fixes', 'unresolved'].includes(key))
  ) {
    return invalid('只允许返回fixes和unresolved，不能改题目、解析或错因正文');
  }
  const copy = JSON.parse(JSON.stringify(paper)) as ChallengePaper;
  const available = bindings(copy, analysis);
  const seen = new Set<string>();
  for (const fix of value.fixes) {
    if (
      !object(fix) ||
      Object.keys(fix).some(
        key =>
          ![
            'questionId',
            'path',
            'challengeId',
            'scopeReason',
            'sourceQuote',
          ].includes(key),
      )
    ) {
      return invalid('每项只能修复指定目录ID及原题定制所需的范围依据');
    }
    const key = JSON.stringify([fix.questionId, fix.path]);
    const target = targets.find(
      item => item.questionId === fix.questionId && item.path === fix.path,
    );
    const binding = available.find(
      item => item.questionId === fix.questionId && item.path === fix.path,
    );
    if (!target || !binding || seen.has(key)) {
      return invalid('不得修改未指定题目、知识点或字段，也不得重复修复同一项');
    }
    if (!binding.allowedChallengeIds.includes(fix.challengeId)) {
      return invalid(
        masteryCatalogValidationMessage(`${binding.path}.challengeId`, {
          ...binding,
          receivedChallengeId: fix.challengeId,
        }),
      );
    }
    if (fix.challengeId === 'source_specific') {
      const sourceQuote = canonicalEvidenceQuote(
        fix.sourceQuote,
        binding.originalSources,
      );
      if (!text(fix.scopeReason) || sourceQuote === undefined) {
        return invalid(
          '原题定制必须提供具体scopeReason和本题原题的真实sourceQuote',
        );
      }
      binding.owner.scopeReason = fix.scopeReason;
      binding.owner.sourceQuote = sourceQuote;
    } else if (fix.scopeReason !== undefined || fix.sourceQuote !== undefined) {
      return invalid('适用目录ID无需添加原题定制依据，不得捏造额外来源');
    }
    binding.owner.challengeId = fix.challengeId;
    seen.add(key);
  }
  if (value.unresolved !== undefined) {
    if (
      !Array.isArray(value.unresolved) ||
      value.unresolved.length > targets.length
    ) {
      return invalid('无法修复时仅返回指定题目、路径和真实原因');
    }
    for (const item of value.unresolved) {
      if (
        !object(item) ||
        !text(item.reason) ||
        Object.keys(item).some(
          key => !['questionId', 'path', 'reason'].includes(key),
        ) ||
        !targets.some(
          target =>
            target.questionId === item.questionId && target.path === item.path,
        )
      ) {
        return invalid('无法修复时仅返回指定题目、路径和真实原因');
      }
      const key = JSON.stringify([item.questionId, item.path]);
      if (seen.has(key)) {
        return invalid('同一项不能同时标为已修复和未解决或重复列出');
      }
      seen.add(key);
    }
  }
  return copy;
}
