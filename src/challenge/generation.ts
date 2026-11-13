import {CHALLENGE_POLICY_VERSION} from './rules';
import {prepareRetainedAnalysis} from './retention';
import {
  isRetainedQuestion,
  preserveRequiredOriginals,
  requiredRetentionIds,
  retainEntirePaper,
  sourceRequiresRetention,
} from './selection';
import {
  ChallengeGenerationProgress,
  ChallengeLevel,
  ChallengePaper,
  ExamAnalysis,
  PaperQuestion,
} from './types';
import {ChallengeValidationError, sameJson} from './validation';
import {canonicalizePaperEvidence} from './evidence';

export const CHALLENGE_GENERATION_SELECTION_VERSION = 'local-selection-v1';

export function generationSignature(analysis: ExamAnalysis): string {
  return JSON.stringify({
    subject: analysis.subject,
    title: analysis.title,
    educationLevel: analysis.educationLevel,
    sections: analysis.sections,
    materials: analysis.materials,
    figures: analysis.figures,
    totalScore: analysis.totalScore,
    timeLimitMinutes: analysis.timeLimitMinutes,
    questions: analysis.questions.map(question => ({
      ...question,
      originalRegions: undefined,
      analysisIssues: undefined,
      retentionReason: undefined,
      upgradeEligibility: undefined,
    })),
    requiredRetentionIds: [...requiredRetentionIds(analysis)].sort(),
  });
}

/** Only marked source figures need a bitmap fallback for otherwise readable originals. */
export function generationAnalysis(input: ExamAnalysis): ExamAnalysis {
  const analysis = prepareRetainedAnalysis(input);
  return {
    ...analysis,
    warnings: [
      ...new Set([
        ...analysis.warnings,
        ...analysis.questions
          .filter(sourceRequiresRetention)
          .flatMap(question =>
            (question.originalRegions || [])
              .filter(
                region =>
                  region.box.x === 0 &&
                  region.box.y === 0 &&
                  region.box.width === 1 &&
                  region.box.height === 1,
              )
              .map(
                region =>
                  `第${
                    region.pageIndex + 1
                  }页部分保留题无法精确定位，按原题位置附对应原页，不影响其余题升档。`,
              ),
          ),
      ]),
    ],
    questions: analysis.questions.map(question => {
      const figures = analysis.figures.filter(
        figure =>
          question.figureIds.includes(figure.id) ||
          analysis.materials.some(
            material =>
              question.materialIds.includes(material.id) &&
              material.figureIds.includes(figure.id),
          ),
      );
      if (
        question.originalRegions?.length ||
        !figures.some(figure => figure.containsStudentMarks)
      ) {
        return question;
      }
      return {
        ...question,
        originalRegions: [
          ...new Set([
            ...question.sourceRefs.map(ref => ref.pageIndex),
            ...figures.map(figure => figure.pageIndex),
          ]),
        ]
          .sort((a, b) => a - b)
          .map(pageIndex => ({
            pageIndex,
            box: {x: 0, y: 0, width: 1, height: 1},
          })),
      };
    }),
  };
}

export function generationSeed(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): ChallengePaper {
  return {
    ...retainEntirePaper(analysis, level),
    title: `${analysis.title} · 挑战升${level}档`,
  };
}

export function generationCheckpoint(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  completed: readonly string[],
  paper: ChallengePaper,
  resume: Pick<
    ChallengeGenerationProgress,
    | 'phase'
    | 'pendingQuestionIds'
    | 'feedback'
    | 'evidenceQuestionIds'
    | 'afterEvidencePhase'
    | 'evidenceBasePaper'
    | 'lockedAssetIds'
    | 'selectionVersion'
    | 'selectedQuestionIds'
  > = {},
): ChallengeGenerationProgress {
  return {
    version: 'question-patches-v1',
    policyVersion: CHALLENGE_POLICY_VERSION,
    sourceSignature: generationSignature(analysis),
    level,
    integrityVersion: 2,
    selectionVersion: resume.selectionVersion,
    selectedQuestionIds: resume.selectedQuestionIds
      ? [...resume.selectedQuestionIds]
      : undefined,
    completedQuestionIds: [...completed],
    phase: resume.phase || 'generation',
    pendingQuestionIds: resume.pendingQuestionIds
      ? [...resume.pendingQuestionIds]
      : undefined,
    feedback: resume.feedback,
    evidenceQuestionIds: resume.evidenceQuestionIds
      ? [...resume.evidenceQuestionIds]
      : undefined,
    afterEvidencePhase: resume.afterEvidencePhase,
    evidenceBasePaper: resume.evidenceBasePaper,
    lockedAssetIds: resume.lockedAssetIds
      ? [...resume.lockedAssetIds]
      : undefined,
    paper,
  };
}

export function canResumeGeneration(
  checkpoint: ChallengeGenerationProgress | undefined,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): checkpoint is ChallengeGenerationProgress {
  const forced = requiredRetentionIds(analysis);
  const eligible = new Set(
    analysis.questions
      .filter(question => !forced.has(question.id))
      .map(question => question.id),
  );
  const validPendingIds = (ids: unknown) =>
    Array.isArray(ids) &&
    new Set(ids).size === ids.length &&
    ids.every(id => eligible.has(id));
  const validAssetIds = new Set([
    ...analysis.materials.map(item => `materials:${item.id}`),
    ...analysis.figures.map(item => `figures:${item.id}`),
  ]);
  return (
    !!checkpoint &&
    checkpoint.version === 'question-patches-v1' &&
    checkpoint.policyVersion === CHALLENGE_POLICY_VERSION &&
    (checkpoint.integrityVersion === undefined ||
      checkpoint.integrityVersion === 2) &&
    checkpoint.level === level &&
    checkpoint.sourceSignature === generationSignature(analysis) &&
    (checkpoint.selectionVersion === undefined ||
      (checkpoint.selectionVersion === CHALLENGE_GENERATION_SELECTION_VERSION &&
        validPendingIds(checkpoint.selectedQuestionIds))) &&
    Array.isArray(checkpoint.completedQuestionIds) &&
    new Set(checkpoint.completedQuestionIds).size ===
      checkpoint.completedQuestionIds.length &&
    checkpoint.completedQuestionIds.every(id => eligible.has(id)) &&
    (checkpoint.phase === undefined ||
      checkpoint.phase === 'generation' ||
      checkpoint.phase === 'repair' ||
      checkpoint.phase === 'evidence') &&
    (checkpoint.phase !== 'repair' ||
      Array.isArray(checkpoint.pendingQuestionIds)) &&
    (checkpoint.pendingQuestionIds === undefined ||
      validPendingIds(checkpoint.pendingQuestionIds)) &&
    (checkpoint.evidenceQuestionIds === undefined ||
      validPendingIds(checkpoint.evidenceQuestionIds)) &&
    (checkpoint.selectionVersion === undefined ||
      [
        ...checkpoint.completedQuestionIds,
        ...(checkpoint.pendingQuestionIds || []),
        ...(checkpoint.evidenceQuestionIds || []),
      ].every(id => checkpoint.selectedQuestionIds!.includes(id))) &&
    (checkpoint.lockedAssetIds === undefined ||
      (Array.isArray(checkpoint.lockedAssetIds) &&
        new Set(checkpoint.lockedAssetIds).size ===
          checkpoint.lockedAssetIds.length &&
        checkpoint.lockedAssetIds.every(id => validAssetIds.has(id)))) &&
    (checkpoint.afterEvidencePhase === undefined ||
      checkpoint.afterEvidencePhase === 'generation' ||
      checkpoint.afterEvidencePhase === 'repair') &&
    (checkpoint.phase !== 'evidence' ||
      (validPendingIds(checkpoint.evidenceQuestionIds) &&
        (checkpoint.afterEvidencePhase === 'generation' ||
          checkpoint.afterEvidencePhase === 'repair')))
  );
}

/** Keep source order among ready questions, while always resolving prerequisites first. */
export function questionGenerationOrder(
  analysis: ExamAnalysis,
  ids: readonly string[],
): {orderedIds: string[]; blockedIds: string[]} {
  const selected = new Set(ids);
  const known = new Set(analysis.questions.map(question => question.id));
  const dependencies = new Map(
    analysis.questions.map(question => [
      question.id,
      new Set(question.dependsOnQuestionIds || []),
    ]),
  );
  const processed = new Set<string>();
  const orderedIds: string[] = [];
  while (true) {
    const ready = analysis.questions.find(
      question =>
        !processed.has(question.id) &&
        [...dependencies.get(question.id)!].every(id => processed.has(id)),
    );
    if (!ready) {
      break;
    }
    processed.add(ready.id);
    if (selected.has(ready.id)) {
      orderedIds.push(ready.id);
    }
  }
  // Cycles and missing prerequisites also block their dependants. Neither is
  // safe to generate from an original placeholder or an invented result.
  const blockedIds = analysis.questions
    .filter(
      question => selected.has(question.id) && !processed.has(question.id),
    )
    .map(question => question.id);
  blockedIds.push(...[...selected].filter(id => !known.has(id)));
  return {orderedIds, blockedIds};
}

/** Traverse through every dependant before optionally restricting the returned targets. */
export function questionSuccessorIds(
  analysis: ExamAnalysis,
  ids: readonly string[],
  candidateIds?: readonly string[],
): Set<string> {
  const affected = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of analysis.questions) {
      if (
        !affected.has(question.id) &&
        question.dependsOnQuestionIds?.some(id => affected.has(id))
      ) {
        affected.add(question.id);
        changed = true;
      }
    }
  }
  return new Set(
    analysis.questions
      .filter(
        question =>
          affected.has(question.id) &&
          (!candidateIds || candidateIds.includes(question.id)),
      )
      .map(question => question.id),
  );
}

/** Changes to a prerequisite or shared condition invalidate all dependent variants. */
export function affectedGenerationIds(
  analysis: ExamAnalysis,
  before: ChallengePaper,
  after: ChallengePaper,
  changedIds: readonly string[] = [],
): Set<string> {
  const affected = new Set(changedIds);
  const questionCondition = (question: PaperQuestion | undefined) =>
    question && {
      stem: question.stem,
      options: question.options,
      sectionId: question.sectionId,
      materialIds: question.materialIds,
      figureIds: question.figureIds,
      knowledgePoints: question.knowledgePoints,
      answerLines: question.answerLines,
      type: question.type,
      score: question.score,
      isListening: question.isListening,
    };
  const answerCondition = (
    answer: ChallengePaper['answers'][number] | undefined,
  ) =>
    answer && {
      status: answer.status,
      answer: answer.answer,
      explanation: answer.explanation,
      scoringPoints: answer.scoringPoints,
    };
  const changedAssets = <T extends {id: string}>(
    previous: readonly T[],
    current: readonly T[],
  ) =>
    new Set(
      [...new Set([...previous, ...current].map(item => item.id))].filter(
        id =>
          !sameJson(
            previous.find(item => item.id === id),
            current.find(item => item.id === id),
          ),
      ),
    );
  const materials = changedAssets(before.materials, after.materials);
  const figures = changedAssets(before.figures, after.figures);
  const sections = changedAssets(before.sections, after.sections);
  for (const source of analysis.questions) {
    const previous = before.questions.find(
      question => question.id === source.id,
    );
    const current = after.questions.find(question => question.id === source.id);
    const references: PaperQuestion[] = [source];
    if (previous) {
      references.push(previous);
    }
    if (current) {
      references.push(current);
    }
    if (
      !sameJson(questionCondition(previous), questionCondition(current)) ||
      !sameJson(
        answerCondition(
          before.answers.find(answer => answer.questionId === source.id),
        ),
        answerCondition(
          after.answers.find(answer => answer.questionId === source.id),
        ),
      ) ||
      references.some(
        question =>
          sections.has(question.sectionId) ||
          question.materialIds.some(id => materials.has(id)) ||
          question.figureIds.some(id => figures.has(id)) ||
          [...analysis.materials, ...before.materials, ...after.materials].some(
            material =>
              question.materialIds.includes(material.id) &&
              material.figureIds.some(id => figures.has(id)),
          ),
      )
    ) {
      affected.add(source.id);
    }
  }
  return questionSuccessorIds(analysis, [...affected]);
}

export function questionContextIds(
  analysis: ExamAnalysis,
  ids: readonly string[],
): Set<string> {
  const selected = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of analysis.questions) {
      if (!selected.has(question.id)) {
        continue;
      }
      for (const dependency of question.dependsOnQuestionIds || []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
  return selected;
}

function assetUsers(
  analysis: ExamAnalysis,
  key: 'materials' | 'figures',
  id: string,
) {
  const usesAsset = (question: ExamAnalysis['questions'][number]) =>
    key === 'materials'
      ? question.materialIds.includes(id)
      : question.figureIds.includes(id) ||
        analysis.materials.some(
          material =>
            question.materialIds.includes(material.id) &&
            material.figureIds.includes(id),
        );
  return analysis.questions.filter(question => {
    const contexts = questionContextIds(analysis, [question.id]);
    return analysis.questions.some(
      source => contexts.has(source.id) && usesAsset(source),
    );
  });
}

/** A changed shared condition must be repaired with all of its upgraded users. */
export function sharedAssetRepairIds(
  analysis: ExamAnalysis,
  paper: ChallengePaper,
  ids: readonly string[],
  lockedAssetIds: readonly string[] = [],
): Set<string> {
  const variants = paper.questions
    .filter(question => !isRetainedQuestion(question))
    .map(question => question.id);
  const upgraded = new Set(variants);
  const forced = requiredRetentionIds(analysis);
  const locked = new Set(lockedAssetIds);
  const affected = questionSuccessorIds(analysis, ids, variants);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of ['materials', 'figures'] as const) {
      const originals: readonly {id: string}[] = analysis[key];
      const current: readonly {id: string}[] = paper[key];
      for (const original of originals) {
        if (
          locked.has(`${key}:${original.id}`) ||
          sameJson(
            original,
            current.find(item => item.id === original.id),
          )
        ) {
          continue;
        }
        const users = assetUsers(analysis, key, original.id);
        if (
          !users.some(question => affected.has(question.id)) ||
          users.some(
            question => !upgraded.has(question.id) || forced.has(question.id),
          )
        ) {
          continue;
        }
        for (const id of questionSuccessorIds(
          analysis,
          users.map(question => question.id),
          variants,
        )) {
          if (!affected.has(id)) {
            affected.add(id);
            changed = true;
          }
        }
      }
    }
  }
  return new Set(
    analysis.questions
      .filter(question => affected.has(question.id))
      .map(question => question.id),
  );
}

export function batchAnalysis(
  analysis: ExamAnalysis,
  ids: readonly string[],
): ExamAnalysis {
  const contexts = questionContextIds(analysis, ids);
  const questions = analysis.questions.filter(question =>
    contexts.has(question.id),
  );
  const sections = new Set(questions.map(question => question.sectionId));
  const materials = new Set(
    questions.flatMap(question => question.materialIds),
  );
  const figures = new Set([
    ...questions.flatMap(question => question.figureIds),
    ...analysis.materials
      .filter(material => materials.has(material.id))
      .flatMap(material => material.figureIds),
  ]);
  return {
    ...analysis,
    questions: questions.filter(question => ids.includes(question.id)),
    sections: analysis.sections.filter(section => sections.has(section.id)),
    materials: analysis.materials.filter(material =>
      materials.has(material.id),
    ),
    figures: analysis.figures.filter(figure => figures.has(figure.id)),
    knowledgePoints: [
      ...new Set(
        questions
          .filter(question => ids.includes(question.id))
          .flatMap(question => question.knowledgePoints),
      ),
    ],
    majorQuestions: analysis.majorQuestions?.filter(major =>
      questions.some(question => question.majorQuestionId === major.id),
    ),
    unresolvedIssues: questions.flatMap(
      question => question.analysisIssues || [],
    ),
    warnings: [],
  };
}

function invalid(message: string): never {
  throw new ChallengeValidationError([message]);
}
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Apply only changed entities. Omitted question IDs remain at their original positions. */
export function mergeGenerationPatch(
  value: unknown,
  analysis: ExamAnalysis,
  current: ChallengePaper,
  ids: readonly string[],
  completedQuestionIds: readonly string[],
  options: {
    assetRepairQuestionIds?: readonly string[];
    lockedAssetIds?: readonly string[];
    onNormalize?: (intent: ChallengePaper, normalized: ChallengePaper) => void;
  } = {},
): ChallengePaper {
  if (
    !record(value) ||
    !Array.isArray(value.questions) ||
    !Array.isArray(value.answers)
  ) {
    return invalid(
      '本批必须返回{questions:[],answers:[]}，只包含实际升档题；没有升档题用空数组',
    );
  }
  for (const key of [
    'subject',
    'level',
    'totalScore',
    'timeLimitMinutes',
    'masteryStatus',
  ] as const) {
    if (value[key] !== undefined && !sameJson(value[key], current[key])) {
      invalid(
        `${key} 必须保持原卷和所选档次，不能通过分批输出改科、改分或宣称已掌握`,
      );
    }
  }
  if (
    value.sections !== undefined &&
    !sameJson(value.sections, analysis.sections)
  ) {
    invalid('sections 必须保持原题组，本批不返回或更改题组');
  }
  const questionIds = new Set<string>();
  const retainedReasons = record(value.retainedReasons)
    ? value.retainedReasons
    : {};
  const variants = value.questions.filter((question: unknown) => {
    if (
      !record(question) ||
      typeof question.id !== 'string' ||
      !analysis.questions.some(source => source.id === question.id)
    ) {
      return invalid('本批questions.id必须是原卷题ID，不能增加或替换题目');
    }
    if (question.upgrade?.mode === 'retained') {
      // Read older full-paper replies, but never copy their unchanged bodies.
      if (
        ids.includes(question.id) &&
        typeof question.upgrade.retentionReason === 'string'
      ) {
        retainedReasons[question.id] = question.upgrade.retentionReason;
      }
      return false;
    }
    if (!ids.includes(question.id) || questionIds.has(question.id)) {
      return invalid(
        '本批只能返回指定题ID的一份升档题，不能输出其它批次或重复题',
      );
    }
    questionIds.add(question.id);
    return true;
  });
  const answerIds = new Set<string>();
  const answers = value.answers.filter((answer: unknown) => {
    if (!record(answer) || typeof answer.questionId !== 'string') {
      return invalid('本批answers必须按questionId关联升档题');
    }
    if (!questionIds.has(answer.questionId)) {
      if (
        value.questions.some(
          (question: any) =>
            question?.id === answer.questionId &&
            question?.upgrade?.mode === 'retained',
        )
      ) {
        return false;
      }
      return invalid(
        '本批answers只能返回本批实际升档题的答案，不返回保留题答案',
      );
    }
    if (answerIds.has(answer.questionId)) {
      return invalid('本批每道升档题必须恰有一份答案');
    }
    answerIds.add(answer.questionId);
    return true;
  });
  if (answerIds.size !== questionIds.size) {
    invalid('本批每道升档题必须恰有一份答案，不能漏掉详解');
  }
  const forced = requiredRetentionIds(analysis);
  const repairScope = new Set(options.assetRepairQuestionIds || []);
  const lockedAssets = new Set(options.lockedAssetIds || []);
  const updateAssets = <T extends {id: string}>(
    key: 'materials' | 'figures',
    originals: T[],
    existing: T[],
  ): T[] => {
    if (value[key] === undefined) {
      return existing;
    }
    if (!Array.isArray(value[key])) {
      return invalid(`${key} 必须只列实际变更对象，未改动时省略或空数组`);
    }
    const seen = new Set<string>();
    const result = [...existing];
    for (const item of value[key]) {
      if (!record(item) || typeof item.id !== 'string' || seen.has(item.id)) {
        invalid(`${key}.id无效或重复`);
      }
      seen.add(item.id);
      const index = originals.findIndex(original => original.id === item.id);
      if (index < 0) {
        invalid(`${key}不得新增无来源的材料或图形`);
      }
      if (sameJson(item, result[index])) {
        continue;
      }
      if (lockedAssets.has(`${key}:${item.id}`)) {
        invalid(`${key}.${item.id}本轮已修订并锁定，后续批次必须沿用当前条件`);
      }
      const users = assetUsers(analysis, key, item.id);
      if (
        !users.some(
          question => ids.includes(question.id) && questionIds.has(question.id),
        )
      ) {
        invalid(`${key}.${item.id}不属于本批实际升档题，不能返回无关变更`);
      }
      const redraw =
        key === 'figures' &&
        (originals[index] as any).containsStudentMarks === true &&
        item.kind === 'drawing' &&
        item.caption === (originals[index] as any).caption;
      const scopedRepair =
        !!users.length &&
        users.every(question => {
          const candidate = ids.includes(question.id)
            ? variants.find((variant: any) => variant.id === question.id)
            : current.questions.find(
                existingQuestion => existingQuestion.id === question.id,
              );
          return (
            repairScope.has(question.id) &&
            !forced.has(question.id) &&
            !!candidate &&
            !isRetainedQuestion(candidate)
          );
        });
      if (
        !users.length ||
        users.some(
          question =>
            !ids.includes(question.id) || !questionIds.has(question.id),
        )
      ) {
        if (!redraw && !scopedRepair) {
          invalid(
            `${key}.${item.id}还供其它批次或保留题使用，必须保持原条件；仅可等内容清除图上学生标记`,
          );
        }
      }
      result[index] = item as T;
    }
    return result;
  };
  const original = generationSeed(analysis, current.level);
  let paper: ChallengePaper = {
    ...current,
    title:
      typeof value.title === 'string' && value.title.trim()
        ? value.title
        : current.title,
    materials: updateAssets('materials', analysis.materials, current.materials),
    figures: updateAssets('figures', analysis.figures, current.figures),
    questions: current.questions.map(question => {
      if (!ids.includes(question.id)) {
        return question;
      }
      const changed = variants.find(
        (variant: any) => variant.id === question.id,
      );
      if (changed) {
        return changed;
      }
      const source = original.questions.find(item => item.id === question.id)!;
      const reason = retainedReasons[question.id];
      return {
        ...source,
        upgrade: {
          ...source.upgrade,
          retentionReason:
            typeof reason === 'string' && reason.trim()
              ? reason
              : source.upgrade.retentionReason,
        },
      };
    }),
    answers: current.answers.map(answer => {
      if (!ids.includes(answer.questionId)) {
        return answer;
      }
      return (
        answers.find(
          (changed: any) => changed.questionId === answer.questionId,
        ) ||
        original.answers.find(item => item.questionId === answer.questionId)!
      );
    }),
  };
  // Only completed, actually retained questions freeze their earlier dependencies.
  // Unattempted placeholders must not roll back a valid earlier batch.
  const completed = new Set([...completedQuestionIds, ...ids]);
  const dynamic: ExamAnalysis = {
    ...analysis,
    questions: analysis.questions.map(question =>
      completed.has(question.id) &&
      isRetainedQuestion(paper.questions.find(item => item.id === question.id)!)
        ? {
            ...question,
            upgradeEligibility: 'retain',
            retentionReason: paper.questions.find(
              item => item.id === question.id,
            )!.upgrade.retentionReason,
          }
        : question,
    ),
  };
  const normalized = preserveRequiredOriginals(
    paper,
    dynamic,
    current.level,
  ) as ChallengePaper;
  options.onNormalize?.(paper, normalized);
  paper = normalized;
  return canonicalizePaperEvidence(paper, analysis, ids);
}
